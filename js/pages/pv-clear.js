// เคลียร์ advance — กรอกตารางตามฟอร์ม Expenses Claim: วันที่ / รายการ / จำนวนเงิน / มี-ไม่มีใบเสร็จ / หมายเหตุ
// (ก) มีใบ advance (?id=ADV-…): บันทึกร่างได้ · ยอดใช้จริง = ผลรวมของตาราง · ใช้เกินยอด advance ได้ (ส่วนเกินไปเบิกใบฟ้าหลังบัญชีตรวจ)
// แนบไฟล์รายบรรทัด (0079): บรรทัดที่ติ๊ก "มี" ใบเสร็จ ต้องแนบไฟล์ของบรรทัดนั้น · ช่องรวมด้านล่าง = "ไฟล์อื่นๆ" (ไม่บังคับ)
// Amount(Cur) / Currency (0080): ยอดเงินสกุลอื่น + สกุลเงิน อยู่ถัดจากช่องจำนวนเงิน (บาท) · ไม่บังคับ กรอกคู่กัน · ยอดรวมคิดจากช่องบาท
// (ข) ไม่มีใบ advance — จ่ายไปก่อน (?new=1 · ?id=CLR-… = ร่าง · ?id=PCN-… = ใบที่ถูกตีกลับ): ส่งแล้วระบบออกใบฟ้า 1 ใบตามยอดรวมของตาราง (0079)
import { api, money, fmtDate, esc, todayYMD, state } from '../core.js?v=10.4.29';
import { icon, toast, toastError, confirmBox, busy, receiptPicker, errorBox, skeleton, debounce, on, $, $$ } from '../ui.js?v=10.4.29';

const OTHER = '__other__';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pettyFund = () => { try { return localStorage.getItem('exion_petty_fund') || ''; } catch { return ''; } };   // กล่องที่เลือกไว้ในหน้าแรกเงินสดย่อย

export async function render(ctx) {
  const { el, query } = ctx;
  if (!query.id && !query.new) { ctx.go('/pv/adv'); return; }
  const myEmail = String(ctx.profile?.email || state.session?.email || '').toLowerCase();
  // id: เลขใบ advance / เลขร่าง / เลขใบฟ้าที่ถูกตีกลับ · ว่าง = เคลียร์แบบไม่มีใบ advance ที่ยังไม่เคยบันทึกร่าง
  const st = { id: query.id || '', a: null, meta: null, payees: [], rc: null, sl: null, seq: 0, local: false, hold: 0, sending: false };
  const lsKey = () => 'exion_advclr_' + (st.id || 'new:' + myEmail);
  const direct = () => !!st.a?.direct;
  // ฐานข้อมูลรองรับไฟล์รายบรรทัดแล้ว (รัน 0079) · ยังไม่รัน = ใช้ช่องแนบรวมแบบเดิม
  const RF = () => !!st.a?.rowFiles;
  const pick = new WeakMap();      // บรรทัด → ตัวแนบไฟล์ของบรรทัดนั้น
  // ฐานข้อมูลส่งรายการสกุลเงินมา (รัน 0080 แล้ว) → แสดงช่อง Amount / Currency
  const FX = () => Array.isArray(st.a?.curs) && st.a.curs.length > 0;

  async function load() {
    try {
      st.a = await api.rpc('get_pv_adv', { p_id: st.id || 'NEW' });
      if (!ctx.alive()) return;
      if (!st.a.canClear) { ctx.go('/pv/view?id=' + encodeURIComponent(st.a.id || st.id)); return; }
      if (direct() && !st.meta) {
        st.meta = await api.rpc('get_pv_form_meta', {}, { ttl: 60 }).catch(() => null);
        api.rpc('get_pv_payees', {}, { ttl: 300, quiet: true }).then((list) => {
          st.payees = list || [];
          const dl = $('#clr-payees', el); if (dl) dl.innerHTML = st.payees.map((p) => `<option value="${esc(p.payee)}"></option>`).join('');
        }).catch(() => {});
        if (!ctx.alive()) return;
      }
      ctx.setTitle(direct() ? (st.a.draft ? 'เคลียร์ advance' : 'แก้ไข ' + st.a.id) : 'เคลียร์ ' + st.a.id);
      // ที่กรอกค้างไว้ในเครื่องนี้ (ยังไม่ได้กดบันทึกร่าง) → เอากลับมาให้
      st.local = false;
      try {
        const d = JSON.parse(localStorage.getItem(lsKey()) || 'null');
        if (d && Array.isArray(d.rows)) {
          st.a = { ...st.a, rows: d.rows, trip: d.trip ?? st.a.trip, note: d.note ?? st.a.note };
          if (direct()) for (const k of ['jobNo', 'payee', 'payBank', 'payAccount']) if (d[k] != null) st.a[k] = d[k];
          if (direct() && st.a.draft && d.who) st.a.requesterEmail = d.who;
          st.local = true;
        }
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
      ${FX() ? `<div class="clr-c c-fx"><label class="clr-lab" for="clr-f-${k}">Amount(Cur) <span class="opt">เงินสกุลอื่น</span></label><input type="number" class="input" id="clr-f-${k}" data-r="fx" inputmode="decimal" step="0.01" min="0" value="${r.fx ?? ''}" aria-label="Amount(Cur) ยอดเงินสกุลอื่น"></div>
      <div class="clr-c c-cur"><label class="clr-lab" for="clr-c-${k}">Currency</label><select class="input" id="clr-c-${k}" data-r="cur" aria-label="Currency (สกุลเงิน)"><option value="">-</option>${[...new Set([...(st.a.curs || []), ...(r.cur ? [r.cur] : [])])].map((c) => `<option value="${esc(c)}" ${c === r.cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>` : ''}
      <div class="clr-c c-rc"><span class="clr-lab">ใบเสร็จ</span><div class="seg sm" role="group" aria-label="ใบเสร็จ"><button type="button" data-rc="1" class="${r.receipt === false ? '' : 'on'}">มี</button><button type="button" data-rc="0" class="${r.receipt === false ? 'on' : ''}">ไม่มี</button></div></div>
      <div class="clr-c c-rm"><label class="clr-lab" for="clr-m-${k}">หมายเหตุ <span class="opt">ไม่บังคับ</span></label><input class="input" id="clr-m-${k}" data-r="remark" maxlength="200" value="${esc(r.remark || '')}" aria-label="หมายเหตุ"></div>
      <button type="button" class="btn-icon sm clr-rm" data-act="rm-row" aria-label="ลบบรรทัด">${icon('trash')}</button>
      ${RF() ? `<div class="clr-c c-files ${r.receipt === false ? 'hidden' : ''}" data-rfbox><span class="clr-flab">ใบเสร็จของบรรทัดนี้</span><div data-rf></div></div>` : ''}
    </div>`;
  }
  // ตัวแนบไฟล์ของบรรทัด (สูงสุด 3 ไฟล์) · files = ไฟล์ที่แนบไว้แล้ว
  function mountRow(d, files = []) {
    const c = $('[data-rf]', d); if (!c) return;
    c.innerHTML = '';
    let ready = false;
    pick.set(d, receiptPicker(c, { max: 3, existing: files, onChange: () => { if (ready) { d.classList.remove('err'); changed(); } } }));
    ready = true;
  }
  const box = () => $('[data-rows]', el);
  const rowEls = () => $$('.clr-row', box());
  const readRow = (d) => {
    const sel = $('[data-r=sel]', d).value, av = $('[data-r=amount]', d).value;
    const receipt = $('[data-rc].on', d)?.dataset.rc !== '0', pk = pick.get(d);
    return { date: $('[data-r=date]', d).value, desc: sel === OTHER ? $('[data-r=other]', d).value.trim() : sel,
      amount: av === '' ? null : r2(av), receipt, remark: $('[data-r=remark]', d).value.trim(), other: sel === OTHER,
      ...(FX() ? { fx: $('[data-r=fx]', d).value === '' ? null : r2($('[data-r=fx]', d).value), cur: $('[data-r=cur]', d).value } : {}),
      // files = ไฟล์ที่อัปโหลดแล้ว (ร่างในเครื่องจำได้) · nfile = รวมไฟล์ที่เพิ่งเลือก ยังไม่อัปโหลด
      ...(RF() ? { files: receipt && pk ? pk.kept() : [], nfile: receipt && pk ? pk.count() : 0 } : {}) };
  };
  // บรรทัดว่าง = ไม่นับ ไม่ส่ง (มีแค่วันที่ที่ระบบเติมให้ตอนกดเพิ่มบรรทัด ก็ถือว่าว่าง)
  const blank = (r) => !r.desc && r.amount == null && !r.remark && !r.other && !r.nfile && r.fx == null && !r.cur;
  const rows = () => rowEls().map(readRow).filter((r) => !blank(r)).map(({ other, nfile, ...r }) => r);
  const total = () => r2(rows().reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const renumber = () => rowEls().forEach((d, i) => { $('[data-no]', d).textContent = i + 1; });
  // หัวฟอร์มของแบบไม่มีใบ advance (ข้อมูลที่ใบฟ้าต้องใช้ · แบบมีใบ advance ดึงจากใบ advance)
  const hv = (k) => $(`[data-h="${k}"]`, el)?.value.trim() || '';
  const who = () => $('[data-who]', el)?.value || '';
  const head = () => ({ requesterEmail: st.a.draft ? who() : '', jobNo: hv('jobNo'), payee: hv('payee'), payBank: hv('payBank'), payAccount: hv('payAccount') });

  function paintSum() {
    const a = st.a, n = rows().length, t = total(), rem = r2(Number(a.amount) - t);
    if (direct()) {
      $('[data-sum]', el).innerHTML = `
        <span class="k">รวมที่จ่ายไป (${n} รายการ)</span><span class="v">${money(t)}</span>
        <span class="k tot">ยอดใบฟ้าที่จะเบิก</span><span class="v tot">${money(t)}</span>`;
      return;
    }
    $('[data-sum]', el).innerHTML = `
      <span class="k">รับ advance</span><span class="v">${money(a.amount)}</span>
      <span class="k">ใช้จริง (${n} รายการ)</span><span class="v">${money(t)}</span>
      <span class="k tot ${rem < 0 ? 'over' : rem > 0 ? 'back' : ''}">${rem < 0 ? 'ใช้เกิน' : rem > 0 ? 'คงเหลือ ต้องคืนบริษัท' : 'คงเหลือ'}</span><span class="v tot ${rem < 0 ? 'over' : rem > 0 ? 'back' : ''}">${money(Math.abs(rem))}</span>`;
    $('[data-over]', el).classList.toggle('hidden', !(rem < 0));
    $('[data-retbox]', el).classList.toggle('hidden', !(rem > 0));
  }
  const saveLocal = debounce(() => {
    if (Date.now() < st.hold || !box()?.isConnected) return;      // เพิ่งบันทึกร่าง / ส่งไป หรือออกจากหน้านี้แล้ว → ไม่เขียนร่างในเครื่องกลับมา
    try {
      localStorage.setItem(lsKey(), JSON.stringify({ rows: rows(),
        trip: $('[data-trip]', el)?.value || '', note: $('[data-note]', el)?.value || '',
        ...(direct() ? { jobNo: hv('jobNo'), payee: hv('payee'), payBank: hv('payBank'), payAccount: hv('payAccount'), who: who() } : {}) }));
    } catch {}
  }, 400);
  const dropLocal = () => { st.hold = Date.now() + 1500; try { localStorage.removeItem(lsKey()); } catch {} };
  const changed = () => { paintSum(); saveLocal(); };

  // หัวการ์ด: แบบมีใบ advance = ข้อมูลใบ · แบบไม่มีใบ = ช่องที่ใบฟ้าต้องใช้
  function headCard() {
    const a = st.a;
    const localBar = st.local ? `<div class="alert neutral">${icon('info')}<div>เอาข้อมูลที่กรอกค้างไว้ในเครื่องนี้กลับมาให้แล้ว (ยังไม่ได้บันทึกร่าง) · <a href="#" data-act="use-server">${direct() && !st.id ? 'ล้างแล้วเริ่มใหม่' : 'ใช้ข้อมูลที่บันทึกไว้ในระบบแทน'}</a></div></div>` : '';
    const trip = `<div class="field${direct() ? ' span-2' : ''}" style="margin:0"><label class="${direct() ? 'req' : ''}" for="clr-trip">Trip <span class="opt">${direct() ? 'ชื่องาน / สถานที่ · ขึ้นในใบฟ้าและ Excel' : 'ชื่องาน / สถานที่ · ขึ้นหัวฟอร์ม Excel'}</span></label><input class="input" id="clr-trip" data-trip maxlength="120" value="${esc(a.trip || '')}"></div>`;
    if (!direct()) {
      return `<div class="card pad stack-sm">
        <div class="flex between wrap gap-12">
          <div class="stack-sm" style="gap:4px"><b class="mono text-lg">${esc(a.id)}</b><div class="text-sm muted">${esc(a.requesterName)}${a.jobNo ? ' · Job ' + esc(a.jobNo) : ''}${a.paidAt ? ' · รับเงิน ' + fmtDate(a.paidAt) : ''}</div></div>
          <div class="text-right"><div class="callout-amount"><span class="v amount">${money(a.amount)}</span><span class="muted">บาท</span></div>${a.advDue ? `<div class="text-sm muted">เคลียร์ภายใน ${fmtDate(a.advDue)}</div>` : ''}</div>
        </div>
        ${a.status === 'Returned' && a.returnRemark ? `<div class="alert bad">${icon('alert')}<div><b>บัญชีตีกลับการเคลียร์:</b> ${esc(a.returnRemark)}</div></div>` : ''}
        ${localBar}
        ${trip}
      </div>`;
    }
    const m = st.meta || {}, me = m.me || {};
    const staff = (m.staff || []).filter((x) => x.email !== me.email);
    const depts = [...new Set(staff.map((x) => x.department || '(ไม่ระบุ)'))].sort();
    const cur = String(a.requesterEmail || '').toLowerCase();
    const whoBox = a.draft && m.canBehalf && staff.length
      ? `<div class="field span-2" style="margin:0"><label for="clr-who">เบิกให้</label><select class="input" id="clr-who" data-who>
          <option value="">ตัวเอง · ${esc(me.name || '')}</option>
          ${depts.map((d) => `<optgroup label="${esc(d)}">${staff.filter((x) => (x.department || '(ไม่ระบุ)') === d).map((x) => `<option value="${esc(x.email)}" ${x.email === cur ? 'selected' : ''}>${esc(x.name)}${x.fullName && x.fullName !== x.name ? ' · ' + esc(x.fullName) : ''}</option>`).join('')}</optgroup>`).join('')}</select>
          <div class="hint">กรอกแทนคนอื่นได้ — ใบเป็นของคนที่เลือก และขึ้นว่ากรอกโดยคุณ</div></div>`
      : '';
    return `<div class="card pad stack-sm">
      <div class="stack-sm" style="gap:4px"><div class="flex wrap gap-8" style="align-items:center"><b class="text-lg${a.draft ? '' : ' mono'}">${a.draft ? 'เคลียร์ advance' : esc(a.id)}</b><span class="badge b-info plain">ไม่มีใบ advance</span></div>
        <div class="text-sm muted">${a.draft ? 'จ่ายไปก่อน ไม่ได้ขอ advance ไว้ · กรอกรายการที่จ่ายจริง ส่งแล้วระบบออกใบฟ้า 1 ใบตามยอดรวม เข้าสายอนุมัติทันที'
          : `${esc(a.requesterName)} · แก้ตารางแล้วกดส่งใหม่ ใบจะเริ่มอนุมัติใหม่ตั้งแต่ขั้นแรก (เลขเดิม ${esc(a.id)})`}</div></div>
      ${!a.draft && a.returnRemark ? `<div class="alert bad">${icon('alert')}<div><b>ถูกตีกลับ:</b> ${esc(a.returnRemark)}</div></div>` : ''}
      ${localBar}
      <div class="form-grid two">
        ${whoBox}
        ${trip}
        <div class="field span-2" style="margin:0"><label class="req" for="clr-job">Job No.</label>
          <div class="flex gap-8"><input class="input grow" id="clr-job" data-h="jobNo" maxlength="50" value="${esc(a.jobNo || '')}">
            <button type="button" class="btn btn-ghost btn-sm nowrap" data-act="job-none" title="ไม่มี Job · ใช้ Job กลาง">ไม่มี Job (Z-NONE)</button></div></div>
        <div class="field span-2" style="margin:0"><label class="req" for="clr-payee">จ่ายให้ <span class="opt">ชื่อคนรับเงินคืน</span></label>
          <input class="input" id="clr-payee" data-h="payee" maxlength="150" list="clr-payees" autocomplete="off" value="${esc(a.payee || '')}">
          <datalist id="clr-payees">${st.payees.map((p) => `<option value="${esc(p.payee)}"></option>`).join('')}</datalist><div class="hint hidden" data-payeehint></div></div>
        <div class="field" style="margin:0"><label class="req" for="clr-bank">ธนาคาร</label><input class="input" id="clr-bank" data-h="payBank" maxlength="100" value="${esc(a.payBank || '')}"></div>
        <div class="field" style="margin:0"><label class="req" for="clr-acc">เลขบัญชี</label><input class="input" id="clr-acc" data-h="payAccount" maxlength="50" inputmode="numeric" value="${esc(a.payAccount || '')}"></div>
      </div>
    </div>`;
  }

  function paint() {
    const a = st.a, dr = direct();
    const list = (a.rows || []).length ? a.rows : [{}];
    st.seq = 0;
    el.innerHTML = `
    <div class="stack">
      ${headCard()}

      <div class="card pad stack-sm ${FX() ? 'clr-fx' : ''}">
        <div class="flex between wrap"><b>${dr ? 'รายการที่จ่ายจริง' : 'รายการที่ใช้จริง'}</b><span class="text-sm muted">กรอกทีละรายการตามใบเสร็จ${RF() ? ' · บรรทัดที่ติ๊ก "มี" ต้องแนบรูปใบเสร็จของบรรทัดนั้น' : ''}</span></div>
        ${FX() ? '<div class="hint">Amount(Cur) / Currency กรอกเฉพาะรายการที่จ่ายเป็นเงินสกุลอื่น · ยอดรวมคิดจากช่องจำนวนเงิน (บาท)</div>' : ''}
        <div class="clr-head"><span></span><span>วันที่</span><span>รายการ</span><span>จำนวนเงิน (บาท)</span>${FX() ? '<span>Amount(Cur)</span><span>Currency</span>' : ''}<span>ใบเสร็จ</span><span>หมายเหตุ</span><span></span></div>
        <div class="stack-sm" data-rows>${list.map(rowHtml).join('')}</div>
        <div><button type="button" class="btn btn-secondary btn-sm" data-act="add-row">${icon('plus', 'sm')} เพิ่มบรรทัด</button></div>
      </div>

      <div class="card pad stack-sm">
        <div class="clr-sum" data-sum></div>
        ${dr ? '' : `<div class="alert warn hidden" data-over>${icon('info')}<div>ใช้เกินยอด advance — ส่งเคลียร์ได้ตามปกติ · หลังบัญชีตรวจผ่าน เปิดใบนี้แล้วกด <b>เบิกส่วนเกิน</b> (ใบฟ้าปกติ ไม่ใช่ advance)</div></div>`}
        <div class="field" style="margin:0"><label>${RF() ? 'ไฟล์อื่นๆ <span class="opt">ไม่บังคับ · เอกสารที่ไม่ผูกกับบรรทัดไหน · แนบได้ 30 ไฟล์</span>' : 'ใบเสร็จ <span class="opt">แนบได้ 30 ไฟล์ · ไฟล์ที่แนบไว้แล้วไม่ต้องแนบใหม่</span>'}</label><div data-rcpick></div></div>
        ${dr ? '' : `<div class="field hidden" style="margin:0" data-retbox><label>สลิปโอนคืนเงินที่เหลือ <span class="opt">ไม่บังคับ · คืนเป็นเงินสดไม่ต้องแนบ</span></label><div data-slpick></div></div>`}
        <div class="field" style="margin:0"><label for="clr-note">${dr ? 'หมายเหตุ <span class="opt">ไม่บังคับ · ขึ้นในใบฟ้า</span>' : 'หมายเหตุถึงบัญชี <span class="opt">ไม่บังคับ</span>'}</label><input class="input" id="clr-note" data-note maxlength="300" value="${esc(a.note || '')}"></div>
      </div>

      <div class="btn-row">
        ${dr && !a.draft ? '' : `<button type="button" class="btn btn-secondary" data-act="save">${icon('check')} บันทึกร่าง</button>
        <button type="button" class="btn btn-secondary" data-act="xlsx">${icon('download')} Excel</button>`}
        <button type="button" class="btn btn-primary" data-act="send">${icon('send')} ${dr && !a.draft ? 'ส่งใหม่' : 'ส่งเคลียร์'}</button>
      </div>
      <div class="hint">${dr ? (a.draft ? 'บันทึกร่าง = เก็บไว้กรอกต่อ ยังไม่ส่ง · Excel = ไฟล์ฟอร์ม Expenses Claim ของตารางนี้ · ส่งเคลียร์ = ออกใบฟ้าตามยอดรวม เข้าสายอนุมัติ' : 'ยอดใบฟ้า = ผลรวมของตาราง · ไฟล์ที่แนบไว้แล้วไม่ต้องแนบใหม่')
        : 'บันทึกร่าง = เก็บไว้กรอกต่อ ยังไม่ส่งให้บัญชี · Excel = ไฟล์ฟอร์ม Expenses Claim ของตารางนี้ · ส่งเคลียร์แล้วแก้ไม่ได้จนกว่าบัญชีจะตรวจ'}</div>
    </div>`;
    st.rc = receiptPicker($('[data-rcpick]', el), { max: 30, existing: a.paths || [] });
    st.sl = dr ? null : receiptPicker($('[data-slpick]', el), { max: 3, existing: a.returnPaths || [] });
    rowEls().forEach((d, i) => mountRow(d, list[i]?.files || []));
    renumber(); paintSum();
  }

  // ─────────────── ตรวจ + รวบรวมข้อมูล ───────────────
  function problem() {
    const els = rowEls(); let n = 0;
    els.forEach((d) => d.classList.remove('err'));
    for (const d of els) {
      const r = readRow(d); if (blank(r)) continue; n++;
      const msg = !r.date ? 'ยังไม่ได้ใส่วันที่' : r.date > todayYMD() ? 'วันที่ยังมาไม่ถึง' : !r.desc ? (r.other ? 'ยังไม่ได้พิมพ์รายการ' : 'ยังไม่ได้เลือกรายการ') : !(r.amount > 0) ? 'ยังไม่ได้ใส่จำนวนเงิน (บาท)'
        : FX() && r.fx != null && !(r.fx > 0) ? 'ช่อง Amount(Cur) ต้องมากกว่า 0'
        : FX() && (r.fx != null) !== !!r.cur ? 'กรอก Amount(Cur) กับ Currency ให้ครบคู่ (จ่ายเป็นเงินบาท ให้เว้นว่างทั้งสองช่อง)'
        : RF() && r.receipt && !r.nfile ? 'ติ๊กว่ามีใบเสร็จ แต่ยังไม่ได้แนบรูปใบเสร็จของบรรทัดนี้ (ไม่มีใบเสร็จให้กด "ไม่มี")' : '';
      if (msg) { d.classList.add('err'); d.scrollIntoView({ block: 'center', behavior: 'smooth' }); return `บรรทัดที่ ${n}: ${msg}`; }
    }
    return '';
  }
  // ช่องหัวฟอร์มที่ใบฟ้าบังคับ (เฉพาะแบบไม่มีใบ advance)
  function headProblem() {
    const need = [['[data-trip]', $('[data-trip]', el).value.trim(), 'กรุณาใส่ชื่อ Trip'], ['[data-h=jobNo]', hv('jobNo'), 'กรุณาใส่ Job No. (ไม่มี Job กด "ไม่มี Job (Z-NONE)")'],
      ['[data-h=payee]', hv('payee'), 'กรุณาใส่ชื่อผู้รับเงิน (จ่ายให้)'], ['[data-h=payBank]', hv('payBank'), 'กรุณาใส่ธนาคาร'], ['[data-h=payAccount]', hv('payAccount'), 'กรุณาใส่เลขบัญชี']];
    const miss = need.find(([, v]) => !v);
    if (!miss) return '';
    const inp = $(miss[0], el); inp?.scrollIntoView({ block: 'center', behavior: 'smooth' }); inp?.focus({ preventScroll: true });
    return miss[2];
  }
  // ตาราง + อัปโหลดไฟล์ของแต่ละบรรทัด · อัปแล้วนับเป็นไฟล์เดิมของบรรทัด (ส่งไม่ผ่านแล้วกดใหม่ ไม่ต้องอัปซ้ำ)
  async function rowsUp(set) {
    const out = [];
    for (const d of rowEls()) {
      const { other, nfile, ...r } = readRow(d);
      if (blank({ ...r, other, nfile })) continue;
      const pk = pick.get(d);
      if (RF() && r.receipt && pk) {
        const no = out.length + 1;
        r.files = await pk.uploadAll((n, all) => set(`อัปโหลดใบเสร็จ บรรทัดที่ ${no} (${n}/${all})`));
        mountRow(d, r.files);
      }
      out.push(r);
    }
    return out;
  }
  async function payload(set) {
    const list = await rowsUp(set);
    const paths = await st.rc.uploadAll((n, all) => set(`อัปโหลด${RF() ? 'ไฟล์อื่นๆ' : 'ใบเสร็จ'} (${n}/${all})`));
    const base = { rows: list, trip: $('[data-trip]', el).value.trim(), note: $('[data-note]', el).value.trim(), paths };
    if (direct()) return { ...base, ...head(), fundId: pettyFund() || st.meta?.fund?.fundId || '' };
    const back = r2(Number(st.a.amount) - total()) > 0;
    const returnPaths = back ? await st.sl.uploadAll((n, all) => set(`อัปโหลดสลิป (${n}/${all})`)) : [];
    return { ...base, returnPaths };
  }
  // ไฟล์ที่อัปโหลดไปแล้ว → นับเป็นไฟล์เดิม (ถ้าส่งไม่ผ่านแล้วกดใหม่ ไม่ต้องอัปซ้ำ)
  function keepUploaded(paths) {
    const c = $('[data-rcpick]', el); if (!c) return;
    c.innerHTML = ''; st.rc = receiptPicker(c, { max: 30, existing: paths });
  }
  async function saveDraft(quiet) {
    await busy('กำลังบันทึกร่าง…', async (set) => {
      const d = await payload(set);
      set('กำลังบันทึกร่าง…');
      if (direct()) {
        keepUploaded(d.paths);
        const r = await api.rpc('pv_clr_save', { p_id: st.id, p_data: d });
        dropLocal();
        if (!st.id && r?.id) {     // ร่างใหม่ได้เลขแล้ว → เปลี่ยนที่อยู่หน้าให้เปิดซ้ำ / รีเฟรชแล้วเจอร่างนี้
          st.id = r.id;
          try { history.replaceState(null, '', location.pathname + location.search + '#/pv/clear?id=' + encodeURIComponent(r.id)); } catch {}
        }
      } else await api.rpc('pv_adv_save', { p_id: st.a.id, p_data: d });
    });
    dropLocal();
    if (!quiet) toast('บันทึกร่างแล้ว · กลับมากรอกต่อได้');
    await load();
  }
  async function sendDirect() {
    const a = st.a;
    const err = headProblem() || problem(); if (err) { toast(err, 'bad'); return; }
    const list = rows(), t = total(), h = head(), trip = $('[data-trip]', el).value.trim();
    if (!list.length) { toast('กรุณากรอกตารางอย่างน้อย 1 บรรทัด', 'bad'); return; }
    if (!RF() && list.some((r) => r.receipt) && !st.rc.count()) { toast('กรุณาแนบใบเสร็จ (มีบรรทัดที่ระบุว่ามีใบเสร็จ)', 'bad'); return; }
    // กันเบิกซ้ำ: ผู้รับเงิน + ยอดเท่ากันใน 60 วัน (เช่น เคยส่งทริปนี้เป็นใบฟ้าปกติไปแล้ว)
    try {
      const dup = await api.rpc('get_pv_dupes', { p_job: h.jobNo, p_po: '', p_payee: h.payee, p_amount: t, p_exclude: a.draft ? '' : a.id }, { quiet: true });
      if (dup?.length && !(await confirmBox({ title: 'อาจซ้ำกับใบที่มีอยู่แล้ว',
        message: dup.map((x) => `${x.id} · ${x.reason} · ${x.requesterName}${x.amount != null ? ` · ${money(x.amount)} บาท` : ''}`).join('\n') + '\n\nตรวจแล้วไม่ซ้ำ กดส่งต่อได้', ok: 'ส่งต่อ' }))) return;
    } catch { /* เช็คไม่ได้ ไม่ขวางการส่ง */ }
    const ok = await confirmBox({ title: a.draft ? 'ส่งเคลียร์ advance' : 'ส่งใหม่',
      message: `รวมที่จ่ายไป ${money(t)} บาท (${list.length} รายการ)\nระบบจะ${a.draft ? 'ออกใบฟ้า 1 ใบ' : 'แก้ใบฟ้า ' + a.id} ยอด ${money(t)} บาท\nรายการ: Clear advance trip · ${trip}\nจ่ายให้: ${h.payee} · ${h.payBank} ${h.payAccount}\n\nส่งแล้วใบเข้าสายอนุมัติทันที`,
      ok: a.draft ? 'ส่งเคลียร์' : 'ส่งใหม่' });
    if (!ok) return;
    try {
      const res = await busy('กำลังส่ง…', async (set) => {
        const d = await payload(set);
        keepUploaded(d.paths);
        set('กำลังออกใบฟ้า…');
        return api.rpc('pv_clr_submit', { p_id: st.id, p_data: d });
      });
      dropLocal();
      toast(`${a.draft ? 'ส่งแล้ว' : 'ส่งใหม่แล้ว'} · ใบฟ้า ${res.id}`);
      ctx.refreshBadges();
      ctx.go('/pv/view?id=' + encodeURIComponent(res.id));
    } catch (e) { toastError(e); }
  }
  async function sendAdv() {
    const err = problem(); if (err) { toast(err, 'bad'); return; }
    const a = st.a, list = rows(), t = total(), rem = r2(Number(a.amount) - t);
    if (!RF() && list.some((r) => r.receipt) && !st.rc.count()) { toast('กรุณาแนบใบเสร็จ (มีบรรทัดที่ระบุว่ามีใบเสร็จ)', 'bad'); return; }
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
  async function send() {
    if (st.sending) return;      // กันกดส่งซ้ำ (ระหว่างเช็คใบซ้ำ / อัปโหลด)
    st.sending = true;
    try { await (direct() ? sendDirect() : sendAdv()); } finally { st.sending = false; }
  }
  async function excel() {
    try {
      await saveDraft(true);            // ไฟล์สร้างจากข้อมูลที่บันทึกไว้ → บันทึกร่างก่อนเสมอ
      await api.excel({ type: 'adv_clear', id: direct() ? st.id : st.a.id });
    } catch (e) { toastError(e); }
  }
  // ผู้รับเงินที่เคยจ่าย → เติมธนาคาร / เลขบัญชีให้ (เฉพาะช่องที่ยังว่าง หรือยังเป็นค่าที่ระบบเติมให้)
  function fillPayee() {
    const hit = st.payees.find((p) => String(p.payee || '').toLowerCase() === hv('payee').toLowerCase());
    const b = $('[data-h=payBank]', el), a = $('[data-h=payAccount]', el), h = $('[data-payeehint]', el);
    if (!b || !a) return;
    let filled = false;
    for (const [inp, v] of [[b, hit?.bank || ''], [a, hit?.account || '']]) {
      if (inp.value && inp.value !== inp.dataset.auto) continue;
      inp.value = v; inp.dataset.auto = v; if (v) filled = true;
    }
    if (h) { h.textContent = filled ? 'เติมธนาคาร / เลขบัญชีจากใบก่อนหน้าให้แล้ว — ตรวจให้ถูกก่อนส่ง' : ''; h.classList.toggle('hidden', !filled); }
    changed();
  }

  el.innerHTML = skeleton(4);
  await load();
  const offs = [
    on(el, 'input', '[data-r], [data-trip], [data-note], [data-h]', (e, t) => { t.closest('.clr-row')?.classList.remove('err'); changed(); }),
    on(el, 'change', '[data-r=sel]', (e, t) => {
      const o = $('[data-r=other]', t.closest('.clr-row'));
      o.classList.toggle('hidden', t.value !== OTHER);
      if (t.value === OTHER) o.focus();
      changed();
    }),
    on(el, 'change', '[data-who], [data-r=cur]', (e, t) => { t.closest('.clr-row')?.classList.remove('err'); changed(); }),
    on(el, 'change', '[data-h=payee]', () => fillPayee()),
    on(el, 'click', '[data-rc]', (e, t) => {
      t.parentElement.querySelectorAll('[data-rc]').forEach((b) => b.classList.toggle('on', b === t));
      const row = t.closest('.clr-row'); row.classList.remove('err');
      $('[data-rfbox]', row)?.classList.toggle('hidden', t.dataset.rc === '0');     // ไม่มีใบเสร็จ → ซ่อนช่องแนบของบรรทัด
      changed();
    }),
    on(el, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'add-row') {
        const last = rowEls().at(-1), d = last ? $('[data-r=date]', last).value : '';
        box().insertAdjacentHTML('beforeend', rowHtml({ date: d }));
        mountRow(rowEls().at(-1));
        renumber(); changed();
        $('[data-r=sel]', rowEls().at(-1))?.focus();
      } else if (a === 'rm-row') {
        t.closest('.clr-row').remove();
        if (!rowEls().length) { box().insertAdjacentHTML('beforeend', rowHtml({})); mountRow(rowEls().at(-1)); }
        renumber(); changed();
      } else if (a === 'save') { try { await saveDraft(false); } catch (err) { toastError(err); } }
      else if (a === 'send') send();
      else if (a === 'xlsx') excel();
      else if (a === 'job-none') { const j = $('[data-h=jobNo]', el); j.value = 'Z-NONE'; changed(); }
      else if (a === 'use-server') { e.preventDefault(); dropLocal(); el.innerHTML = skeleton(4); load(); }
    }),
  ];
  return () => offs.forEach((f) => f());
}
