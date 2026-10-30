// ขอเบิก Petty Cash (ใบสำคัญจ่าย) — ค่าใช้จ่าย / Advance entertain · เลือกหมวดทุกบรรทัด · HR กรอกแทนได้ · แก้ใบที่ถูกตีกลับ (?id=)
// บัญชีแก้ไขใบ (?id=&fin=1): แก้ได้ทุกช่อง + VAT / หัก ณ ที่จ่าย + รหัสแผนก · ไม่เริ่มสายอนุมัติใหม่
import { api, money, esc, todayYMD, loadPettyCategories } from '../core.js?v=10.2.1';
import { icon, catIcon, toast, toastError, confirmBox, busy, receiptPicker, errorBox, debounce, on, $, $$ } from '../ui.js?v=10.2.1';
import { DOCS, whtLines } from './pv-common.js?v=10.2.1';

// คำอธิบายหมวด: อะไรเข้าหมวดนี้บ้าง (การ์ดตอนชี้ที่ปุ่มหมวด + ใต้หมวดที่เลือก)
const CAT_HINT = {
  OFFICE: 'ค่าใช้จ่ายส่วนกลางของสำนักงาน เช่น ค่าน้ำ-ไฟ ค่าอินเทอร์เน็ต/โทรศัพท์สำนักงาน ค่าเช่าเครื่องถ่ายเอกสาร ค่าแม่บ้าน/รปภ.',
  SUPPLY: 'เช่น กระดาษ ปากกา แฟ้ม หมึกพิมพ์ ซองเอกสาร อุปกรณ์คอมพิวเตอร์ชิ้นเล็ก (เมาส์ คีย์บอร์ด)',
  POST: 'เช่น ไปรษณีย์ EMS ค่าส่งของ Kerry / Flash / Lalamove ค่าแมสเซนเจอร์ส่งเอกสาร',
  SERVICE: 'เช่น ค่า Service ค่าจ้างช่าง/ผู้รับเหมา ค่าติดตั้ง ค่าสอบเทียบ (Calibration) ค่าตรวจเช็ค',
  MATERIAL: 'เช่น อะไหล่ วัสดุ อุปกรณ์ที่ซื้อเข้างานลูกค้า วัสดุสิ้นเปลืองหน้างาน',
  WATER: 'เช่น น้ำดื่ม กาแฟ ของใช้ในครัว กระดาษทิชชู่ น้ำยาทำความสะอาด',
  REPAIR: 'เช่น ซ่อมแอร์ ซ่อมรถบริษัท ซ่อมเครื่องใช้สำนักงาน ค่าบำรุงรักษา',
  TRAVEL: 'เช่น ตั๋วเครื่องบิน รถทัวร์/รถไฟ ค่าโรงแรม ค่าเดินทางไปต่างจังหวัด',
  ENT: 'เช่น เลี้ยงรับรองลูกค้า ของขวัญ/ของฝากลูกค้า',
  TAXI: 'เช่น แท็กซี่ Grab / Bolt วินมอเตอร์ไซค์ (ไม่บังคับใบเสร็จ)',
  WELFARE: 'เช่น ขนม/อาหารประชุม ของเยี่ยมไข้ งานวันเกิดพนักงาน รับรองแขกเล็กน้อย',
  FEE: 'เช่น ค่าธรรมเนียมโอนเงิน ค่าอากรแสตมป์ ค่าธรรมเนียมราชการ ค่าบริการออนไลน์',
  OTHER: 'ค่าใช้จ่ายที่ไม่เข้าหมวดไหน — อธิบายในช่องรายละเอียดให้ชัด',
};
// เลือก "อื่นๆ" แต่รายละเอียดมีคำเหล่านี้ → เตือนว่าน่าจะอยู่หมวดอื่น
const CAT_WORDS = {
  TAXI: ['แท็กซี่', 'taxi', 'grab', 'bolt', 'วินมอเตอร์ไซค์', 'ทางด่วน', 'ที่จอดรถ', 'bts', 'mrt', 'น้ำมัน'],
  POST: ['ไปรษณีย์', 'ems', 'kerry', 'flash', 'lalamove', 'ส่งของ', 'ขนส่ง', 'แมส', 'messenger', 'ค่าส่ง', 'dhl', 'j&t', 'postage'],
  TRAVEL: ['ตั๋ว', 'เครื่องบิน', 'โรงแรม', 'ที่พัก', 'รถทัวร์', 'รถไฟ', 'hotel', 'flight', 'air ticket', 'airasia'],
  ENT: ['เลี้ยง', 'รับรองลูกค้า', 'ของขวัญ', 'ของฝาก', 'entertain'],
  WELFARE: ['ขนม', 'อาหารประชุม', 'เยี่ยมไข้', 'วันเกิด', 'พวงหรีด', 'ทำบุญ', 'สวัสดิการ'],
  SUPPLY: ['กระดาษ', 'ปากกา', 'แฟ้ม', 'หมึก', 'ซองเอกสาร', 'เครื่องเขียน', 'เมาส์', 'คีย์บอร์ด', 'ลวดเย็บ', 'stationery', 'toner'],
  WATER: ['น้ำดื่ม', 'กาแฟ', 'ทิชชู', 'น้ำยา', 'ของใช้ในครัว', 'pantry'],
  REPAIR: ['ซ่อม', 'บำรุง', 'repair', 'maintenance'],
  SERVICE: ['ช่าง', 'ผู้รับเหมา', 'ติดตั้ง', 'สอบเทียบ', 'calibration', 'ค่าจ้าง', 'ค่าแรง', 'contractor'],
  MATERIAL: ['อะไหล่', 'วัสดุ', 'อุปกรณ์งาน', 'spare part', 'สายไฟ', 'น็อต', 'material'],
  FEE: ['ค่าธรรมเนียม', 'อากร', 'แสตมป์', 'ราชการ', 'subscription', 'membership', 'ค่าสมาชิก'],
  OFFICE: ['ค่าน้ำประปา', 'ค่าไฟ', 'อินเทอร์เน็ต', 'internet', 'ค่าโทรศัพท์', 'ค่าเช่า', 'แม่บ้าน', 'รปภ', 'ถ่ายเอกสาร', 'telephone bill'],
};
const guessCat = (text) => {
  const t = String(text || '').toLowerCase();
  if (!t) return '';
  return Object.keys(CAT_WORDS).find((k) => CAT_WORDS[k].some((w) => t.includes(w))) || '';
};

const DRAFT_KEY = 'exion_pv_draft', RECENT_KEY = 'exion_pv_recent_who';
const pettyFund = () => { try { return localStorage.getItem('exion_petty_fund') || ''; } catch { return ''; } };   // กล่องที่เลือกไว้ในหน้าแรกเงินสดย่อย
const loadJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const saveJSON = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function render(ctx) {
  const { el, query } = ctx;
  let meta, old = null, cats = [];
  try {
    [meta, old, cats] = await Promise.all([api.rpc('get_pv_form_meta', {}, { ttl: 60 }), query.id ? api.rpc('get_pv', { p_id: query.id }) : null, loadPettyCategories()]);
  } catch (e) { if (ctx.alive()) errorBox(el, e, () => render(ctx)); return; }
  if (!ctx.alive()) return;
  const fin = !!(old && query.fin && old.canFinEdit);   // บัญชีแก้ไขใบ
  if (old && !fin && !old.canEdit) { ctx.go('/pv/view?id=' + encodeURIComponent(old.id)); return; }
  if (old) ctx.setTitle((fin ? 'บัญชีแก้ไข ' : 'แก้ไข ') + old.id);

  // ใบใหม่: กู้ร่างที่กรอกค้างไว้ (ไม่รวมไฟล์แนบ)
  const draft = old ? null : loadJSON(DRAFT_KEY, null);
  const src = old || draft || {};
  const st = { type: (old?.kind === 'ADV' || draft?.type === 'ADV') ? 'ADV' : 'EXP', who: draft?.who || '', needJob: false, seq: 0, whoDept: '', whoOpen: false,
    vat: fin ? Number(old.vatRate) || 0 : 0, wht: fin ? whtLines(old).map((w) => ({ rate: Number(w.rate), base: Number(w.base) })) : [] };
  const staff = (meta.staff || []).filter((x) => x.email !== meta.me.email);
  const up = (a) => (a || []).map((d) => String(d).toUpperCase());
  const jobDepts = up(meta.jobDepts), jobCats = up(meta.jobCats || ['MATERIAL', 'SERVICE']), entCats = up(meta.entCats || ['ENT']);
  const officeCats = up(meta.officeCats || ['OFFICE']);
  if (st.who && !staff.some((x) => x.email === st.who)) st.who = '';
  const catOf = (code) => cats.find((c) => c.code === code);
  const pickers = {};
  const paid = fin && old.status === 'Paid';

  el.innerHTML = `
  <div class="stack">
    ${draft ? `<div class="alert" data-draftbar>${icon('info')}<div class="grow">กู้ข้อมูลที่กรอกค้างไว้แล้ว · ไฟล์แนบต้องแนบใหม่</div><button type="button" class="btn btn-ghost btn-sm" data-act="draft-clear">เริ่มใหม่</button></div>` : ''}
    ${old && !fin ? `<div class="alert bad">${icon('alert')}<div><b>ถูกตีกลับ:</b> ${esc(old.remark || '-')}<br><span class="text-sm">แก้ไขแล้วกดส่งใหม่ ใบจะเริ่มอนุมัติใหม่ตั้งแต่ขั้นแรก (เลขเดิม ${esc(old.id)})</span></div></div>` : ''}
    ${fin ? `<div class="alert">${icon('edit')}<div><b>บัญชีแก้ไขใบ ${esc(old.id)}</b> · ${esc(old.requesterName)}<br><span class="text-sm">ไม่เริ่มสายอนุมัติใหม่ · ระบบบันทึกว่าแก้อะไรในประวัติ และแจ้งคนเบิก${paid ? ' · <b>ใบนี้จ่ายแล้ว แก้ยอดเงินไม่ได้</b>' : ''}</span></div></div>` : ''}
    ${!fin ? `<div class="card pad stack-sm">
      ${!old ? `<div class="seg" role="tablist" data-type>
        <button type="button" data-t="EXP" class="${st.type === 'EXP' ? 'on' : ''}">${icon('receipt', 'sm')} ค่าใช้จ่าย</button>
        <button type="button" data-t="ADV" class="${st.type === 'ADV' ? 'on' : ''}">${icon('utensils', 'sm')} Advance entertain</button></div>` : ''}
      ${meta.canBehalf && !old ? `<div class="field"><label>เบิกให้</label><div class="pv-who" data-whobox></div>
        <div class="hint">HR / บัญชีกรอกแทนได้ — ใบเป็นของคนที่เลือก และขึ้นว่ากรอกโดยคุณ</div></div>` : ''}
      <p class="hint" data-typehint></p>
    </div>` : ''}

    <div class="card pad stack-sm">
      <div class="form-grid two">
        <div class="field span-2"><label class="req" for="pv-supplier">Supplier <span class="opt">หัวกระดาษใบฟ้า</span></label>
          <input class="input" id="pv-supplier" data-f="supplier" maxlength="150" list="pv-suppliers" autocomplete="off" value="${esc(old ? old.supplierRaw || old.supplier || '' : src.supplier || '')}">
          <datalist id="pv-suppliers"></datalist></div>
        <div class="field span-2"><label class="req" for="pv-payee">จ่ายให้</label>
          <div class="flex gap-8"><input class="input grow" id="pv-payee" data-f="payee" maxlength="150" list="pv-payees" autocomplete="off" value="${esc(src.payee || '')}">
            <button type="button" class="btn btn-ghost btn-sm nowrap" data-act="payee-same">เหมือน Supplier</button></div>
          <datalist id="pv-payees"></datalist><div class="hint hidden" data-payeehint></div></div>
        <div class="field"><label for="pv-bank">ธนาคาร <span class="opt">ไม่บังคับ</span></label>
          <input class="input" id="pv-bank" data-f="payBank" maxlength="100" value="${esc(src.payBank || '')}"></div>
        <div class="field"><label for="pv-acc">เลขบัญชี <span class="opt">ไม่บังคับ</span></label>
          <input class="input" id="pv-acc" data-f="payAccount" maxlength="50" inputmode="numeric" value="${esc(src.payAccount || '')}"></div>
        <div class="field"><label class="req" for="pv-date" data-datelabel>วันที่</label>
          <input type="date" class="input" id="pv-date" data-f="expenseDate" value="${esc(src.expenseDate || todayYMD())}">
          <div class="hint">ขึ้นที่ลายเซ็นผู้จัดทำในใบฟ้า</div></div>
        ${fin ? `<div class="field"><label for="pv-dept">แผนก (ใบฟ้า / รายงาน)</label><select class="input" id="pv-dept" data-f="deptCode">
          ${(meta.deptCodes || []).some((d) => d.code === old.deptCode) ? '' : `<option value="${esc(old.deptCode || '')}">${esc(old.deptCode || '-')}</option>`}
          ${(meta.deptCodes || []).map((d) => `<option value="${esc(d.code)}" ${d.code === old.deptCode ? 'selected' : ''}>${esc(d.code)} · ${esc(d.name)}</option>`).join('')}</select></div>` : ''}
      </div>
    </div>

    <div class="card pad stack-sm">
      <div class="flex between wrap"><b>รายการ</b><span class="text-sm muted">${fin ? 'ยอดก่อน VAT' : 'ยอดก่อน VAT · บัญชีเป็นคนใส่ VAT / หัก ณ ที่จ่าย'}</span></div>
      <p class="hint" data-officehint></p>
      <div class="stack-sm" data-lines></div>
      <button type="button" class="add-item" data-act="add-line">${icon('plus')} เพิ่มบรรทัด</button>
    </div>

    ${fin ? `<div class="card pad stack-sm"><b>VAT / หัก ณ ที่จ่าย</b><div class="stack-sm" data-taxbox></div></div>` : ''}

    <div class="card pad stack-sm" data-jobbox>
      <b>ข้อมูล Job <span class="opt" data-jopt>ไม่บังคับ · กรอกแล้วขึ้นในใบฟ้า</span></b>
      <div class="form-grid two">
        <div class="field"><label data-jreq for="pv-job">Job No.</label><input class="input" id="pv-job" data-f="jobNo" maxlength="50" value="${esc(src.jobNo || '')}"></div>
        <div class="field"><label data-jreq for="pv-po">PO No.</label><input class="input" id="pv-po" data-f="poNo" maxlength="50" value="${esc(src.poNo || '')}"></div>
        <div class="field"><label data-jreq for="pv-cs">Cost sheet No.</label><input class="input" id="pv-cs" data-f="costSheetNo" maxlength="50" value="${esc(src.costSheetNo || '')}"></div>
        <div class="field"><label for="pv-dd">วันที่จัดส่งสินค้า <span class="opt">ไม่บังคับ</span></label><input type="date" class="input" id="pv-dd" data-f="deliveryDate" value="${esc(src.deliveryDate || '')}"></div>
      </div>
    </div>

    <div class="card pad stack-sm" data-filebox>
      <b>ไฟล์แนบ</b> <span class="text-sm muted">ถ่ายรูปหรือเลือกไฟล์ (รูป / PDF)</span>
      ${DOCS.map(([k, label]) => `<div class="field" data-doc="${k}"><label>${label}</label><div data-picker="${k}"></div></div>`).join('')}
    </div>

    <div class="card pad stack-sm">
      <div class="form-grid two">
        <div class="field span-2"><label for="pv-note">หมายเหตุ <span class="opt">ไม่บังคับ</span></label>
          <input class="input" id="pv-note" data-f="note" maxlength="300" value="${esc(src.note || '')}"></div>
        <div class="field"><label for="pv-need">ต้องการใช้เงินวันที่ <span class="opt">ถ้ารีบใช้</span></label>
          <input type="date" class="input" id="pv-need" data-f="needDate" value="${esc(src.needDate || '')}">
          <div class="hint">ขึ้นต่อท้ายหมายเหตุในใบฟ้า</div></div>
      </div>
    </div>

    <div class="submit-bar">
      <div class="grow" style="min-width:0"><div class="text-sm muted" data-count></div><div class="amount text-lg" data-total>0.00</div></div>
      <button type="button" class="btn btn-primary btn-lg" data-act="submit">${icon(fin ? 'check' : 'send')} ${fin ? 'บันทึกการแก้ไข' : old ? 'ส่งใหม่' : 'ส่งใบเบิก'}</button>
    </div>
  </div>
  <div class="cat-tip hidden" data-cattip role="tooltip"></div>`;

  DOCS.forEach(([k]) => { pickers[k] = receiptPicker($(`[data-picker="${k}"]`, el), { max: 10, existing: old?.docs?.[k] || [] }); });
  const linesBox = $('[data-lines]', el);
  const chosenHtml = (code) => { const c = catOf(code); return c ? `${catIcon(code)}<div class="grow" style="min-width:0"><b>${esc(c.name_th)}</b>${c.name_en ? ` <span class="text-xs muted">${esc(c.name_en)}</span>` : ''}<div class="hint" data-cathint>${esc(CAT_HINT[code] || '')}</div></div>
      <button type="button" class="btn btn-ghost btn-sm" data-act="cat-change">เปลี่ยนหมวด</button>` : `<button type="button" class="btn btn-ghost btn-sm" data-act="cat-change">เปลี่ยนหมวด</button>`; };
  function addLine(desc = '', amt = '', cat = '') {
    const k = ++st.seq;
    const d = document.createElement('div');
    d.className = 'pv-line-card' + (cat ? '' : ' picking'); d.dataset.line = k; d.dataset.catval = cat;   // ไม่ใช้ data-cat บนการ์ด (ชนกับปุ่มหมวด)
    d.innerHTML = `<div data-catwrap>
      <div class="pv-cat-chosen" data-catchosen>${chosenHtml(cat)}</div>
      <div class="cat-picker" data-cats>${cats.map((c) => `<button type="button" class="cat-opt ${c.code === cat ? 'on' : ''}" data-cat="${esc(c.code)}" aria-describedby="pv-cattip">${catIcon(c.code)}<span>${esc(c.name_th)}</span></button>`).join('')}</div>
</div>
      <div class="pv-line pv-line-lab"><span class="label">รายละเอียด <span class="opt">ไม่บังคับ</span></span><span class="label">จำนวนเงิน</span></div>
      <div class="pv-line"><input class="input" data-l="description" maxlength="300" aria-label="รายละเอียด" value="${esc(desc)}">
      <div class="input-group has-suf"><input type="number" class="input" data-l="amount" inputmode="decimal" step="0.01" min="0" aria-label="จำนวนเงิน" value="${Number(amt) > 0 ? esc(amt) : ''}"><span class="suf">บาท</span></div>
      <button type="button" class="btn-icon sm" data-act="rm-line" aria-label="ลบบรรทัด">${icon('trash')}</button></div>
      <div class="pv-catwarn hidden" data-catwarn></div>`;
    linesBox.appendChild(d);
    renumber();
    checkOther(d);
  }
  const lineRows = () => $$('.pv-line-card', linesBox);
  function renumber() { lineRows().forEach((r) => r.querySelector('[data-act=rm-line]').classList.toggle('hidden', lineRows().length < 2)); }
  function lines() {
    return lineRows().map((r) => ({ description: r.querySelector('[data-l=description]').value.trim(), amount: r2(r.querySelector('[data-l=amount]').value),
      category: st.type === 'ADV' ? 'ENT' : r.dataset.catval || '' }));
  }
  // เลือก "อื่นๆ" แต่สิ่งที่พิมพ์น่าจะอยู่หมวดอื่น → เตือน + ปุ่มเปลี่ยน
  function checkOther(card) {
    const box = card.querySelector('[data-catwarn]'); if (!box) return;
    const g = card.dataset.catval === 'OTHER' && st.type !== 'ADV' ? guessCat(card.querySelector('[data-l=description]').value) : '';
    const c = g && catOf(g);
    box.classList.toggle('hidden', !c);
    box.innerHTML = c ? `${icon('alert', 'sm')}<span class="grow">รายการนี้น่าจะอยู่หมวด <b>${esc(c.name_th)}</b> มากกว่า "อื่นๆ"</span>
      <button type="button" class="btn btn-secondary btn-sm" data-catfix="${esc(g)}">ใช้หมวดนี้</button>` : '';
  }
  function setCat(card, code) {
    card.dataset.catval = code; card.classList.remove('picking');
    $$('.cat-opt', card).forEach((o) => o.classList.toggle('on', o.dataset.cat === code));
    $('[data-catchosen]', card).innerHTML = chosenHtml(code);
    checkOther(card); hideTip();
    layout(); preview(); saveDraft(); if (fin) paintTax();
  }
  // ใบนี้เป็นค่าใช้จ่ายสำนักงาน = ทุกบรรทัดเป็นหมวดสำนักงาน (ส่งไปผู้อนุมัติค่าใช้จ่ายสำนักงาน)
  const isOffice = () => st.type !== 'ADV' && lines().length > 0 && lines().every((l) => officeCats.includes(l.category));
  const mixedOffice = () => st.type !== 'ADV' && lines().some((l) => officeCats.includes(l.category)) && !isOffice();
  // สายของใบตามหมวด (ฐานข้อมูลตัดสินซ้ำตอนส่ง): ซื้อของหน้างาน → job · Entertain ทั้งใบ → ent · สำนักงาน → office · อื่น → other
  function mode() {
    const L = lines();
    if (st.type === 'ADV') return 'ent';
    if (L.some((l) => jobCats.includes(l.category))) return 'job';
    if (L.length && L.every((l) => officeCats.includes(l.category))) return 'office';
    if (L.length && L.every((l) => entCats.includes(l.category))) return 'ent';
    return 'other';
  }
  const entAmt = () => r2(lines().filter((l) => st.type === 'ADV' || entCats.includes(l.category)).reduce((s, l) => s + l.amount, 0));
  const total = () => r2(lines().reduce((s, l) => s + l.amount, 0));
  (src.lines?.length ? src.lines : [{ description: '', amount: '', category: '' }]).forEach((l) => addLine(l.description, l.amount, l.category || ''));

  const val = (f) => $(`[data-f="${f}"]`, el)?.value.trim() || '';

  // แสดง/ซ่อนส่วนตามประเภท + แผนก + หมวด
  function layout() {
    const adv = st.type === 'ADV', job = st.needJob && !fin;
    const th = $('[data-typehint]', el);
    if (th) th.innerHTML = adv
      ? `ขอเงินล่วงหน้าไปเลี้ยงรับรอง · รับเงินแล้วต้องเคลียร์ใบเสร็จภายใน <b>${Number(meta.advDays) || 15} วัน</b>`
      : job ? 'ซื้อของหน้างาน: ต้องกรอก <b>Job No., PO No., Cost sheet No.</b> และแนบ <b>Cost sheet, PO, Invoice</b>' : 'แนบใบเสร็จตามหมวดที่เลือก';
    $('[data-datelabel]', el).textContent = adv ? 'วันที่จะใช้' : 'วันที่';
    $$('[data-catwrap]', el).forEach((c) => c.classList.toggle('hidden', adv));
    $('[data-officehint]', el).innerHTML = mixedOffice() ? '<span class="err-text">ค่าใช้จ่ายสำนักงานต้องแยกเป็นอีกใบ (ไม่ปนกับหมวดอื่น)</span>' : '';
    // ข้อมูล Job: เซลล์ซื้อของหน้างานบังคับ · อื่นๆ กรอกได้ (ไม่บังคับ) กรอกแล้วขึ้นในใบฟ้า
    $$('[data-jreq]', el).forEach((l) => l.classList.toggle('req', job && !adv));
    $('[data-jopt]', el).classList.toggle('hidden', job && !adv);
    $('[data-filebox]', el).classList.toggle('hidden', adv && !fin);
    $$('[data-doc]', el).forEach((d) => {
      // ซื้อของหน้างาน: Cost sheet / PO / Invoice บังคับ · อื่นๆ: ใบเสร็จตามกฎหมวด + แนบ Cost sheet / PO / Invoice เพิ่มได้
      const k = d.dataset.doc, show = job ? k !== 'receipt' : true;
      d.classList.toggle('hidden', !show);
      d.querySelector('label').classList.toggle('req', !fin && show && !adv && (job || (k === 'receipt' && needReceipt())));
    });
  }
  // แนบใบเสร็จตามกฎหมวด: มีบรรทัดไหนเป็นหมวดที่ต้องแนบ → ต้องแนบ
  function needReceipt() { return lines().some((l) => (catOf(l.category)?.need_receipt || 'YES') === 'YES'); }
  function recalc() {
    $('[data-count]', el).textContent = `${lineRows().length} บรรทัด · ${fin ? 'ยอดจ่ายสุทธิ' : 'ยอดก่อน VAT'}`;
    $('[data-total]', el).textContent = money(fin ? taxTotals().net : total()) + ' บาท';
  }
  // ถามฐานข้อมูลว่าใบนี้ต้องกรอก Job ไหม (เซลล์ + ซื้อของหน้างาน) · ไม่แสดงสายอนุมัติบนฟอร์ม
  const preview = debounce(async () => {
    if (fin) return;
    try {
      const r = await api.rpc('get_pv_preview', { p_requester: old ? old.requesterEmail : st.who, p_amount: total(), p_office: false, p_mode: mode(), p_ent: entAmt() }, { ttl: 30, quiet: true });
      if (!ctx.alive()) return;
      st.needJob = !!r.needJob;
      layout();
    } catch { /* ฟอร์มยังกรอกได้ · ฐานข้อมูลตรวจซ้ำตอนส่ง */ }
  }, 300);

  // ── VAT / หัก ณ ที่จ่าย (เฉพาะบัญชีแก้ไข) ──
  function taxTotals() {
    const b = total(), va = r2(b * st.vat / 100), wa = r2(st.wht.reduce((s, w) => s + r2((Number(w.base) || 0) * w.rate / 100), 0));
    return { b, va, wa, net: r2(b + va - wa) };
  }
  function paintTax() {
    const box = $('[data-taxbox]', el); if (!box) return;
    const t = taxTotals();
    box.innerHTML = `<div class="flex wrap gap-16">
        <div><div class="text-sm muted mb-8">VAT</div><div class="seg"><button type="button" data-vat="0" class="${st.vat === 0 ? 'on' : ''}">ไม่มี</button><button type="button" data-vat="7" class="${st.vat === 7 ? 'on' : ''}">7%</button></div></div></div>
      <div class="pv-wht">${st.wht.map((w, i) => `<div class="pv-wht-row" data-whti="${i}">
          <div class="seg sm">${[1, 3, 5].map((r) => `<button type="button" data-whtrate="${r}" class="${w.rate === r ? 'on' : ''}">${r}%</button>`).join('')}</div>
          <div class="input-group has-pre"><span class="pre">ฐาน</span><input type="number" class="input" data-whtbase inputmode="decimal" step="0.01" min="0" aria-label="ยอดฐานหัก ณ ที่จ่าย" value="${w.base || ''}"></div>
          <span class="amount nowrap">${money(r2((Number(w.base) || 0) * w.rate / 100))}</span>
          <button type="button" class="btn-icon sm" data-whtrm="${i}" aria-label="ลบบรรทัดหัก ณ ที่จ่าย">${icon('trash')}</button></div>`).join('')}
        <button type="button" class="btn btn-ghost btn-sm" data-act="wht-add">${icon('plus', 'sm')} เพิ่มหัก ณ ที่จ่าย</button></div>
      <div class="text-sm">${money(t.b)} ${st.vat ? `+ VAT ${money(t.va)}` : ''} ${t.wa ? `− หัก ณ ที่จ่าย ${money(t.wa)}` : ''} = <b class="amount">${money(t.net)}</b> บาท
        ${paid && Math.abs(t.net - Number(old.amount)) > 0.004 ? `<span class="err-text"> · ต้องเท่ายอดที่จ่ายไปแล้ว ${money(old.amount)}</span>` : ''}</div>`;
    recalc();
  }

  function validate() {
    const L = lines(), adv = st.type === 'ADV';
    if (!val('supplier')) return 'กรุณาใส่ Supplier (หัวกระดาษใบฟ้า)';
    if (!val('payee')) return 'กรุณาใส่ชื่อผู้รับเงิน (จ่ายให้)';
    if (!adv && L.some((l) => !l.category)) return 'กรุณาเลือกหมวดให้ครบทุกบรรทัด';
    if (!fin && mixedOffice()) return 'ค่าใช้จ่ายสำนักงานต้องแยกเป็นอีกใบ (ไม่ปนกับหมวดอื่น)';
    if (L.some((l) => l.amount <= 0)) return 'กรุณาใส่จำนวนเงินให้ครบทุกบรรทัด';
    if (fin) {
      if (st.wht.some((w) => !(Number(w.base) > 0))) return 'ใส่ยอดฐานหัก ณ ที่จ่ายให้ครบ';
      if (st.wht.reduce((s, w) => s + Number(w.base), 0) > total() + 0.004) return 'ยอดฐานหัก ณ ที่จ่ายรวมเกินยอดก่อน VAT';
      if (paid && Math.abs(taxTotals().net - Number(old.amount)) > 0.004) return `ใบนี้จ่ายแล้ว ยอดสุทธิต้องเท่าเดิม (${money(old.amount)} บาท)`;
      return '';
    }
    if (!adv && st.needJob) {
      if (!val('jobNo') || !val('poNo') || !val('costSheetNo')) return 'กรุณากรอก Job No., PO No. และ Cost sheet No.';
      if (!pickers.costSheet.count() || !pickers.po.count() || !pickers.invoice.count()) return 'กรุณาแนบ Cost sheet, PO และ Invoice ให้ครบ';
    }
    if (!adv && !st.needJob && needReceipt() && !pickers.receipt.count() && !pickers.invoice.count()) return 'กรุณาแนบใบเสร็จ';
    return '';
  }

  async function submit() {
    if (st.sending) return;   // กันกดส่งซ้ำ (ระหว่างเช็คใบซ้ำ / อัปโหลด)
    st.sending = true;
    try { await doSubmit(); } finally { st.sending = false; }
  }
  const fields = () => ({ supplier: val('supplier'), payee: val('payee'), payBank: val('payBank'), payAccount: val('payAccount'), expenseDate: val('expenseDate'),
    jobNo: val('jobNo'), poNo: val('poNo'), costSheetNo: val('costSheetNo'), deliveryDate: val('deliveryDate'), note: val('note'), needDate: val('needDate'), lines: lines() });
  async function uploadDocs(set, all) {
    const docs = {};
    for (const [k, label] of DOCS) {
      if (!all && $(`[data-doc="${k}"]`, el).classList.contains('hidden')) { docs[k] = []; continue; }
      docs[k] = await pickers[k].uploadAll((n, cnt) => set(`อัปโหลด ${label} (${n}/${cnt})`));
    }
    return docs;
  }
  async function doSubmit() {
    const err = validate();
    if (err) { toast(err, 'bad'); return; }
    if (fin) {
      try {
        const res = await busy('กำลังบันทึก…', async (set) => {
          const docs = await uploadDocs(set, true);
          set('กำลังบันทึก…');
          return api.rpc('pv_fin_edit', { p: { id: old.id, ...fields(), deptCode: val('deptCode'), docs, vatRate: st.vat,
            whtLines: st.wht.map((w) => ({ rate: w.rate, base: r2(w.base) })) } });
        });
        toast(res.changed ? 'บันทึกการแก้ไขแล้ว · แจ้งคนเบิกแล้ว' : 'ไม่มีอะไรเปลี่ยน');
        ctx.go('/pv/view?id=' + encodeURIComponent(old.id));
      } catch (e) { toastError(e); }
      return;
    }
    // กันจ่ายซ้ำ: Job + PO เดียวกัน หรือผู้รับเงิน + ยอดเท่ากันใน 60 วัน
    try {
      const dup = await api.rpc('get_pv_dupes', { p_job: val('jobNo'), p_po: val('poNo'), p_payee: val('payee'), p_amount: total(), p_exclude: old?.id || '' });
      if (dup?.length && !(await confirmBox({ title: 'อาจซ้ำกับใบที่มีอยู่แล้ว',
        message: dup.map((x) => `${x.id} · ${x.reason} · ${x.requesterName}${x.amount != null ? ` · ${money(x.amount)} บาท` : ''}`).join('\n') + '\n\nตรวจแล้วไม่ซ้ำ กดส่งต่อได้', ok: 'ส่งต่อ' }))) return;
    } catch { /* เช็คไม่ได้ ไม่ขวางการส่ง */ }
    try {
      const res = await busy('กำลังเตรียมข้อมูล…', async (set) => {
        const docs = st.type !== 'ADV' ? await uploadDocs(set, false) : {};
        set('กำลังส่ง…');
        return api.rpc('pv_submit', { p: { id: old?.id || '', type: st.type, requesterEmail: st.who, fundId: pettyFund() || meta.fund?.fundId || '', ...fields(), docs } });
      });
      if (!old) { st.sent = true; saveJSON(DRAFT_KEY, null); }
      toast(`${old ? 'ส่งใหม่แล้ว' : 'ส่งแล้ว'} ${res.id}`);
      ctx.refreshBadges();
      ctx.go('/pv/view?id=' + encodeURIComponent(res.id));
    } catch (e) { toastError(e); }
  }

  // ── เบิกให้ ──
  const deptOf = (x) => x.department || '(ไม่ระบุ)';
  function whoCard(x) {
    if (!x) return `<span class="avatar sm brand">${esc((meta.me.name || '?').slice(0, 2))}</span><div class="grow"><b>ตัวเอง</b><div class="text-sm muted">${esc(meta.me.name)}${meta.me.department ? ' · ' + esc(meta.me.department) : ''}</div></div>`;
    const job = jobDepts.includes(String(x.department || '').toUpperCase());
    return `<span class="avatar sm">${esc((x.name || '?').slice(0, 2))}</span><div class="grow" style="min-width:0"><b>${esc(x.name)}</b>${x.fullName && x.fullName !== x.name ? ` <span class="muted">· ${esc(x.fullName)}</span>` : ''}
      <div class="text-sm muted">${esc(deptOf(x))}${job ? ' · <span class="badge b-brand plain">เซลล์</span>' : ''}</div></div>`;
  }
  function paintWho() {
    const box = $('[data-whobox]', el); if (!box) return;
    const cur = staff.find((x) => x.email === st.who);
    const depts = [...new Set(staff.map(deptOf))].sort();
    const q = $('[data-whoq]', el)?.value || '';
    box.innerHTML = `<button type="button" class="pv-who-cur" data-act="who-open" aria-expanded="${st.whoOpen}">${whoCard(cur)}<span class="text-sm brand-text nowrap">${st.whoOpen ? 'ปิด' : 'เปลี่ยน'}</span></button>
      ${st.whoOpen ? `<div class="pv-who-panel">
        <div class="search">${icon('search')}<input class="input" type="search" data-whoq aria-label="ค้นหาพนักงาน" placeholder="ค้นหาชื่อเล่น / ชื่อจริง / แผนก" value="${esc(q)}"></div>
        <div class="chips"><button type="button" class="chip ${st.whoDept ? '' : 'on'}" data-whodept="">ทุกแผนก</button>${depts.map((d) => `<button type="button" class="chip ${st.whoDept === d ? 'on' : ''}" data-whodept="${esc(d)}">${esc(d)}</button>`).join('')}</div>
        <div class="list pv-who-list" data-wholist></div></div>` : ''}`;
    if (st.whoOpen) paintWhoList();
  }
  function paintWhoList() {
    const box = $('[data-wholist]', el); if (!box) return;
    const q = ($('[data-whoq]', el)?.value || '').trim().toLowerCase();
    const recent = loadJSON(RECENT_KEY, []).map((e) => staff.find((x) => x.email === e)).filter(Boolean);
    let rows = staff.filter((x) => (!st.whoDept || deptOf(x) === st.whoDept)
      && (!q || [x.name, x.fullName, x.department, x.email].some((v) => String(v || '').toLowerCase().includes(q))));
    const row = (x) => `<button type="button" class="row click pv-who-row ${x?.email === st.who || (!x && !st.who) ? 'selected' : ''}" data-whopick="${esc(x?.email || '')}">${whoCard(x)}</button>`;
    const showRecent = !q && !st.whoDept && recent.length;
    if (showRecent) rows = rows.filter((x) => !recent.includes(x));
    box.innerHTML = (!q && !st.whoDept ? row(null) : '')
      + (showRecent ? `<div class="group-label">ล่าสุด</div>${recent.map(row).join('')}<div class="group-label">ทั้งหมด</div>` : '')
      + (rows.length ? rows.slice(0, 80).map(row).join('') : `<p class="muted text-sm pad-x">ไม่พบชื่อที่ค้นหา</p>`);
  }
  // ── ร่างอัตโนมัติ (ใบใหม่เท่านั้น · ไม่รวมไฟล์แนบ) ──
  function saveDraftNow() {
    if (old || !linesBox.isConnected) return;   // ฟอร์มถูกแทนที่ไปแล้ว (เปลี่ยนหน้า) → ไม่ต้องบันทึกทับ
    const L = lines().map((l, i) => ({ ...l, category: lineRows()[i]?.dataset.catval || '' }));
    const any = val('supplier') || val('payee') || L.some((l) => l.description || l.amount) || val('jobNo') || val('note');
    saveJSON(DRAFT_KEY, any ? { type: st.type, who: st.who, supplier: val('supplier'), payee: val('payee'), payBank: val('payBank'), payAccount: val('payAccount'),
      expenseDate: val('expenseDate'), jobNo: val('jobNo'), poNo: val('poNo'), costSheetNo: val('costSheetNo'), deliveryDate: val('deliveryDate'),
      note: val('note'), needDate: val('needDate'), lines: L } : null);
  }
  const saveDraft = debounce(() => { if (ctx.alive()) saveDraftNow(); }, 500);
  // ── ผู้รับเงิน / Supplier ที่เคยใช้ ──
  let payees = [];
  api.rpc('get_pv_payees', {}, { ttl: 300, quiet: true }).then((list) => {
    payees = list || [];
    const dl = $('#pv-payees', el); if (dl) dl.innerHTML = payees.map((p) => `<option value="${esc(p.payee)}"></option>`).join('');
  }).catch(() => {});
  api.rpc('get_pv_suppliers', {}, { ttl: 300, quiet: true }).then((list) => {
    const dl = $('#pv-suppliers', el); if (dl) dl.innerHTML = (list || []).map((s) => `<option value="${esc(s)}"></option>`).join('');
  }).catch(() => {});
  function fillPayee() {
    const t = $('[data-f=payee]', el);
    const hit = payees.find((p) => p.payee.toLowerCase() === t.value.trim().toLowerCase());
    const b = $('[data-f=payBank]', el), a = $('[data-f=payAccount]', el), h = $('[data-payeehint]', el);
    // ช่องที่ยังเป็นค่าที่ระบบเติมให้ (ไม่ได้พิมพ์เอง) → แทนด้วยของผู้รับเงินคนใหม่ หรือล้างถ้าไม่รู้จัก
    const mine = (inp) => !inp.value || inp.value === inp.dataset.auto;
    let filled = false;
    for (const [inp, v] of [[b, hit?.bank || ''], [a, hit?.account || '']]) {
      if (!mine(inp)) continue;
      inp.value = v; inp.dataset.auto = v; if (v) filled = true;
    }
    h.textContent = filled ? 'เติมธนาคาร / เลขบัญชีจากใบก่อนหน้าให้แล้ว — ตรวจให้ถูกก่อนส่ง' : ''; h.classList.toggle('hidden', !filled);
    saveDraft();
  }

  // ── การ์ดอธิบายหมวด (ชี้เมาส์ / โฟกัสที่ปุ่มหมวด) ──
  const tip = $('[data-cattip]', el);
  tip.id = 'pv-cattip';
  function showTip(btn) {
    const code = btn.dataset.cat, c = catOf(code); if (!c) return;
    tip.innerHTML = `<div class="flex gap-8" style="align-items:center">${catIcon(code, 32)}<div><b>${esc(c.name_th)}</b>${c.name_en ? `<div class="text-xs muted">${esc(c.name_en)}</div>` : ''}</div></div>
      <div class="text-sm">${esc(CAT_HINT[code] || '')}</div>`;
    tip.classList.remove('hidden');
    const r = btn.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const top = r.bottom + 8 + h > window.innerHeight ? r.top - h - 8 : r.bottom + 8;
    tip.style.left = left + 'px'; tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.classList.add('hidden'); }

  if (fin) paintTax();
  paintWho();
  layout(); recalc(); preview();
  const offs = [
    on(el, 'click', '[data-t]', (e, t) => { st.type = t.dataset.t; $$('[data-t]', el).forEach((b) => b.classList.toggle('on', b === t)); layout(); preview(); saveDraft(); lineRows().forEach(checkOther); }),
    on(el, 'click', '.cat-opt[data-cat]', (e, t) => setCat(t.closest('.pv-line-card'), t.dataset.cat)),
    on(el, 'click', '[data-catfix]', (e, t) => setCat(t.closest('.pv-line-card'), t.dataset.catfix)),
    on(el, 'mouseover', '.cat-opt[data-cat]', (e, t) => { if (!t.contains(e.relatedTarget)) showTip(t); }),
    on(el, 'mouseout', '.cat-opt[data-cat]', (e, t) => { if (!t.contains(e.relatedTarget)) hideTip(); }),
    on(el, 'focusin', '.cat-opt[data-cat]', (e, t) => showTip(t)),
    on(el, 'focusout', '.cat-opt[data-cat]', () => hideTip()),
    // เบิกให้: เปิด/ค้นหา/กรองแผนก/เลือก
    on(el, 'input', '[data-whoq]', () => paintWhoList()),
    on(el, 'click', '[data-whodept]', (e, t) => { st.whoDept = t.dataset.whodept; paintWho(); $('[data-whoq]', el)?.focus(); }),
    on(el, 'click', '[data-whopick]', (e, t) => {
      st.who = t.dataset.whopick; st.whoOpen = false;
      if (st.who) saveJSON(RECENT_KEY, [st.who, ...loadJSON(RECENT_KEY, []).filter((x) => x !== st.who)].slice(0, 6));
      paintWho(); preview(); saveDraft();
    }),
    // ผู้รับเงินที่เคยจ่าย → เติมธนาคาร/เลขบัญชีให้ (เฉพาะช่องที่ยังว่าง)
    on(el, 'change', '[data-f=payee]', () => fillPayee()),
    on(el, 'input', 'input, textarea', () => saveDraft()),
    on(el, 'input', '[data-l=description]', (e, t) => checkOther(t.closest('.pv-line-card'))),
    on(el, 'input', '[data-l=amount]', () => { recalc(); preview(); if (fin) paintTax(); }),
    // VAT / หัก ณ ที่จ่าย (บัญชีแก้ไข)
    on(el, 'click', '[data-vat]', (e, t) => { st.vat = Number(t.dataset.vat); paintTax(); }),
    on(el, 'click', '[data-whtrate]', (e, t) => { st.wht[+t.closest('[data-whti]').dataset.whti].rate = Number(t.dataset.whtrate); paintTax(); }),
    on(el, 'click', '[data-whtrm]', (e, t) => { st.wht.splice(+t.dataset.whtrm, 1); paintTax(); }),
    on(el, 'change', '[data-whtbase]', (e, t) => { st.wht[+t.closest('[data-whti]').dataset.whti].base = Number(t.value) || 0; paintTax(); }),
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'add-line') { addLine(); recalc(); layout(); lineRows().at(-1).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (a === 'cat-change') { t.closest('.pv-line-card').classList.add('picking'); }
      else if (a === 'who-open') { st.whoOpen = !st.whoOpen; paintWho(); if (st.whoOpen) $('[data-whoq]', el)?.focus(); }
      else if (a === 'draft-clear') { saveJSON(DRAFT_KEY, null); ctx.go('/petty/request?r=' + Date.now()); }
      else if (a === 'rm-line') { t.closest('.pv-line-card').remove(); renumber(); recalc(); layout(); preview(); saveDraft(); if (fin) paintTax(); }
      else if (a === 'payee-same') { const p = $('[data-f=payee]', el); p.value = val('supplier'); fillPayee(); }
      else if (a === 'wht-add') { const left = r2(total() - st.wht.reduce((s, w) => s + Number(w.base || 0), 0)); st.wht.push({ rate: 3, base: Math.max(0, left) }); paintTax(); }
      else if (a === 'submit') submit();
    }),
  ];
  // ปิดแท็บ / สลับแอปบนมือถือ → บันทึกร่างทันที (ไม่รอ 0.5 วินาที)
  const onHide = () => { if (!st.sent) saveDraftNow(); };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('scroll', hideTip, { passive: true });
  return () => { offs.forEach((f) => f()); window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('scroll', hideTip); };
}
