// เคลียร์ advance — กรอกตารางตามฟอร์ม Expenses Claim: วันที่ / รายการ / จำนวนเงิน / มี-ไม่มีใบเสร็จ / หมายเหตุ
// บันทึกร่างได้ (กรอกทีละวัน) · ยอดใช้จริง = ผลรวมของตาราง · ใช้เกินยอด advance ได้ (ส่วนเกินไปเบิกใบฟ้าหลังบัญชีตรวจ)
import { api, money, fmtDate, esc, todayYMD } from '../core.js?v=10.4.25';
import { icon, toast, toastError, confirmBox, busy, receiptPicker, errorBox, skeleton, debounce, on, $, $$ } from '../ui.js?v=10.4.25';

const OTHER = '__other__';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const LS = (id) => 'exion_advclr_' + id;

export async function render(ctx) {
  const { el, query } = ctx;
  const id = query.id;
  if (!id) { ctx.go('/pv'); return; }
  const st = { a: null, rc: null, sl: null, seq: 0, local: false, hold: 0 };

  async function load() {
    try {
      st.a = await api.rpc('get_pv_adv', { p_id: id });
      if (!ctx.alive()) return;
      if (!st.a.canClear) { ctx.go('/pv/view?id=' + encodeURIComponent(st.a.id || id)); return; }
      ctx.setTitle('เคลียร์ ' + st.a.id);
      // ที่กรอกค้างไว้ในเครื่องนี้ (ยังไม่ได้กดบันทึกร่าง) → เอากลับมาให้
      st.local = false;
      try {
        const d = JSON.parse(localStorage.getItem(LS(st.a.id)) || 'null');
        if (d && Array.isArray(d.rows)) { st.a = { ...st.a, rows: d.rows, trip: d.trip ?? st.a.trip, note: d.note ?? st.a.note }; st.local = true; }
      } catch {}
      paint();
    } catch (e) { if (ctx.alive()) errorBox(el, e, load); }
  }

  function rowHtml(r = {}) {
    const k = ++st.seq, items = st.a.items || [];
    const isOther = !!r.desc && !items.includes(r.desc);
    const sel = isOther ? OTHER : (r.desc || '');
    return `<div class="clr-row" data-row="${k}">
      <div class="clr-no" data-no></div>
      <div class="clr-c c-date"><label class="clr-lab" for="clr-d-${k}">วันที่</label><input type="date" class="input" id="clr-d-${k}" data-r="date" max="${todayYMD()}" value="${esc(r.date || '')}" aria-label="วันที่"></div>
      <div class="clr-c c-desc"><label class="clr-lab" for="clr-s-${k}">รายการ</label>
        <select class="input" id="clr-s-${k}" data-r="sel" aria-label="รายการ"><option value="">เลือกรายการ</option>${items.map((i) => `<option value="${esc(i)}" ${sel === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}<option value="${OTHER}" ${sel === OTHER ? 'selected' : ''}>อื่นๆ (พิมพ์เอง)</option></select>
        <input class="input mt-8 ${isOther ? '' : 'hidden'}" data-r="other" maxlength="120" aria-label="รายการ (พิมพ์เอง)" value="${isOther ? esc(r.desc) : ''}"></div>
      <div class="clr-c c-amt"><label class="clr-lab" for="clr-a-${k}">จำนวนเงิน (บาท)</label><input type="number" class="input" id="clr-a-${k}" data-r="amount" inputmode="decimal" step="0.01" min="0" value="${r.amount ?? ''}" aria-label="จำนวนเงิน"></div>
      <div class="clr-c c-rc"><span class="clr-lab">ใบเสร็จ</span><div class="seg sm" role="group" aria-label="ใบเสร็จ"><button type="button" data-rc="1" class="${r.receipt === false ? '' : 'on'}">มี</button><button type="button" data-rc="0" class="${r.receipt === false ? 'on' : ''}">ไม่มี</button></div></div>
      <div class="clr-c c-rm"><label class="clr-lab" for="clr-m-${k}">หมายเหตุ <span class="opt">ไม่บังคับ</span></label><input class="input" id="clr-m-${k}" data-r="remark" maxlength="200" value="${esc(r.remark || '')}" aria-label="หมายเหตุ"></div>
      <button type="button" class="btn-icon sm clr-rm" data-act="rm-row" aria-label="ลบบรรทัด">${icon('trash')}</button>
    </div>`;
  }
  const box = () => $('[data-rows]', el);
  const rowEls = () => $$('.clr-row', box());
  const readRow = (d) => {
    const sel = $('[data-r=sel]', d).value, av = $('[data-r=amount]', d).value;
    return { date: $('[data-r=date]', d).value, desc: sel === OTHER ? $('[data-r=other]', d).value.trim() : sel,
      amount: av === '' ? null : r2(av), receipt: $('[data-rc].on', d)?.dataset.rc !== '0', remark: $('[data-r=remark]', d).value.trim(), other: sel === OTHER };
  };
  // บรรทัดว่าง = ไม่นับ ไม่ส่ง (มีแค่วันที่ที่ระบบเติมให้ตอนกดเพิ่มบรรทัด ก็ถือว่าว่าง)
  const blank = (r) => !r.desc && r.amount == null && !r.remark && !r.other;
  const rows = () => rowEls().map(readRow).filter((r) => !blank(r)).map(({ other, ...r }) => r);
  const total = () => r2(rows().reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const renumber = () => rowEls().forEach((d, i) => { $('[data-no]', d).textContent = i + 1; });

  function paintSum() {
    const a = st.a, n = rows().length, t = total(), rem = r2(Number(a.amount) - t);
    $('[data-sum]', el).innerHTML = `
      <span class="k">รับ advance</span><span class="v">${money(a.amount)}</span>
      <span class="k">ใช้จริง (${n} รายการ)</span><span class="v">${money(t)}</span>
      <span class="k tot ${rem < 0 ? 'over' : rem > 0 ? 'back' : ''}">${rem < 0 ? 'ใช้เกิน' : rem > 0 ? 'คงเหลือ ต้องคืนบริษัท' : 'คงเหลือ'}</span><span class="v tot ${rem < 0 ? 'over' : rem > 0 ? 'back' : ''}">${money(Math.abs(rem))}</span>`;
    $('[data-over]', el).classList.toggle('hidden', !(rem < 0));
    $('[data-retbox]', el).classList.toggle('hidden', !(rem > 0));
  }
  const saveLocal = debounce(() => {
    if (Date.now() < st.hold) return;      // เพิ่งบันทึกร่าง / ส่งไป → ไม่เขียนร่างในเครื่องกลับมา
    try { localStorage.setItem(LS(st.a.id), JSON.stringify({ rows: rowEls().map(readRow).filter((r) => !blank(r)).map(({ other, ...r }) => r), trip: $('[data-trip]', el)?.value || '', note: $('[data-note]', el)?.value || '' })); } catch {}
  }, 400);
  const dropLocal = () => { st.hold = Date.now() + 1500; try { localStorage.removeItem(LS(st.a.id)); } catch {} };
  const changed = () => { paintSum(); saveLocal(); };

  function paint() {
    const a = st.a;
    const list = (a.rows || []).length ? a.rows : [{}];
    st.seq = 0;
    el.innerHTML = `
    <div class="stack">
      <div class="card pad stack-sm">
        <div class="flex between wrap gap-12">
          <div class="stack-sm" style="gap:4px"><b class="mono text-lg">${esc(a.id)}</b><div class="text-sm muted">${esc(a.requesterName)}${a.jobNo ? ' · Job ' + esc(a.jobNo) : ''}${a.paidAt ? ' · รับเงิน ' + fmtDate(a.paidAt) : ''}</div></div>
          <div class="text-right"><div class="callout-amount"><span class="v amount">${money(a.amount)}</span><span class="muted">บาท</span></div>${a.advDue ? `<div class="text-sm muted">เคลียร์ภายใน ${fmtDate(a.advDue)}</div>` : ''}</div>
        </div>
        ${a.status === 'Returned' && a.returnRemark ? `<div class="alert bad">${icon('alert')}<div><b>บัญชีตีกลับการเคลียร์:</b> ${esc(a.returnRemark)}</div></div>` : ''}
        ${st.local ? `<div class="alert neutral">${icon('info')}<div>เอาข้อมูลที่กรอกค้างไว้ในเครื่องนี้กลับมาให้แล้ว (ยังไม่ได้บันทึกร่าง) · <a href="#" data-act="use-server">ใช้ข้อมูลที่บันทึกไว้ในระบบแทน</a></div></div>` : ''}
        <div class="field" style="margin:0"><label for="clr-trip">Trip <span class="opt">ชื่องาน / สถานที่ · ขึ้นหัวฟอร์ม Excel</span></label><input class="input" id="clr-trip" data-trip maxlength="120" value="${esc(a.trip || '')}"></div>
      </div>

      <div class="card pad stack-sm">
        <div class="flex between wrap"><b>รายการที่ใช้จริง</b><span class="text-sm muted">กรอกทีละรายการตามใบเสร็จ</span></div>
        <div class="clr-head"><span></span><span>วันที่</span><span>รายการ</span><span>จำนวนเงิน (บาท)</span><span>ใบเสร็จ</span><span>หมายเหตุ</span><span></span></div>
        <div class="stack-sm" data-rows>${list.map(rowHtml).join('')}</div>
        <div><button type="button" class="btn btn-secondary btn-sm" data-act="add-row">${icon('plus', 'sm')} เพิ่มบรรทัด</button></div>
      </div>

      <div class="card pad stack-sm">
        <div class="clr-sum" data-sum></div>
        <div class="alert warn hidden" data-over>${icon('info')}<div>ใช้เกินยอด advance — ส่งเคลียร์ได้ตามปกติ · หลังบัญชีตรวจผ่าน เปิดใบนี้แล้วกด <b>เบิกส่วนเกิน</b> (ใบฟ้าปกติ ไม่ใช่ advance)</div></div>
        <div class="field" style="margin:0"><label>ใบเสร็จ <span class="opt">แนบได้ 30 ไฟล์ · ไฟล์ที่แนบไว้แล้วไม่ต้องแนบใหม่</span></label><div data-rcpick></div></div>
        <div class="field hidden" style="margin:0" data-retbox><label>สลิปโอนคืนเงินที่เหลือ <span class="opt">ไม่บังคับ · คืนเป็นเงินสดไม่ต้องแนบ</span></label><div data-slpick></div></div>
        <div class="field" style="margin:0"><label for="clr-note">หมายเหตุถึงบัญชี <span class="opt">ไม่บังคับ</span></label><input class="input" id="clr-note" data-note maxlength="300" value="${esc(a.note || '')}"></div>
      </div>

      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-act="save">${icon('check')} บันทึกร่าง</button>
        <button type="button" class="btn btn-secondary" data-act="xlsx">${icon('download')} Excel</button>
        <button type="button" class="btn btn-primary" data-act="send">${icon('send')} ส่งเคลียร์</button>
      </div>
      <div class="hint">บันทึกร่าง = เก็บไว้กรอกต่อ ยังไม่ส่งให้บัญชี · Excel = ไฟล์ฟอร์ม Expenses Claim ของตารางนี้ · ส่งเคลียร์แล้วแก้ไม่ได้จนกว่าบัญชีจะตรวจ</div>
    </div>`;
    st.rc = receiptPicker($('[data-rcpick]', el), { max: 30, existing: a.paths || [] });
    st.sl = receiptPicker($('[data-slpick]', el), { max: 3, existing: a.returnPaths || [] });
    renumber(); paintSum();
  }

  // ─────────────── ตรวจ + รวบรวมข้อมูล ───────────────
  function problem() {
    const els = rowEls(); let n = 0;
    els.forEach((d) => d.classList.remove('err'));
    for (const d of els) {
      const r = readRow(d); if (blank(r)) continue; n++;
      const msg = !r.date ? 'ยังไม่ได้ใส่วันที่' : r.date > todayYMD() ? 'วันที่ยังมาไม่ถึง' : !r.desc ? (r.other ? 'ยังไม่ได้พิมพ์รายการ' : 'ยังไม่ได้เลือกรายการ') : !(r.amount > 0) ? 'ยังไม่ได้ใส่จำนวนเงิน' : '';
      if (msg) { d.classList.add('err'); d.scrollIntoView({ block: 'center', behavior: 'smooth' }); return `บรรทัดที่ ${n}: ${msg}`; }
    }
    return '';
  }
  async function payload(set) {
    const paths = await st.rc.uploadAll((n, all) => set(`อัปโหลดใบเสร็จ (${n}/${all})`));
    const back = r2(Number(st.a.amount) - total()) > 0;
    const returnPaths = back ? await st.sl.uploadAll((n, all) => set(`อัปโหลดสลิป (${n}/${all})`)) : [];
    return { rows: rows(), trip: $('[data-trip]', el).value.trim(), note: $('[data-note]', el).value.trim(), paths, returnPaths };
  }
  async function saveDraft(quiet) {
    await busy('กำลังบันทึกร่าง…', async (set) => {
      const d = await payload(set);
      set('กำลังบันทึกร่าง…');
      await api.rpc('pv_adv_save', { p_id: st.a.id, p_data: d });
    });
    dropLocal();
    if (!quiet) toast('บันทึกร่างแล้ว · กลับมากรอกต่อได้');
    await load();
  }
  async function send() {
    const err = problem(); if (err) { toast(err, 'bad'); return; }
    const a = st.a, list = rows(), t = total(), rem = r2(Number(a.amount) - t);
    if (list.some((r) => r.receipt) && !st.rc.count()) { toast('กรุณาแนบใบเสร็จ (มีบรรทัดที่ระบุว่ามีใบเสร็จ)', 'bad'); return; }
    const ok = await confirmBox({ title: list.length ? 'ส่งเคลียร์ advance' : 'ไม่ได้ใช้เงินเลย?',
      message: list.length
        ? `ใช้จริง ${money(t)} บาท (${list.length} รายการ) · รับ advance ${money(a.amount)} บาท\n${rem > 0 ? `คงเหลือ ต้องคืนบริษัท ${money(rem)} บาท` : rem < 0 ? `ใช้เกิน ${money(-rem)} บาท — หลังบัญชีตรวจผ่าน กด "เบิกส่วนเกิน" ในใบนี้` : 'ยอดตรงกับที่เบิก'}\n\nส่งแล้วแก้ไม่ได้จนกว่าบัญชีจะตรวจ`
        : `ยังไม่มีรายการในตาราง = ไม่ได้ใช้เงิน advance เลย\nต้องคืนบริษัททั้งหมด ${money(a.amount)} บาท`,
      ok: 'ส่งเคลียร์' });
    if (!ok) return;
    try {
      await busy('กำลังส่งเคลียร์…', async (set) => {
        const d = await payload(set);
        set('กำลังส่งเคลียร์…');
        await api.rpc('pv_adv_clear2', { p_id: a.id, p_data: { ...d, noSpend: !list.length } });
      });
      dropLocal();
      toast('ส่งเคลียร์แล้ว · รอบัญชีตรวจ');
      ctx.refreshBadges();
      ctx.go('/pv/view?id=' + encodeURIComponent(a.id));
    } catch (e) { toastError(e); }
  }
  async function excel() {
    try {
      await saveDraft(true);            // ไฟล์สร้างจากข้อมูลที่บันทึกไว้ → บันทึกร่างก่อนเสมอ
      await api.excel({ type: 'adv_clear', id: st.a.id });
    } catch (e) { toastError(e); }
  }

  el.innerHTML = skeleton(4);
  await load();
  const offs = [
    on(el, 'input', '[data-r], [data-trip], [data-note]', (e, t) => { t.closest('.clr-row')?.classList.remove('err'); changed(); }),
    on(el, 'change', '[data-r=sel]', (e, t) => {
      const o = $('[data-r=other]', t.closest('.clr-row'));
      o.classList.toggle('hidden', t.value !== OTHER);
      if (t.value === OTHER) o.focus();
      changed();
    }),
    on(el, 'click', '[data-rc]', (e, t) => { t.parentElement.querySelectorAll('[data-rc]').forEach((b) => b.classList.toggle('on', b === t)); changed(); }),
    on(el, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'add-row') {
        const last = rowEls().at(-1), d = last ? $('[data-r=date]', last).value : '';
        box().insertAdjacentHTML('beforeend', rowHtml({ date: d }));
        renumber(); changed();
        $('[data-r=sel]', rowEls().at(-1))?.focus();
      } else if (a === 'rm-row') {
        t.closest('.clr-row').remove();
        if (!rowEls().length) box().insertAdjacentHTML('beforeend', rowHtml({}));
        renumber(); changed();
      } else if (a === 'save') { try { await saveDraft(false); } catch (err) { toastError(err); } }
      else if (a === 'send') send();
      else if (a === 'xlsx') excel();
      else if (a === 'use-server') { e.preventDefault(); dropLocal(); el.innerHTML = skeleton(4); load(); }
    }),
  ];
  return () => offs.forEach((f) => f());
}
