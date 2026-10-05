// ขอเบิกค่าใช้จ่าย — กรอกได้หลายรายการในครั้งเดียว · เซฟร่างอัตโนมัติ · กันส่งซ้ำด้วย batchId
// ส่วนช่องกรอกตามหมวด (export ด้านล่าง) ใช้ร่วมกับหน้าแก้ไขใน requests.js
import { api, state, money, esc, fmtDate, catName, catInfo, todayYMD, addDays, loadCategories, timeAgo } from '../core.js';
import { html, icon, catIcon, toast, toastError, confirmBox, busy, receiptPicker, on, debounce, $, $$ } from '../ui.js';

const NO_JOB = ['FUEL', 'TOLL', 'PARK', 'MILE'];        // หมวดเดินทาง ไม่ต้องมีเลข Job
const ENT_CATS = ['ENT', 'GOLF'];
const ALLOW_CATS = ['CAR', 'MOBILE', 'APT'];             // ค่าเหมาจ่ายอัตโนมัติ
export const FIELDS = ['category', 'expenseDate', 'mileageKm', 'amount', 'venue', 'occasion', 'attendees', 'origin', 'destination', 'customer', 'customerContact', 'jobNo'];
const RATE_TYPE = { 'With Depreciation': 'รวมค่าเสื่อม', 'No Depreciation': 'ไม่รวมค่าเสื่อม' };
const DRAFT_DAYS = 7;

// ════════════════════ ตัวช่วยช่องกรอก (ใช้ร่วมกับ requests.js) ════════════════════

/** คุณสมบัติของหมวด → ช่องไหนต้องแสดง */
export function catFlags(c) {
  const code = String(c?.code || '').toUpperCase();
  return {
    code,
    fuel: code === 'FUEL',
    ent: ENT_CATS.includes(code) || !!c?.need_claim_form,
    travel: code === 'FUEL' || !!c?.need_travel_info,
    rcpt: String(c?.need_receipt || 'NO').toUpperCase(),
    job: !!code && !NO_JOB.includes(code),
  };
}

/** หมวดที่ใช้บ่อย (จำในเครื่องนี้) — ขึ้นก่อน */
const USE_KEY = 'exion_cat_use';
function catUse() { try { return JSON.parse(localStorage.getItem(USE_KEY) || '{}') || {}; } catch { return {}; } }
export function noteCatUse(code) {
  try { const u = catUse(); u[code] = (u[code] || 0) + 1; localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch { /* ไม่เป็นไร */ }
}
function byUse(cats) {
  const u = catUse();
  return cats.map((c, i) => [c, i]).sort((a, b) => (u[b[0].code] || 0) - (u[a[0].code] || 0) || a[1] - b[1]).map((x) => x[0]);
}

/** ปุ่มเลือกหมวด (.cat-picker) */
export function catPickerHtml(cats, selected = '') {
  return `<div class="cat-picker" data-picker>${byUse(cats).map((c) => `<button type="button" class="cat-opt ${c.code === selected ? 'on' : ''}" data-act="cat" data-code="${esc(c.code)}" aria-pressed="${c.code === selected}">
    ${catIcon(c.code)}<span>${esc(c.name_th || catName(c.code))}</span></button>`).join('')}</div>`;
}

/** ช่องกรอกทั้งหมด (ซ่อน/แสดงตามหมวดด้วย applyCat) · listId = id ของ datalist ลูกค้า */
export function fieldsHtml(it, { listId = 'exCustList' } = {}) {
  const v = (k) => it[k] ?? '';
  const err = (k) => html`<div class="err-text hidden" data-err="${k}"></div>`;
  return String(html`
  <div class="form-grid two">
    <div class="field"><label class="req">วันที่ใช้จ่าย</label>
      <input class="input" type="date" data-f="expenseDate" value="${v('expenseDate')}" max="${todayYMD()}">${err('expenseDate')}</div>
    <div class="field" data-g="km"><label class="req">ระยะทาง</label>
      <div class="input-group has-suf"><input class="input" type="number" inputmode="decimal" step="0.1" min="0" placeholder="เช่น 45.5" data-f="mileageKm" value="${v('mileageKm')}"><span class="suf">กม.</span></div>${err('mileageKm')}</div>
    <div class="field" data-g="amt"><label class="req">จำนวนเงิน</label>
      <div class="input-group has-pre has-suf"><span class="pre">฿</span><input class="input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" data-f="amount" value="${v('amount')}"><span class="suf">บาท</span></div>${err('amount')}</div>
    <div class="span-2 hidden" data-g="fuelcalc"></div>
    <div class="field span-2" data-g="venue"><label data-lbl="venue">รายละเอียด</label>
      <input class="input" data-f="venue" value="${v('venue')}" maxlength="300">${err('venue')}</div>
    <div class="field" data-g="origin"><label>ต้นทาง</label><input class="input" data-f="origin" value="${v('origin')}" placeholder="เช่น ออฟฟิศ" maxlength="200"></div>
    <div class="field" data-g="destination"><label>ปลายทาง</label><input class="input" data-f="destination" value="${v('destination')}" placeholder="เช่น นิคมฯ มาบตาพุด" maxlength="200"></div>
    <div class="field" data-g="customer"><label data-lbl="customer">ลูกค้า</label>
      <input class="input" data-f="customer" value="${v('customer')}" list="${listId}" placeholder="ชื่อบริษัท" autocomplete="off" maxlength="200">${err('customer')}</div>
    <div class="field" data-g="customerContact"><label>ผู้ติดต่อ <span class="opt">ไม่บังคับ</span></label>
      <input class="input" data-f="customerContact" value="${v('customerContact')}" placeholder="ชื่อ / ตำแหน่ง" maxlength="200"></div>
    <div class="field span-2" data-g="occasion"><label class="req">โอกาส / วัตถุประสงค์</label>
      <textarea class="input" data-f="occasion" placeholder="เช่น ประชุมสรุปโครงการ Q4" maxlength="500">${v('occasion')}</textarea>${err('occasion')}</div>
    <div class="field span-2" data-g="attendees"><label class="req">ผู้ร่วม</label>
      <textarea class="input" data-f="attendees" placeholder="ชื่อ + บริษัท เช่น คุณสมชาย (SCG), คุณเอ (EXION)" maxlength="500">${v('attendees')}</textarea>${err('attendees')}</div>
    <div class="field" data-g="jobNo"><label>เลข Job <span class="opt">ไม่บังคับ</span></label>
      <input class="input" data-f="jobNo" value="${v('jobNo')}" placeholder="เช่น J2026-0142" maxlength="60"></div>
  </div>
  <div class="field mt-16" data-g="rcpt"><label data-lbl="rcpt">ใบเสร็จ</label><div data-rslot></div>
    <div class="hint" data-hint="rcpt"></div>${err('receipts')}</div>`);
}

/** ยอดของรายการ (น้ำมัน = กม. × เรท โดยประมาณ) */
export function itemAmount(it, fuel) {
  if (String(it.category).toUpperCase() === 'FUEL') {
    const km = Number(it.mileageKm) || 0;
    return fuel?.rate ? Math.round(km * fuel.rate * 100) / 100 : 0;
  }
  return Number(it.amount) || 0;
}

/** กล่องคำนวณค่าน้ำมันสด */
export function fuelBox(it, fuel) {
  if (!fuel) return `<div class="alert neutral">${icon('fuel')}<span>กำลังโหลดเรทน้ำมัน…</span></div>`;
  if (fuel.error) return `<div class="alert warn">${icon('alert')}<span>โหลดเรทน้ำมันไม่สำเร็จ — ระบบจะคำนวณยอดให้ตอนบันทึก</span></div>`;
  const km = Number(it.mileageKm) || 0;
  return `<div class="alert ok">${icon('calculator')}<div class="grow">
    <div class="flex between wrap"><span>ค่าน้ำมันโดยประมาณ</span><b class="amount">฿${money(itemAmount(it, fuel))}</b></div>
    <div class="text-sm">${money(km, 1)} กม. × ฿${money(fuel.rate)}/กม. · ${esc(RATE_TYPE[fuel.rateType] || fuel.rateType || '')}${fuel.gasPrice ? ` · น้ำมันวันนี้ ${money(fuel.gasPrice)} บาท/ลิตร` : ''}</div>
    <div class="text-xs mt-4">ยอดจริงคิดจากราคาน้ำมันวันที่ 20 ของเดือนที่ใช้จ่าย (ก่อนวันที่ 20 เป็นยอดประมาณ)</div></div></div>`;
}

/** แสดง/ซ่อนช่องตามหมวด + ปรับป้ายกำกับ */
export function applyCat(root, it, fuel) {
  const f = catFlags(catInfo(it.category) || { code: it.category });
  const show = {
    km: f.fuel, amt: !f.fuel, fuelcalc: f.fuel, venue: !f.fuel,
    origin: f.travel, destination: f.travel, customer: f.travel || f.ent,
    customerContact: (f.travel && !f.fuel) || f.ent, occasion: f.ent, attendees: f.ent, jobNo: f.job, rcpt: f.rcpt !== 'NO',
  };
  for (const [g, on_] of Object.entries(show)) $$(`[data-g="${g}"]`, root).forEach((x) => x.classList.toggle('hidden', !on_));
  const lv = $('[data-lbl="venue"]', root);
  if (lv) { lv.textContent = f.ent ? 'สถานที่' : 'รายละเอียด'; lv.classList.toggle('req', f.ent); }
  const iv = $('[data-f="venue"]', root);
  if (iv) iv.placeholder = f.ent ? 'ชื่อร้าน / สนามกอล์ฟ' : 'เช่น ทางด่วนบางนา–ชลบุรี, ส่งเอกสารให้ลูกค้า';
  const lr = $('[data-lbl="rcpt"]', root);
  if (lr) { lr.innerHTML = f.rcpt === 'YES' ? 'ใบเสร็จ' : 'ใบเสร็จ <span class="opt">ไม่บังคับ</span>'; lr.classList.toggle('req', f.rcpt === 'YES'); }
  const hr = $('[data-hint="rcpt"]', root);
  if (hr) hr.textContent = f.rcpt === 'YES' ? 'หมวดนี้ต้องแนบใบเสร็จ · รูปหรือ PDF ได้สูงสุด 10 ไฟล์' : 'มีบิลก็แนบได้ ไม่มีก็ส่งได้เลย';
  const fc = $('[data-g="fuelcalc"]', root);
  if (fc && f.fuel) fc.innerHTML = fuelBox(it, fuel);
  return f;
}

/** ตรวจรายการก่อนส่ง (กติกาเดียวกับ app.validate_item) → {ช่อง: ข้อความ} */
export function validateItem(it, rcptCount = 0) {
  const e = {};
  const c = catInfo(it.category);
  if (!it.category || !c) { e.category = 'เลือกหมวดค่าใช้จ่าย'; return e; }
  const f = catFlags(c);
  const d = String(it.expenseDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) e.expenseDate = 'ใส่วันที่ใช้จ่าย';
  else if (d > addDays(todayYMD(), 1)) e.expenseDate = 'วันที่อยู่ในอนาคต';
  else if (d < '2020-01-01') e.expenseDate = 'วันที่ไม่ถูกต้อง';
  if (f.fuel) {
    const km = Number(it.mileageKm) || 0;
    if (km <= 0) e.mileageKm = 'ใส่ระยะทาง (กม.)';
    else if (km > 3000) e.mileageKm = 'ระยะทางเกิน 3,000 กม. ต่อรายการ';
  } else {
    const a = Number(it.amount) || 0;
    if (a <= 0) e.amount = 'ใส่จำนวนเงิน';
    else if (a > 500000) e.amount = 'จำนวนเงินเกิน 500,000 บาทต่อรายการ';
  }
  if (f.ent) {
    if (!String(it.venue || '').trim()) e.venue = 'ใส่สถานที่';
    if (!String(it.occasion || '').trim()) e.occasion = 'ใส่โอกาส / วัตถุประสงค์';
    if (!String(it.attendees || '').trim()) e.attendees = 'ใส่ชื่อผู้ร่วม';
  }
  if (f.rcpt === 'YES' && !rcptCount) e.receipts = 'หมวดนี้ต้องแนบใบเสร็จอย่างน้อย 1 ไฟล์';
  return e;
}

/** แสดงข้อผิดพลาดใต้ช่อง · คืนช่องแรกที่ผิด */
export function showErrors(root, errs) {
  let first = null;
  $$('[data-err]', root).forEach((x) => {
    const m = errs[x.dataset.err];
    x.textContent = m || '';
    x.classList.toggle('hidden', !m);
    if (m && !first) first = x.closest('.field') || x;
  });
  $$('[data-f]', root).forEach((x) => x.classList.toggle('invalid', !!errs[x.dataset.f]));
  return first;
}
export function clearError(root, k) {
  const x = $(`[data-err="${k}"]`, root); if (x) { x.textContent = ''; x.classList.add('hidden'); }
  $(`[data-f="${k}"]`, root)?.classList.remove('invalid');
}
export const pickFields = (it) => Object.fromEntries(FIELDS.map((k) => [k, it[k] ?? '']));

// ════════════════════ หน้าเพจ ════════════════════

export async function render(ctx) {
  const { el, profile } = ctx;
  const email = String(profile?.email || state.session?.email || '').toLowerCase();
  const draftKey = 'exion_draft_' + email;
  const [cats, allow] = await Promise.all([
    loadCategories(),
    api.rpc('get_my_allowance', {}, { ttl: 600 }).catch(() => ({ auto: false })),
  ]);
  if (!ctx.alive()) return;

  // คนที่มีค่าเหมาจ่ายอัตโนมัติ → ซ่อนหมวดนั้น กันเบิกซ้ำ
  const hideCodes = allow?.auto ? ALLOW_CATS.filter((c) => Number(allow[c]) > 0) : [];
  // ค่ารับรอง / ค่ากอล์ฟ → ต้องขออนุมัติงบล่วงหน้าเท่านั้น (ไม่แสดงในหน้านี้)
  const pickable = (cats || []).filter((c) => c.active !== false && !hideCodes.includes(c.code) && !ENT_CATS.includes(c.code));
  const S = { items: [], fuel: null, ready: [], batchId: newBatchId(), seq: 0, sending: false, done: false, draftPending: false };

  el.innerHTML = `<div style="max-width:780px;margin:0 auto">
    <div class="page-head"><div><h1>ขอเบิกค่าใช้จ่าย</h1>
      <div class="sub">ส่งได้หลายรายการในครั้งเดียว${profile?.managerFullName ? ` · ผู้อนุมัติ ${esc(profile.managerFullName)}` : ''}</div></div>
      <div class="actions"><a class="btn btn-secondary btn-sm" href="#/preapprovals/new">${icon('shield', 'sm')} ขออนุมัติงบล่วงหน้า</a></div></div>
    <div class="stack">
      <div data-draft class="hidden"></div>
      <div class="alert neutral">${icon('shield')}<div class="grow">ค่ารับรอง / ค่ากอล์ฟ ต้อง<b>ขออนุมัติงบล่วงหน้า</b>ก่อน แล้วส่งบิลจริงจากงบนั้น
        <div class="mt-8"><a class="btn btn-secondary btn-sm" href="#/preapprovals/new">${icon('shield', 'sm')} ขออนุมัติงบล่วงหน้า</a></div></div></div>
      ${hideCodes.length ? `<div class="alert neutral">${icon('info')}<span>${hideCodes.map((c) => `${esc(catName(c))} ${money(allow[c], 0)}`).join(' · ')} บาท
        <b>ใส่ให้อัตโนมัติทุกรอบ</b> ไม่ต้องส่งเอง</span></div>` : ''}
      <div class="stack" data-items></div>
      <button type="button" class="add-item" data-act="add">${icon('plus')} เพิ่มรายการ</button>
    </div>
    <div class="submit-bar">
      <div class="grow"><div class="text-sm muted" data-count></div><div class="amount text-lg" data-total></div></div>
      <button type="button" class="btn btn-primary btn-lg" data-act="submit">${icon('send')} ส่งคำขอ</button>
    </div>
    <datalist id="exCustList"></datalist>
  </div>`;
  const box = $('[data-items]', el);

  // ── รายการ ──
  function makeItem(src = {}) {
    const it = { key: 'i' + ++S.seq, ...pickFields(src), paths: null, nFiles: 0, pick: false };
    if (!it.expenseDate) it.expenseDate = todayYMD();
    it.category = String(it.category || '').toUpperCase();
    if (it.category && !pickable.some((c) => c.code === it.category)) it.category = '';
    it.rpBox = document.createElement('div');
    it.rp = receiptPicker(it.rpBox, { max: 10, onChange: (n) => { it.paths = null; it.nFiles = n; if (n) clearError(cardOf(it) || el, 'receipts'); } });
    return it;
  }
  const cardOf = (it) => box.querySelector(`[data-key="${it.key}"]`);
  const itemOf = (node) => S.items.find((x) => x.key === node.closest('[data-key]')?.dataset.key);

  function cardEl(it) {
    const d = document.createElement('div');
    d.className = 'item-card'; d.dataset.key = it.key;
    d.innerHTML = `<div class="ic-head"><span class="ic-num"></span>
        <div class="grow"><div class="bold ellipsis" data-title></div><div class="text-sm muted ellipsis" data-sub></div></div>
        <span class="amount" data-amt></span>
        <button type="button" class="btn-icon" data-act="dup" aria-label="คัดลอกรายการนี้" title="คัดลอกรายการนี้">${icon('copy')}</button>
        <button type="button" class="btn-icon" data-act="remove" aria-label="ลบรายการนี้" title="ลบรายการนี้">${icon('trash')}</button></div>
      <div class="ic-body">
        <div class="field"><label class="req">หมวดค่าใช้จ่าย</label>
          <div class="flex gap-12 hidden" data-catsel></div>
          ${catPickerHtml(pickable, it.category)}
          <div class="err-text hidden" data-err="category"></div></div>
        <div class="hidden mt-16" data-g="body"><div class="hidden mb-12" data-g="pre"></div>${fieldsHtml(it)}</div>
      </div>`;
    $('[data-rslot]', d).appendChild(it.rpBox);
    return d;
  }

  function updateCard(it) {
    const card = cardOf(it); if (!card) return;
    const c = catInfo(it.category);
    const has = !!(it.category && c);
    $('[data-title]', card).textContent = has ? (c.name_th || catName(it.category)) : 'เลือกหมวดค่าใช้จ่าย';
    const desc = [fmtDate(it.expenseDate), it.venue || it.customer || (it.origin && it.destination ? `${it.origin} → ${it.destination}` : '')].filter((x) => x && x !== '-');
    $('[data-sub]', card).textContent = has ? desc.join(' · ') : 'แตะไอคอนด้านล่างเพื่อเลือก';
    const amt = itemAmount(it, S.fuel);
    $('[data-amt]', card).textContent = amt > 0 ? '฿' + money(amt) : '';
    $('[data-catsel]', card).classList.toggle('hidden', !has || it.pick);
    $('[data-picker]', card).classList.toggle('hidden', has && !it.pick);
    $$('[data-act="cat"]', card).forEach((b) => { b.classList.toggle('on', b.dataset.code === it.category); b.setAttribute('aria-pressed', String(b.dataset.code === it.category)); });
    if (has) {
      $('[data-catsel]', card).innerHTML = `${catIcon(it.category)}<div class="grow"><div class="bold">${esc(c.name_th)}</div>
        <div class="hint">${esc(c.notes || c.name_en || '')}${c.need_approval ? '' : `${c.notes || c.name_en ? ' · ' : ''}อนุมัติอัตโนมัติ`}</div></div>
        <button type="button" class="btn btn-ghost" data-act="chcat">เปลี่ยน</button>`;
    }
    $('[data-g="body"]', card).classList.toggle('hidden', !has);
    if (has) { const f = applyCat(card, it, S.fuel); preAlert(card, f); }
  }

  // หมวดค่ารับรอง/กอล์ฟ → แนะนำขออนุมัติงบก่อน / ชี้ไปงบที่อนุมัติแล้ว
  function preAlert(card, f) {
    const box_ = $('[data-g="pre"]', card);
    if (!ENT_CATS.includes(f.code)) { box_.classList.add('hidden'); return; }
    const ready = S.ready.filter((r) => r.category === f.code);
    box_.classList.remove('hidden');
    box_.innerHTML = ready.length
      ? `<div class="alert ok">${icon('check-circle')}<div class="grow">คุณมีงบ${esc(catName(f.code))}ที่อนุมัติแล้ว <b>฿${money(ready[0].preapprove_budget, 0)}</b>
          ${ready[0].venue ? `(${esc(ready[0].venue)} · ${fmtDate(ready[0].expense_date)})` : `(${fmtDate(ready[0].expense_date)})`} — ส่งบิลผ่านงบนี้แทน เพื่อไม่ให้เบิกซ้ำ
          <div class="mt-8"><a class="btn btn-success btn-sm" href="#/preapprovals/${encodeURIComponent(ready[0].id)}/finalize">${icon('receipt', 'sm')} ส่งบิลจริงของงบนี้</a>
          ${ready.length > 1 ? `<a class="btn btn-ghost btn-sm" href="#/preapprovals">ดูงบทั้งหมด (${ready.length})</a>` : ''}</div></div></div>`
      : `<div class="alert warn">${icon('shield')}<div class="grow">${esc(catName(f.code))}ควร<b>ขออนุมัติงบล่วงหน้า</b>ก่อนใช้จ่าย — ถ้ายังไม่ได้ขอ ส่งเบิกตรงนี้ได้ หัวหน้าจะพิจารณาตามปกติ
          <div class="mt-8"><a class="btn btn-secondary btn-sm" href="#/preapprovals/new">${icon('shield', 'sm')} ขออนุมัติงบล่วงหน้า</a></div></div></div>`;
  }

  function renumber() {
    const many = S.items.length > 1;
    S.items.forEach((it, i) => {
      const card = cardOf(it); if (!card) return;
      $('.ic-num', card).textContent = i + 1;
      $('[data-act="remove"]', card).classList.toggle('hidden', !many);
    });
    totals();
  }
  function totals() {
    const sum = S.items.reduce((s, it) => s + itemAmount(it, S.fuel), 0);
    $('[data-count]', el).textContent = `${S.items.length} รายการ`;
    $('[data-total]', el).textContent = '฿' + money(sum);
  }
  function addItem(src, after) {
    const it = makeItem(src);
    const card = cardEl(it);
    if (after) {
      S.items.splice(S.items.indexOf(after) + 1, 0, it);
      cardOf(after).after(card);
    } else { S.items.push(it); box.appendChild(card); }
    updateCard(it); renumber();
    return it;
  }
  function setItems(list) {
    S.items = []; box.innerHTML = '';
    (list.length ? list : [{}]).forEach((x) => addItem(x));
  }

  // ── ร่าง (ไม่เก็บไฟล์) ──
  const writeDraft = () => {
    if (S.done || S.draftPending) return;
    try {
      const items = S.items.map(pickFields);
      const has = items.some((x) => x.category || Number(x.amount) > 0 || Number(x.mileageKm) > 0 || x.venue || x.customer);
      if (!has) { localStorage.removeItem(draftKey); return; }
      localStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), files: S.items.reduce((s, x) => s + x.nFiles, 0), items }));
    } catch {}
  };
  const saveDraft = debounce(writeDraft, 1200);
  function readDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (!d?.items?.length || Date.now() - d.savedAt > DRAFT_DAYS * 86400e3) { localStorage.removeItem(draftKey); return null; }
      return d;
    } catch { return null; }
  }
  function offerDraft(d) {
    const zone = $('[data-draft]', el);
    S.draftPending = true;
    zone.classList.remove('hidden');
    zone.innerHTML = `<div class="alert warn">${icon('file')}<div class="grow"><b>มีใบเบิกที่กรอกค้างไว้</b>
      <div class="text-sm">${d.items.length} รายการ · บันทึกไว้ ${esc(timeAgo(new Date(d.savedAt)))}${d.files ? ` · ไฟล์แนบ ${d.files} ไฟล์ต้องแนบใหม่` : ''}</div>
      <div class="flex wrap mt-8"><button type="button" class="btn btn-primary btn-sm" data-act="draft-restore">${icon('rotate-ccw', 'sm')} ทำต่อ</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="draft-discard">ทิ้ง เริ่มใหม่</button></div></div></div>`;
  }
  const closeDraft = () => { S.draftPending = false; const z = $('[data-draft]', el); z.innerHTML = ''; z.classList.add('hidden'); };

  // ── เริ่มต้น ──
  let prefill = null;
  try { prefill = JSON.parse(sessionStorage.getItem('exion_prefill') || 'null'); sessionStorage.removeItem('exion_prefill'); } catch {}
  setItems(prefill ? [prefill] : []);
  if (prefill) toast('คัดลอกข้อมูลจากรายการเดิมแล้ว — ตรวจแล้วแนบใบเสร็จใหม่', 'info');
  const draft = readDraft();
  if (draft) offerDraft(draft);

  // โหลดข้อมูลเสริมตามหลัง (ไม่ต้องรอ)
  api.rpc('get_fuel_rate', {}, { ttl: 600 }).then((r) => { S.fuel = r; }).catch(() => { S.fuel = { error: true }; })
    .finally(() => { if (ctx.alive()) { S.items.forEach(updateCard); totals(); } });
  api.rpc('get_customers', {}, { ttl: 600 }).then((list) => {
    const dl = $('#exCustList', el);
    if (dl && ctx.alive()) dl.innerHTML = (list || []).map((c) => `<option value="${esc(c)}"></option>`).join('');
  }).catch(() => {});
  api.rpc('get_my_requests', {}, { ttl: 60 }).then((rows) => {
    S.ready = (rows || []).filter((r) => r.status === 'PreApprove' && r.preapprove_status === 'Approved' && !String(r.batch_id || '').startsWith('FINALIZE-'));
    if (ctx.alive() && S.ready.length) S.items.forEach(updateCard);
  }).catch(() => {});

  // ── ส่ง ──
  async function submit(btn, force = false) {
    if (S.sending) return;
    S.items.forEach((it) => $$('[data-f]', cardOf(it)).forEach((x) => { it[x.dataset.f] = x.value; }));   // กัน iOS date picker ไม่ยิง input
    let firstBad = null, nBad = 0;
    S.items.forEach((it) => {
      const errs = validateItem(it, it.rp.count());
      const bad = showErrors(cardOf(it), errs);
      if (bad) { nBad++; firstBad = firstBad || bad; if (errs.category) { it.pick = true; updateCard(it); } }
    });
    if (firstBad) {
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('[data-f].invalid', firstBad)?.focus({ preventScroll: true });
      toast(nBad > 1 ? `กรอกไม่ครบ ${nBad} รายการ — ดูช่องสีแดง` : 'กรอกข้อมูลไม่ครบ — ดูช่องสีแดง', 'bad');
      return;
    }
    S.sending = true;
    btn.disabled = true;
    let res;
    try {
      res = await busy('กำลังเตรียมข้อมูล…', async (set) => {
        for (let i = 0; i < S.items.length; i++) {
          const it = S.items[i];
          const f = catFlags(catInfo(it.category));
          if (f.rcpt === 'NO') { it.paths = []; continue; }
          if (!it.paths) it.paths = await it.rp.uploadAll((k, n) => set(`อัปโหลดใบเสร็จ รายการ ${i + 1} (${k}/${n})`));
        }
        set(`กำลังส่ง ${S.items.length} รายการ…`);
        return api.rpc('submit_batch', { p: { batchId: S.batchId, force, items: S.items.map(payloadItem) } });
      });
    } catch (e) {
      // "รายการ 2: ..." → เลื่อนไปที่การ์ดนั้น
      const m = /^รายการ (\d+)/.exec(e?.message || '');
      const it = m ? S.items[+m[1] - 1] : null;
      if (it) cardOf(it)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toastError(e);
      return;
    } finally { S.sending = false; btn.disabled = false; }

    if (res?.duplicate?.length) {
      const lines = res.duplicate.map((d) => `• รายการ ${d.idx + 1} — ${catName(d.category)} ${fmtDate(d.date)} ${d.km ? money(d.km, 1) + ' กม.' : money(d.amount) + ' บาท'} (ส่งไปแล้ว${d.status === 'Pending' ? ' · รออนุมัติ' : d.status === 'Approved' ? ' · อนุมัติแล้ว' : ''})`);
      const ok = await confirmBox({ title: 'อาจเป็นรายการซ้ำ', ok: 'ไม่ซ้ำ ส่งเลย', cancel: 'กลับไปแก้',
        message: `พบรายการวันเดียวกัน หมวดเดียวกัน ยอดเท่ากันที่ส่งไปแล้ว:\n\n${lines.join('\n')}\n\nถ้าไม่ใช่รายการซ้ำ (เช่น ทางด่วนไป–กลับ) กด "ไม่ซ้ำ ส่งเลย"` });
      if (ok && ctx.alive()) return submit(btn, true);
      return;
    }
    S.done = true;
    try { localStorage.removeItem(draftKey); } catch {}
    const items = res?.items || [];
    const auto = items.filter((x) => x.status === 'Approved').length;
    toast(res?.alreadySubmitted ? 'ชุดนี้ส่งไปแล้วก่อนหน้านี้ — ไม่บันทึกซ้ำ'
      : `ส่งคำขอแล้ว ${items.length} รายการ${auto ? ` (อนุมัติอัตโนมัติ ${auto})` : ''}`);
    ctx.refreshBadges?.();
    ctx.go('/requests');
  }

  // ── เหตุการณ์ ──
  const offs = [
    on(el, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act, it = itemOf(t);
      if (a === 'cat' && it) {
        const changed = it.category !== t.dataset.code;
        it.category = t.dataset.code; it.pick = false;
        if (changed) { it.paths = null; noteCatUse(it.category); }
        clearError(cardOf(it), 'category');
        updateCard(it); totals(); saveDraft();
      } else if (a === 'chcat' && it) { it.pick = true; updateCard(it); }
      else if (a === 'add') {
        const last = S.items[S.items.length - 1];
        const n = addItem({ expenseDate: last?.expenseDate || todayYMD() });
        setTimeout(() => cardOf(n)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      } else if (a === 'dup' && it) {
        const n = addItem({ ...pickFields(it) }, it);
        toast(it.nFiles ? 'คัดลอกรายการแล้ว — ใบเสร็จไม่ถูกคัดลอก' : 'คัดลอกรายการแล้ว', 'info');
        setTimeout(() => cardOf(n)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
        saveDraft();
      } else if (a === 'remove' && it) {
        if (S.items.length === 1) return;
        const filled = it.category && (Number(it.amount) > 0 || Number(it.mileageKm) > 0 || it.nFiles);
        if (filled && !(await confirmBox({ title: 'ลบรายการนี้?', message: `${catName(it.category)} ${money(itemAmount(it, S.fuel))} บาท`, ok: 'ลบ', danger: true }))) return;
        S.items.splice(S.items.indexOf(it), 1);
        cardOf(it)?.remove();
        renumber(); saveDraft();
      } else if (a === 'submit') submit(t);
      else if (a === 'draft-restore') {
        const d = readDraft(); closeDraft();
        if (d) { setItems(d.items); toast(`กู้คืนแล้ว ${d.items.length} รายการ${d.files ? ' — อย่าลืมแนบใบเสร็จใหม่' : ''}`); }
        writeDraft();
      } else if (a === 'draft-discard') {
        closeDraft();
        try { localStorage.removeItem(draftKey); } catch {}
        writeDraft();
      }
    }),
    on(el, 'input', '[data-f]', (e, t) => {
      const it = itemOf(t); if (!it) return;
      it[t.dataset.f] = t.value;
      clearError(cardOf(it), t.dataset.f);
      if (['mileageKm', 'amount', 'expenseDate', 'venue', 'customer', 'origin', 'destination'].includes(t.dataset.f)) {
        updateHead(it);
        if (t.dataset.f === 'mileageKm') { const fc = $('[data-g="fuelcalc"]', cardOf(it)); if (fc) fc.innerHTML = fuelBox(it, S.fuel); }
        totals();
      }
      saveDraft();
    }),
    on(el, 'change', '[data-f]', (e, t) => { const it = itemOf(t); if (it) { it[t.dataset.f] = t.value; updateHead(it); totals(); saveDraft(); } }),
  ];
  // อัปเดตเฉพาะหัวการ์ด (ไม่วาดช่องใหม่ ไม่ให้เคอร์เซอร์หลุด)
  function updateHead(it) {
    const card = cardOf(it); if (!card || !it.category) return;
    const desc = [fmtDate(it.expenseDate), it.venue || it.customer || (it.origin && it.destination ? `${it.origin} → ${it.destination}` : '')].filter((x) => x && x !== '-');
    $('[data-sub]', card).textContent = desc.join(' · ');
    const amt = itemAmount(it, S.fuel);
    $('[data-amt]', card).textContent = amt > 0 ? '฿' + money(amt) : '';
  }
  const onHide = () => { if (document.hidden) writeDraft(); };
  document.addEventListener('visibilitychange', onHide);
  return () => { offs.forEach((f) => f()); document.removeEventListener('visibilitychange', onHide); writeDraft(); };
}

function newBatchId() {
  return 'BATCH-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** แปลงรายการ → JSON ที่ submit_batch รับ (ล้างช่องที่หมวดนี้ไม่ใช้) */
function payloadItem(it) {
  const f = catFlags(catInfo(it.category));
  const t = (k) => String(it[k] ?? '').trim();
  const o = {
    category: f.code, expenseDate: it.expenseDate,
    venue: f.fuel ? '' : t('venue'),
    occasion: f.ent ? t('occasion') : '', attendees: f.ent ? t('attendees') : '',
    origin: f.travel ? t('origin') : '', destination: f.travel ? t('destination') : '',
    customer: f.travel || f.ent ? t('customer') : '',
    customerContact: (f.travel && !f.fuel) || f.ent ? t('customerContact') : '',
    jobNo: f.job ? t('jobNo') : '',
    receiptPaths: it.paths || [],
  };
  if (f.fuel) o.mileageKm = Number(it.mileageKm) || 0; else o.amount = Number(it.amount) || 0;
  return o;
}
