// เคลียร์ advance — กรอกตารางตามฟอร์ม Expenses Claim แล้วระบบออกใบฟ้า (ใบเคลียร์) ตามยอดใช้จริง (0082)
//  · มีใบ advance (?id=ADV-…): ใบฟ้าหักลบ advance ให้ → ใช้เกิน = บริษัทจ่ายเพิ่ม · ใช้ไม่ถึง = โอนคืนบริษัท (แนบสลิปได้) · บันทึกร่างบนใบ advance
//  · ไม่มีใบ advance (?new=1 · ?id=CLR-… = ร่าง): จ่ายไปก่อน → ใบฟ้าเท่ายอดรวม
//  · ใบเคลียร์ที่ถูกตีกลับ (?id=PCN-…): แก้ตารางแล้วส่งใหม่ (เลขเดิม)
// ตาราง: เริ่มต้น 20 บรรทัดแบบกระชับ (บรรทัดว่างไม่นับ) · จอเล็กย่อเป็นบรรทัดเดียว แตะเพื่อกรอก · ใบเสร็จ = ติ๊กมี / ไม่มี (ไม่บังคับแนบไฟล์)
// ช่อง Amount(Cur) / Currency (0080): ยอดเงินสกุลอื่น ไม่บังคับ กรอกคู่กัน · ยอดรวมคิดจากช่องบาท
// วางจาก Excel: ปุ่มใต้ตาราง (หรือกดวางหลายช่องลงในตารางตรง ๆ) → ดูตัวอย่างก่อน แล้วต่อท้ายบรรทัดที่กรอกไว้ (pv-paste.js)
import { api, money, fmtDate, esc, todayYMD, state } from '../core.js?v=10.4.32';
import { icon, toast, toastError, confirmBox, busy, receiptPicker, errorBox, skeleton, debounce, on, sheet, $, $$ } from '../ui.js?v=10.4.32';
import { clrSummaryHtml } from './pv-common.js?v=10.4.32';
import { parsePaste } from './pv-paste.js?v=10.4.32';

const OTHER = '__other__', MIN_ROWS = 20, MAX_ROWS = 100;      // MAX_ROWS = เพดานของฐานข้อมูล (app.pv_adv_rows)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pettyFund = () => { try { return localStorage.getItem('exion_petty_fund') || ''; } catch { return ''; } };   // กล่องที่เลือกไว้ในหน้าแรกเงินสดย่อย
const dmy = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}` : ''; };

export async function render(ctx) {
  const { el, query } = ctx;
  if (!query.id && !query.new) { ctx.go('/pv/adv'); return; }
  const myEmail = String(ctx.profile?.email || state.session?.email || '').toLowerCase();
  // id: เลขใบ advance / เลขร่าง / เลขใบเคลียร์ที่ถูกตีกลับ · ว่าง = เคลียร์แบบไม่มีใบ advance ที่ยังไม่เคยบันทึกร่าง
  const st = { id: query.id || '', a: null, meta: null, payees: [], rc: null, sl: null, seq: 0, local: false, hold: 0, sending: false };
  const lsKey = () => 'exion_advclr_' + (st.id || 'new:' + myEmail);
  const direct = () => !!st.a?.direct;                       // ไม่มีใบ advance
  const advMode = () => !st.a?.clr;                          // เปิดจากเลขใบ advance (ร่างเก็บบนใบ advance)
  const editVoucher = () => !!st.a?.clr && !st.a?.draft;     // ใบเคลียร์ที่ถูกตีกลับ
  const flow2 = () => st.a?.flow === 2;                      // ฐานข้อมูลรัน 0082 แล้ว (เคลียร์ = ออกใบฟ้าทุกกรณี)
  const FX = () => Array.isArray(st.a?.curs) && st.a.curs.length > 0;
  const advAmt = () => (direct() ? 0 : Number(st.a?.amount) || 0);

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
      ctx.setTitle(editVoucher() ? 'แก้ไข ' + st.a.id : direct() ? 'เคลียร์ advance' : 'เคลียร์ ' + st.a.id);
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

  // ─────────────── ตาราง ───────────────
  function rowHtml(r = {}) {
    const k = ++st.seq, items = st.a.items || [];
    const isOther = !!r.desc && !items.includes(r.desc);
    const sel = isOther ? OTHER : (r.desc || '');
    const files = Array.isArray(r.files) ? r.files : [];
    return `<div class="cg-row" data-row="${k}"${files.length ? ` data-files="${esc(JSON.stringify(files))}"` : ''}>
      <button type="button" class="cg-sum" data-act="row-open" aria-expanded="false"><span class="cg-no" data-no></span><span class="cg-txt" data-sumtxt></span><span class="cg-amt amount" data-sumamt></span>${icon('chevron-down', 'sm')}</button>
      <div class="cg-fields">
        <div class="cg-no d" data-no></div>
        <div class="cg-c c-date"><label class="cg-lab" for="cg-d-${k}">วันที่</label><input type="date" class="input" id="cg-d-${k}" data-r="date" max="${todayYMD()}" value="${esc(r.date || '')}" aria-label="วันที่"></div>
        <div class="cg-c c-desc"><label class="cg-lab" for="cg-s-${k}">รายการ</label>
          <select class="input" id="cg-s-${k}" data-r="sel" aria-label="รายการ"><option value="">เลือกรายการ</option>${items.map((i) => `<option value="${esc(i)}" ${sel === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}<option value="${OTHER}" ${sel === OTHER ? 'selected' : ''}>อื่นๆ (พิมพ์เอง)</option></select>
          <input class="input ${isOther ? '' : 'hidden'}" data-r="other" maxlength="120" aria-label="รายการ (พิมพ์เอง)" value="${isOther ? esc(r.desc) : ''}"></div>
        <div class="cg-c c-amt"><label class="cg-lab" for="cg-a-${k}">จำนวนเงิน (บาท)</label><input type="number" class="input r" id="cg-a-${k}" data-r="amount" inputmode="decimal" step="0.01" min="0" value="${r.amount ?? ''}" aria-label="จำนวนเงิน (บาท)"></div>
        ${FX() ? `<div class="cg-c c-fx"><label class="cg-lab" for="cg-f-${k}">Amount(Cur)</label><input type="number" class="input r" id="cg-f-${k}" data-r="fx" inputmode="decimal" step="0.01" min="0" value="${r.fx ?? ''}" aria-label="Amount(Cur) ยอดเงินสกุลอื่น"></div>
        <div class="cg-c c-cur"><label class="cg-lab" for="cg-c-${k}">Currency</label><select class="input" id="cg-c-${k}" data-r="cur" aria-label="Currency (สกุลเงิน)"><option value="">-</option>${[...new Set([...(st.a.curs || []), ...(r.cur ? [r.cur] : [])])].map((c) => `<option value="${esc(c)}" ${c === r.cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>` : ''}
        <label class="cg-c c-rc cg-chk"><input type="checkbox" data-r="rc" ${r.receipt === false ? '' : 'checked'} aria-label="มีใบเสร็จ"><span>มีใบเสร็จ</span></label>
        <div class="cg-c c-rm"><label class="cg-lab" for="cg-m-${k}">หมายเหตุ</label><input class="input" id="cg-m-${k}" data-r="remark" maxlength="200" value="${esc(r.remark || '')}" aria-label="หมายเหตุ"></div>
        <button type="button" class="btn-icon sm cg-x" data-act="rm-row" aria-label="ล้างบรรทัดนี้" title="ล้างบรรทัดนี้">${icon('x', 'sm')}</button>
      </div>
    </div>`;
  }
  const box = () => $('[data-rows]', el);
  const rowEls = () => $$('.cg-row', box());
  const readRow = (d) => {
    const sel = $('[data-r=sel]', d).value, av = $('[data-r=amount]', d).value;
    let files = []; try { files = JSON.parse(d.dataset.files || '[]'); } catch {}
    return { date: $('[data-r=date]', d).value, desc: sel === OTHER ? $('[data-r=other]', d).value.trim() : sel,
      amount: av === '' ? null : r2(av), receipt: $('[data-r=rc]', d).checked, remark: $('[data-r=remark]', d).value.trim(), other: sel === OTHER,
      ...(FX() ? { fx: $('[data-r=fx]', d).value === '' ? null : r2($('[data-r=fx]', d).value), cur: $('[data-r=cur]', d).value } : {}),
      ...(files.length ? { files } : {}) };      // files = ไฟล์รายบรรทัดของข้อมูลเดิม (เก็บไว้ตามเดิม ไม่ได้แนบเพิ่มที่นี่แล้ว)
  };
  // บรรทัดว่าง = ไม่นับ ไม่ส่ง (มีแค่วันที่ ก็ถือว่าว่าง)
  const blank = (r) => !r.desc && r.amount == null && !r.remark && !r.other && r.fx == null && !r.cur;
  const rows = () => rowEls().map(readRow).filter((r) => !blank(r)).map(({ other, ...r }) => r);
  const total = () => r2(rows().reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // บรรทัดย่อ (จอเล็ก): เลข · วันที่ · รายการ · ยอด
  function sumLine(d, i) {
    const r = readRow(d), empty = blank(r);
    $$('[data-no]', d).forEach((n) => { n.textContent = i + 1; });
    $('[data-sumtxt]', d).innerHTML = empty ? '<span class="muted">แตะเพื่อกรอก</span>' : `${r.date ? dmy(r.date) + ' · ' : ''}${esc(r.desc || 'ยังไม่ได้เลือกรายการ')}${r.receipt ? '' : ' · ไม่มีใบเสร็จ'}`;
    $('[data-sumamt]', d).textContent = empty || r.amount == null ? '' : money(r.amount);
    d.classList.toggle('filled', !empty);
  }
  const renumber = () => rowEls().forEach(sumLine);
  // หัวฟอร์มของแบบไม่มีใบ advance (ข้อมูลที่ใบฟ้าต้องใช้ · แบบมีใบ advance ดึงจากใบ advance)
  const hv = (k) => $(`[data-h="${k}"]`, el)?.value.trim() || '';
  const who = () => $('[data-who]', el)?.value || '';
  const head = () => ({ requesterEmail: st.a.draft ? who() : '', jobNo: hv('jobNo'), payee: hv('payee'), payBank: hv('payBank'), payAccount: hv('payAccount') });

  function paintSum() {
    const a = st.a, list = rows(), n = list.length, t = total(), adv = advAmt(), rem = r2(adv - t);
    const tile = (label, value, cls = '') => `<div class="clr-tile ${cls}"><div class="k">${label}</div><div class="v amount">${money(value)}</div></div>`;
    $('[data-tiles]', el).innerHTML = direct()
      ? tile(`ใช้จริง (${n} รายการ)`, t) + tile('ยอดใบฟ้าที่จะเบิก', t, 'pay')
      : tile(`รับ advance${a.advId && a.clr ? ' ' + esc(a.advId) : ''}`, adv) + tile(`ใช้จริง (${n} รายการ)`, t)
        + (rem > 0 ? tile('ต้องโอนคืนบริษัท', rem, 'back') : rem < 0 ? tile('บริษัทจ่ายเพิ่ม', -rem, 'pay') : tile('ยอดตรงกับ advance', 0));
    $('[data-summary]', el).innerHTML = clrSummaryHtml(list, a.groups);
    const rb = $('[data-retbox]', el);
    if (rb) { rb.classList.toggle('hidden', !(rem > 0 && n > 0)); const ra = $('[data-retamt]', rb); if (ra) ra.textContent = money(Math.max(rem, 0)); }
    $('[data-nospend]', el)?.classList.toggle('hidden', n > 0);
  }
  const saveLocal = debounce(() => {
    if (Date.now() < st.hold || !box()?.isConnected) return;      // เพิ่งบันทึกร่าง / ส่งไป หรือออกจากหน้านี้แล้ว → ไม่เขียนร่างในเครื่องกลับมา
    try {
      const list = rows();
      if (!list.length && !$('[data-trip]', el)?.value && !$('[data-note]', el)?.value && !(direct() && (hv('payee') || hv('jobNo')))) { localStorage.removeItem(lsKey()); return; }
      localStorage.setItem(lsKey(), JSON.stringify({ rows: list, trip: $('[data-trip]', el)?.value || '', note: $('[data-note]', el)?.value || '',
        ...(direct() ? { jobNo: hv('jobNo'), payee: hv('payee'), payBank: hv('payBank'), payAccount: hv('payAccount'), who: who() } : {}) }));
    } catch {}
  }, 400);
  const dropLocal = () => { st.hold = Date.now() + 1500; try { localStorage.removeItem(lsKey()); } catch {} };
  const changed = () => { paintSum(); saveLocal(); };

  // หัวการ์ด: แบบมีใบ advance = ข้อมูลใบ · แบบไม่มีใบ = ช่องที่ใบฟ้าต้องใช้
  function headCard() {
    const a = st.a;
    const localBar = st.local ? `<div class="alert neutral">${icon('info')}<div>เอาข้อมูลที่กรอกค้างไว้ในเครื่องนี้กลับมาให้แล้ว (ยังไม่ได้บันทึกร่าง) · <a href="#" data-act="use-server">${direct() && !st.id ? 'ล้างแล้วเริ่มใหม่' : 'ใช้ข้อมูลที่บันทึกไว้ในระบบแทน'}</a></div></div>` : '';
    const back = a.returnRemark ? `<div class="alert bad">${icon('alert')}<div><b>ถูกตีกลับ:</b> ${esc(a.returnRemark)}</div></div>` : '';
    const trip = `<div class="field${direct() ? ' span-2' : ''}" style="margin:0"><label class="${direct() ? 'req' : ''}" for="clr-trip">Trip <span class="opt">ชื่องาน / สถานที่ · ขึ้นในใบฟ้าและ Excel</span></label><input class="input" id="clr-trip" data-trip maxlength="120" value="${esc(a.trip || '')}"></div>`;
    if (!direct()) {
      const advId = a.clr ? a.advId : a.id;
      return `<div class="card pad stack-sm">
        <div class="flex between wrap gap-12">
          <div class="stack-sm" style="gap:4px"><b class="mono text-lg">${esc(a.clr ? a.id : advId)}</b>
            <div class="text-sm muted">${a.clr ? `ใบเคลียร์ของ advance ${esc(advId)} · ` : ''}${esc(a.requesterName)}${a.jobNo ? ' · Job ' + esc(a.jobNo) : ''}${a.paidAt ? ' · รับเงิน ' + fmtDate(a.paidAt) : ''}</div></div>
          <div class="text-right"><div class="callout-amount"><span class="v amount">${money(a.amount)}</span><span class="muted">บาท</span></div>${a.advDue ? `<div class="text-sm muted">เคลียร์ภายใน ${fmtDate(a.advDue)}</div>` : ''}</div>
        </div>
        <div class="hint">กรอกรายการที่ใช้จริง กดส่งแล้วระบบออกใบฟ้า 1 ใบตามยอดใช้จริง และหักลบกับ advance ให้ · ใช้เกิน = บริษัทจ่ายเพิ่ม · ใช้ไม่ถึง = โอนคืนบริษัท</div>
        ${back}${localBar}${trip}
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
      ${back}${localBar}
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
  // การ์ดโอนคืนบริษัท (ใช้ไม่ถึงยอด advance): เลขบัญชีบริษัท + คัดลอก + แนบสลิป (ไม่บังคับ · โอนทีหลังแล้วมาแจ้งในใบได้)
  function returnBox() {
    const acc = st.a.returnAccount;
    return `<div class="clr-ret hidden" data-retbox>
      <div class="flex between wrap gap-8" style="align-items:baseline"><b>โอนคืนบริษัท <span class="amount" data-retamt></span> บาท</b><span class="text-sm muted">โอนตอนนี้ หรือโอนทีหลังแล้วมาแจ้งในใบก็ได้</span></div>
      ${acc && acc.no ? `<div class="clr-acc"><div><div class="text-sm muted">${esc([acc.bank, acc.name].filter(Boolean).join(' · '))}</div><div class="no mono">${esc(acc.no)}</div></div>
        <button type="button" class="btn btn-secondary btn-sm" data-act="copy-acc" data-no="${esc(acc.no)}">${icon('copy', 'sm')} คัดลอก</button></div>`
        : '<div class="hint">ยังไม่ได้ตั้งเลขบัญชีบริษัทในระบบ — สอบถามเลขบัญชีจากฝ่ายบัญชี</div>'}
      <div class="field" style="margin:0"><label>สลิปโอนคืน <span class="opt">ไม่บังคับ · คืนเป็นเงินสดไม่ต้องแนบ</span></label><div data-slpick></div></div>
    </div>`;
  }

  function paint() {
    const a = st.a, dr = direct();
    const list = (a.rows || []).slice();
    while (list.length < MIN_ROWS) list.push({});
    st.seq = 0;
    el.innerHTML = `
    <div class="stack">
      ${headCard()}

      <div class="card pad stack-sm ${FX() ? 'cg-fx' : ''}">
        <div class="flex between wrap"><b>${dr ? 'รายการที่จ่ายจริง' : 'รายการที่ใช้จริง'}</b><span class="text-sm muted">กรอกเฉพาะบรรทัดที่ใช้ · บรรทัดว่างไม่ถูกนับ</span></div>
        <div class="cg" data-rows>
          <div class="cg-head"><span>#</span><span>วันที่</span><span>รายการ</span><span class="r">จำนวนเงิน (บาท)</span>${FX() ? '<span class="r">Amount(Cur)</span><span>Currency</span>' : ''}<span>ใบเสร็จ</span><span>หมายเหตุ</span><span></span></div>
          ${list.map(rowHtml).join('')}
        </div>
        <div class="flex between wrap gap-8"><div class="flex wrap gap-8"><button type="button" class="btn btn-secondary btn-sm" data-act="add-rows">${icon('plus', 'sm')} เพิ่ม 5 บรรทัด</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="paste">${icon('sheet', 'sm')} วางจาก Excel</button></div>
          ${FX() ? '<span class="hint">Amount(Cur) / Currency กรอกเฉพาะรายการที่จ่ายเป็นเงินสกุลอื่น · ยอดรวมคิดจากช่องบาท</span>' : ''}</div>
      </div>

      <div class="card pad stack-sm">
        <div class="clr-tiles" data-tiles></div>
        ${dr ? '' : returnBox()}
        <div><div class="text-sm muted mb-8">สรุปตามรายการ</div><div data-summary></div></div>
      </div>

      <div class="card pad stack-sm">
        <div class="field" style="margin:0"><label>ไฟล์แนบ <span class="opt">ไม่บังคับ · ใบเสร็จ / หลักฐาน โยนรวมไว้ที่นี่ได้ 30 ไฟล์</span></label><div data-rcpick></div></div>
        <div class="field" style="margin:0"><label for="clr-note">หมายเหตุ <span class="opt">ไม่บังคับ · ขึ้นในใบฟ้า</span></label><input class="input" id="clr-note" data-note maxlength="300" value="${esc(a.note || '')}"></div>
      </div>

      <div class="btn-row">
        ${editVoucher() ? '' : `<button type="button" class="btn btn-secondary" data-act="save">${icon('check')} บันทึกร่าง</button>
        <button type="button" class="btn btn-secondary" data-act="xlsx">${icon('download')} Excel</button>`}
        <button type="button" class="btn btn-primary" data-act="send">${icon('send')} ${editVoucher() ? 'ส่งใหม่' : 'ส่งเคลียร์'}</button>
      </div>
      <div class="hint">${editVoucher() ? 'ส่งใหม่แล้วใบเริ่มอนุมัติใหม่ตั้งแต่ขั้นแรก (เลขเดิม)' : 'บันทึกร่าง = เก็บไว้กรอกต่อ ยังไม่ส่ง · Excel = ไฟล์ฟอร์ม Expenses Claim ของตารางนี้ · ส่งเคลียร์ = ออกใบฟ้าตามยอดใช้จริง เข้าสายอนุมัติ'}</div>
      ${advMode() ? `<div data-nospend class="hidden"><button type="button" class="btn btn-ghost btn-sm" data-act="nospend">ไม่ได้ใช้เงินเลย คืนทั้งหมด</button></div>` : ''}
    </div>`;
    st.rc = receiptPicker($('[data-rcpick]', el), { max: 30, existing: a.paths || [] });
    st.sl = dr ? null : receiptPicker($('[data-slpick]', el), { max: 3, existing: a.returnPaths || [] });
    renumber(); paintSum();
  }

  // ─────────────── ตรวจ + รวบรวมข้อมูล ───────────────
  function problem() {
    const els = rowEls();
    els.forEach((d) => d.classList.remove('err'));
    for (const d of els) {
      const r = readRow(d); if (blank(r)) continue;
      const msg = !r.date ? 'ยังไม่ได้ใส่วันที่' : r.date > todayYMD() ? 'วันที่ยังมาไม่ถึง' : !r.desc ? (r.other ? 'ยังไม่ได้พิมพ์รายการ' : 'ยังไม่ได้เลือกรายการ') : !(r.amount > 0) ? 'ยังไม่ได้ใส่จำนวนเงิน (บาท)'
        : FX() && r.fx != null && !(r.fx > 0) ? 'ช่อง Amount(Cur) ต้องมากกว่า 0'
        : FX() && (r.fx != null) !== !!r.cur ? 'กรอก Amount(Cur) กับ Currency ให้ครบคู่ (จ่ายเป็นเงินบาท ให้เว้นว่างทั้งสองช่อง)' : '';
      if (msg) { openRow(d); d.classList.add('err'); d.scrollIntoView({ block: 'center', behavior: 'smooth' }); return `บรรทัดที่ ${els.indexOf(d) + 1}: ${msg}`; }
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
  // ไฟล์ที่อัปโหลดไปแล้ว → นับเป็นไฟล์เดิม (ถ้าส่งไม่ผ่านแล้วกดใหม่ ไม่ต้องอัปซ้ำ)
  function keepUploaded(sel, key, paths, max) {
    const c = $(sel, el); if (!c) return;
    c.innerHTML = ''; st[key] = receiptPicker(c, { max, existing: paths });
  }
  async function payload(set) {
    const paths = await st.rc.uploadAll((n, all) => set(`อัปโหลดไฟล์แนบ (${n}/${all})`));
    keepUploaded('[data-rcpick]', 'rc', paths, 30);
    const base = { rows: rows(), trip: $('[data-trip]', el).value.trim(), note: $('[data-note]', el).value.trim(), paths };
    if (direct()) return { ...base, ...head(), fundId: pettyFund() || st.meta?.fund?.fundId || '' };
    const back = r2(advAmt() - total()) > 0;
    const returnPaths = back && st.sl ? await st.sl.uploadAll((n, all) => set(`อัปโหลดสลิป (${n}/${all})`)) : [];
    if (back && st.sl) keepUploaded('[data-slpick]', 'sl', returnPaths, 3);
    return { ...base, returnPaths };
  }
  async function saveDraft(quiet) {
    await busy('กำลังบันทึกร่าง…', async (set) => {
      const d = await payload(set);
      set('กำลังบันทึกร่าง…');
      if (advMode()) await api.rpc('pv_adv_save', { p_id: st.a.id, p_data: d });
      else {
        const r = await api.rpc('pv_clr_save', { p_id: st.id, p_data: d });
        dropLocal();
        if (!st.id && r?.id) {     // ร่างใหม่ได้เลขแล้ว → เปลี่ยนที่อยู่หน้าให้เปิดซ้ำ / รีเฟรชแล้วเจอร่างนี้
          st.id = r.id;
          try { history.replaceState(null, '', location.pathname + location.search + '#/pv/clear?id=' + encodeURIComponent(r.id)); } catch {}
        }
      }
    });
    dropLocal();
    if (!quiet) toast('บันทึกร่างแล้ว · กลับมากรอกต่อได้');
    await load();
  }
  async function doSend() {
    const a = st.a, dr = direct();
    const err = (dr ? headProblem() : '') || problem(); if (err) { toast(err, 'bad'); return; }
    const list = rows(), t = total(), adv = advAmt(), rem = r2(adv - t), trip = $('[data-trip]', el).value.trim();
    if (!list.length) { toast(advMode() ? 'ยังไม่มีรายการในตาราง — ถ้าไม่ได้ใช้เงินเลย กดปุ่ม "ไม่ได้ใช้เงินเลย คืนทั้งหมด" ด้านล่าง' : 'กรุณากรอกตารางอย่างน้อย 1 บรรทัด', 'bad'); return; }
    if (dr) {
      // กันเบิกซ้ำ: ผู้รับเงิน + ยอดเท่ากันใน 60 วัน (เช่น เคยส่งทริปนี้เป็นใบฟ้าปกติไปแล้ว)
      try {
        const h = head();
        const dup = await api.rpc('get_pv_dupes', { p_job: h.jobNo, p_po: '', p_payee: h.payee, p_amount: t, p_exclude: a.draft ? '' : a.id }, { quiet: true });
        if (dup?.length && !(await confirmBox({ title: 'อาจซ้ำกับใบที่มีอยู่แล้ว',
          message: dup.map((x) => `${x.id} · ${x.reason} · ${x.requesterName}${x.amount != null ? ` · ${money(x.amount)} บาท` : ''}`).join('\n') + '\n\nตรวจแล้วไม่ซ้ำ กดส่งต่อได้', ok: 'ส่งต่อ' }))) return;
      } catch { /* เช็คไม่ได้ ไม่ขวางการส่ง */ }
    }
    const old = advMode() && !flow2();        // ฐานข้อมูลยังไม่รัน 0082 → ส่งเคลียร์แบบเดิม (บัญชีตรวจ)
    const net = dr ? `ระบบจะ${a.draft ? 'ออกใบฟ้า 1 ใบ' : 'แก้ใบฟ้า ' + a.id} ยอด ${money(t)} บาท`
      : `รับ advance ${money(adv)} บาท\n${rem > 0 ? `คงเหลือ ต้องโอนคืนบริษัท ${money(rem)} บาท` : rem < 0 ? `ใช้เกิน บริษัทจ่ายเพิ่ม ${money(-rem)} บาท` : 'ยอดตรงกับ advance'}`;
    const ok = await confirmBox({ title: editVoucher() ? 'ส่งใหม่' : 'ส่งเคลียร์ advance',
      message: `ใช้จริง ${money(t)} บาท (${list.length} รายการ)\n${net}\n\n${old ? 'ส่งแล้วแก้ไม่ได้จนกว่าบัญชีจะตรวจ' : `รายการในใบฟ้า: Clear advance trip${trip ? ' · ' + trip : ''}\nส่งแล้วใบเข้าสายอนุมัติตามยอดใช้จริง`}`,
      ok: editVoucher() ? 'ส่งใหม่' : 'ส่งเคลียร์' });
    if (!ok) return;
    try {
      const res = await busy('กำลังส่ง…', async (set) => {
        const d = await payload(set);
        set(old ? 'กำลังส่งเคลียร์…' : 'กำลังออกใบฟ้า…');
        return old ? api.rpc('pv_adv_clear2', { p_id: a.id, p_data: d }) : api.rpc('pv_clr_submit', { p_id: advMode() ? a.id : st.id, p_data: d });
      });
      dropLocal();
      toast(old ? 'ส่งเคลียร์แล้ว · รอบัญชีตรวจ' : `${editVoucher() ? 'ส่งใหม่แล้ว' : 'ส่งแล้ว'} · ใบฟ้า ${res.id}${Number(res.returnDue) > 0 ? ` · โอนคืน ${money(res.returnDue)} บาท` : ''}`);
      ctx.refreshBadges();
      ctx.go('/pv/view?id=' + encodeURIComponent(old ? a.id : res.id));
    } catch (e) { toastError(e); }
  }
  async function send() {
    if (st.sending) return;      // กันกดส่งซ้ำ (ระหว่างเช็คใบซ้ำ / อัปโหลด)
    st.sending = true;
    try { await doSend(); } finally { st.sending = false; }
  }
  // ไม่ได้ใช้เงิน advance เลย → คืนทั้งหมด (ไม่มีใบฟ้าให้ออก · บัญชีตรวจแล้วรับเงินคืน)
  async function noSpend() {
    const a = st.a;
    if (!(await confirmBox({ title: 'ไม่ได้ใช้เงินเลย?', message: `ไม่มีรายการในตาราง = ไม่ได้ใช้เงิน advance เลย\nต้องคืนบริษัททั้งหมด ${money(a.amount)} บาท\n\nส่งแล้วบัญชีจะตรวจและรับเงินคืน`, ok: 'ยืนยัน คืนทั้งหมด' }))) return;
    try {
      await busy('กำลังส่ง…', async (set) => {
        const returnPaths = st.sl ? await st.sl.uploadAll((n, all) => set(`อัปโหลดสลิป (${n}/${all})`)) : [];
        await api.rpc('pv_adv_clear2', { p_id: a.id, p_data: { rows: [], noSpend: true, trip: $('[data-trip]', el).value.trim(), note: $('[data-note]', el).value.trim(), paths: [], returnPaths } });
      });
      dropLocal(); toast('ส่งแล้ว · รอบัญชีตรวจและรับเงินคืน'); ctx.refreshBadges();
      ctx.go('/pv/view?id=' + encodeURIComponent(a.id));
    } catch (e) { toastError(e); }
  }
  async function excel() {
    try {
      await saveDraft(true);            // ไฟล์สร้างจากข้อมูลที่บันทึกไว้ → บันทึกร่างก่อนเสมอ
      await api.excel({ type: 'adv_clear', id: advMode() ? st.a.id : st.id });
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
  // ─────────────── วางจาก Excel ───────────────
  // ต่อท้ายบรรทัดสุดท้ายที่กรอกไว้ (ไม่ทับของเดิม) · บรรทัดไม่พอ เพิ่มให้เอง
  function insertRows(list) {
    let at = 0;
    rowEls().forEach((d, i) => { if (!blank(readRow(d))) at = i + 1; });
    const need = at + list.length - rowEls().length;
    if (need > 0) box().insertAdjacentHTML('beforeend', Array.from({ length: need }, () => rowHtml({})).join(''));
    const els = rowEls();
    list.forEach((r, i) => { els[at + i].outerHTML = rowHtml(r); });
    renumber(); changed();
    rowEls()[at]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast(`วางแล้ว ${list.length} รายการ · ตรวจให้ถูกก่อนส่ง`);
  }
  function pasteDialog(text = '') {
    const room = MAX_ROWS - rows().length;
    let res = { rows: [] };
    const s = sheet({
      title: 'วางจาก Excel', wide: true,
      body: `<div class="stack-sm">
        <div class="hint">ใน Excel ลากเลือกช่องของรายการ (วันที่ · รายการ · ยอดบาท · ถ้ามี: ยอดเงินสกุลอื่น / สกุลเงิน / หมายเหตุ) กดคัดลอก แล้ววางในช่องนี้ · เลือกหัวตารางมาด้วยก็ได้ ระบบดูเองว่าคอลัมน์ไหนคืออะไร</div>
        <textarea class="input paste-in" data-pin rows="4" aria-label="วางข้อมูลที่คัดลอกจาก Excel" spellcheck="false" autofocus></textarea>
        <div class="stack-sm" data-pout></div>
      </div>`,
      foot: '<button type="button" class="btn btn-secondary" data-x>ยกเลิก</button><button type="button" class="btn btn-primary" data-ok disabled>ใส่ลงตาราง</button>',
      onMount: (bx, close) => {
        const ta = $('[data-pin]', bx), out = $('[data-pout]', bx), ok = $('[data-ok]', bx);
        const show = () => {
          res = parsePaste(ta.value, { items: st.a.items || [], curs: st.a.curs || [], today: todayYMD() });
          const list = res.rows, n = list.length, fx = FX() && list.some((r) => r.fx != null);
          ok.disabled = !n || n > room;
          if (!ta.value.trim()) { out.innerHTML = ''; return; }
          if (!n) { out.innerHTML = `<div class="alert bad">${icon('alert')}<div>ไม่พบบรรทัดที่มียอดเงิน — เลือกช่องให้มีคอลัมน์ยอดเงิน (บาท) มาด้วย แล้ววางใหม่</div></div>`; return; }
          const noCur = fx ? res.noCur : 0;
          out.innerHTML = `
            <div class="flex between wrap gap-8" style="align-items:baseline"><b>พบ ${n} รายการ · รวม ${money(res.total)} บาท</b>
              ${res.skipped ? `<span class="text-sm muted">ข้าม ${res.skipped} บรรทัด (หัวตาราง / บรรทัดรวม / ไม่มีวันที่หรือยอดเงิน)</span>` : ''}</div>
            ${n > room ? `<div class="alert bad">${icon('alert')}<div>ตารางใส่ได้อีก ${room} บรรทัด (สูงสุด ${MAX_ROWS} บรรทัดต่อใบ) — เลือกมาให้น้อยลงแล้ววางใหม่</div></div>` : ''}
            ${noCur ? `<div class="field" style="margin:0"><label for="paste-cur">สกุลเงินของช่อง Amount(Cur) <span class="opt">${noCur} บรรทัดยังไม่รู้สกุล · เลือกทีหลังในตารางก็ได้</span></label>
              <select class="input" id="paste-cur" data-pcur><option value="">-</option>${(st.a.curs || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>` : ''}
            <div class="table-wrap paste-prev"><table class="tbl"><thead><tr><th>#</th><th>วันที่</th><th>รายการ</th><th class="r">บาท</th>${fx ? '<th class="r">Amount(Cur)</th><th>Currency</th>' : ''}<th>ใบเสร็จ</th><th>หมายเหตุ</th></tr></thead>
              <tbody>${list.map((r, i) => `<tr><td class="muted">${i + 1}</td><td class="nowrap">${r.date ? (r.date > todayYMD() ? `<span class="bad">${esc(fmtDate(r.date))} (ยังมาไม่ถึง)</span>` : esc(fmtDate(r.date))) : '<span class="bad">ไม่มีวันที่</span>'}</td>
                <td>${r.desc ? esc(r.desc) : '<span class="bad">ไม่มีรายการ</span>'}</td><td class="r">${money(r.amount)}</td>${fx ? `<td class="r">${r.fx != null ? money(r.fx) : ''}</td><td${r.fx != null && !r.cur ? ' data-pcc' : ''}>${esc(r.cur || '')}</td>` : ''}
                <td class="nowrap">${r.receipt ? 'มี' : '<span class="bad">ไม่มี</span>'}</td><td>${esc(r.remark || '')}</td></tr>`).join('')}</tbody></table></div>
            <div class="hint">ใส่ต่อท้ายบรรทัดที่กรอกไว้แล้ว ไม่ทับของเดิม · ใส่แล้วแก้ทีละบรรทัดในตารางได้</div>`;
        };
        ta.addEventListener('input', show);
        out.addEventListener('change', (e) => { if (e.target.matches('[data-pcur]')) $$('[data-pcc]', out).forEach((td) => { td.textContent = e.target.value; }); });      // เลือกสกุลแล้วเห็นในตัวอย่างทันที
        ok.onclick = () => {
          const dc = $('[data-pcur]', bx)?.value || '';
          close(res.rows.map((r) => (FX() ? (r.fx != null && !r.cur && dc ? { ...r, cur: dc } : r) : { ...r, fx: null, cur: '' })));
        };
        if (text) { ta.value = text; show(); }
      },
    });
    s.done.then((list) => { if (Array.isArray(list) && list.length && box()?.isConnected) insertRows(list); });
  }
  // จอเล็ก: เปิดกรอกทีละบรรทัด
  function openRow(d) {
    rowEls().forEach((x) => { if (x !== d) { x.classList.remove('open'); $('.cg-sum', x)?.setAttribute('aria-expanded', 'false'); } });
    d.classList.add('open'); $('.cg-sum', d)?.setAttribute('aria-expanded', 'true');
  }
  // บรรทัดที่เพิ่งเริ่มกรอกแต่ยังไม่มีวันที่ → ใช้วันที่ของบรรทัดก่อนหน้าที่มีวันที่
  function autoDate(d) {
    const inp = $('[data-r=date]', d);
    if (inp.value || blank(readRow(d))) return;
    const els = rowEls(), i = els.indexOf(d);
    for (let k = i - 1; k >= 0; k--) { const v = $('[data-r=date]', els[k]).value; if (v) { inp.value = v; return; } }
  }

  el.innerHTML = skeleton(4);
  await load();
  const offs = [
    on(el, 'input', '[data-r], [data-trip], [data-note], [data-h]', (e, t) => {
      const d = t.closest('.cg-row');
      if (d) { d.classList.remove('err'); if (t.dataset.r !== 'date') autoDate(d); sumLine(d, rowEls().indexOf(d)); }
      changed();
    }),
    on(el, 'change', '[data-r=sel]', (e, t) => {
      const d = t.closest('.cg-row'), o = $('[data-r=other]', d);
      o.classList.toggle('hidden', t.value !== OTHER);
      if (t.value === OTHER) o.focus();
      autoDate(d); sumLine(d, rowEls().indexOf(d)); changed();
    }),
    on(el, 'change', '[data-who], [data-r=cur], [data-r=rc]', (e, t) => { const d = t.closest('.cg-row'); if (d) { d.classList.remove('err'); sumLine(d, rowEls().indexOf(d)); } changed(); }),
    on(el, 'change', '[data-h=payee]', () => fillPayee()),
    // Enter = ลงไปช่องเดียวกันของบรรทัดถัดไป (กรอกต่อเนื่องเหมือนตาราง)
    on(el, 'keydown', '.cg-row input', (e, t) => {
      if (e.key !== 'Enter' || t.type === 'checkbox') return;
      e.preventDefault();
      const els = rowEls(), nx = els[els.indexOf(t.closest('.cg-row')) + 1];
      if (nx) { openRow(nx); $(`[data-r="${t.dataset.r}"]`, nx)?.focus(); }
    }),
    // กดวางข้อมูลหลายช่อง (คัดลอกจาก Excel) ลงในตารางตรง ๆ → เปิดหน้าต่างวางจาก Excel ให้ · ช่องเดียว = วางตามปกติ
    on(el, 'paste', '.cg-row input', (e) => {
      const tx = e.clipboardData?.getData('text/plain') || '';
      if (!tx.includes('\t') && tx.split(/\r?\n/).filter((l) => l.trim()).length < 2) return;
      e.preventDefault(); pasteDialog(tx);
    }),
    on(el, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'paste') pasteDialog();
      else if (a === 'add-rows') {
        box().insertAdjacentHTML('beforeend', Array.from({ length: 5 }, () => rowHtml({})).join(''));
        renumber();
      } else if (a === 'rm-row') {
        const d = t.closest('.cg-row');
        d.outerHTML = rowHtml({});
        renumber(); changed();
      } else if (a === 'row-open') {
        const d = t.closest('.cg-row');
        if (d.classList.contains('open')) { d.classList.remove('open'); t.setAttribute('aria-expanded', 'false'); }
        else { openRow(d); if (blank(readRow(d))) { autoDate(d); $('[data-r=sel]', d)?.focus(); } }
      } else if (a === 'save') { try { await saveDraft(false); } catch (err) { toastError(err); } }
      else if (a === 'send') send();
      else if (a === 'nospend') noSpend();
      else if (a === 'xlsx') excel();
      else if (a === 'job-none') { const j = $('[data-h=jobNo]', el); j.value = 'Z-NONE'; changed(); }
      else if (a === 'copy-acc') { try { await navigator.clipboard.writeText(t.dataset.no || ''); toast('คัดลอกเลขบัญชีแล้ว'); } catch { toast('คัดลอกไม่ได้ — พิมพ์เลขบัญชีเอง', 'bad'); } }
      else if (a === 'use-server') { e.preventDefault(); dropLocal(); el.innerHTML = skeleton(4); load(); }
    }),
  ];
  return () => offs.forEach((f) => f());
}
