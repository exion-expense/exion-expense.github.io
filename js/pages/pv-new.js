// ขอเบิก Petty Cash (ใบสำคัญจ่าย) — มี Job / ทั่วไป / Advance entertain · เลือกหมวดทุกบรรทัด · HR กรอกแทนได้ · แก้ใบที่ถูกตีกลับ (?id=)
import { api, money, esc, todayYMD, loadPettyCategories } from '../core.js?v=10.1.3';
import { icon, catIcon, toast, toastError, busy, receiptPicker, errorBox, debounce, on, $, $$ } from '../ui.js?v=10.1.3';
import { DOCS } from './pv-common.js?v=10.1.3';

// คำอธิบายหมวด: อะไรเข้าหมวดนี้บ้าง (แสดงใต้ปุ่มหมวดที่เลือก)
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

export async function render(ctx) {
  const { el, query } = ctx;
  let meta, old = null, cats = [];
  try {
    [meta, old, cats] = await Promise.all([api.rpc('get_pv_form_meta', {}, { ttl: 60 }), query.id ? api.rpc('get_pv', { p_id: query.id }) : null, loadPettyCategories()]);
  } catch (e) { if (ctx.alive()) errorBox(el, e, () => render(ctx)); return; }
  if (!ctx.alive()) return;
  if (old && !old.canEdit) { ctx.go('/pv/view?id=' + encodeURIComponent(old.id)); return; }
  if (old) ctx.setTitle('แก้ไข ' + old.id);

  const st = { type: old?.kind === 'ADV' ? 'ADV' : 'EXP', who: '', needJob: false, seq: 0 };
  const officeCats = (meta.officeCats || ['OFFICE']).map((c) => String(c).toUpperCase());
  const catOf = (code) => cats.find((c) => c.code === code);
  const pickers = {};

  el.innerHTML = `
  <div class="stack">
    ${old ? `<div class="alert bad">${icon('alert')}<div><b>ถูกตีกลับ:</b> ${esc(old.remark || '-')}<br><span class="text-sm">แก้ไขแล้วกดส่งใหม่ ใบจะเริ่มอนุมัติใหม่ตั้งแต่ขั้นแรก (เลขเดิม ${esc(old.id)})</span></div></div>` : ''}
    <div class="card pad stack-sm">
      ${!old ? `<div class="seg" role="tablist" data-type>
        <button type="button" data-t="EXP" class="${st.type === 'EXP' ? 'on' : ''}">${icon('receipt', 'sm')} ค่าใช้จ่าย</button>
        <button type="button" data-t="ADV" class="${st.type === 'ADV' ? 'on' : ''}">${icon('utensils', 'sm')} Advance entertain</button></div>` : ''}
      ${meta.canBehalf && !old ? `<div class="field"><label for="pv-who">เบิกให้</label>
        <select class="input" id="pv-who" data-who><option value="">ตัวเอง (${esc(meta.me.name)})</option>
        ${(meta.staff || []).filter((s) => s.email !== meta.me.email).map((s) => `<option value="${esc(s.email)}">${esc(s.name)}${s.department ? ' · ' + esc(s.department) : ''}</option>`).join('')}
        </select><div class="hint">HR / บัญชีกรอกแทนได้ — ใบเป็นของคนที่เลือก และขึ้นว่ากรอกโดยคุณ</div></div>` : ''}
      <p class="hint" data-typehint></p>
    </div>

    <div class="card pad stack-sm">
      <div class="form-grid two">
        <div class="field span-2"><label class="req" for="pv-payee">จ่ายให้</label>
          <input class="input" id="pv-payee" data-f="payee" maxlength="150" value="${esc(old?.payee || '')}"></div>
        <div class="field"><label for="pv-bank">ธนาคาร <span class="opt">ไม่บังคับ</span></label>
          <input class="input" id="pv-bank" data-f="payBank" maxlength="100" value="${esc(old?.payBank || '')}"></div>
        <div class="field"><label for="pv-acc">เลขบัญชี <span class="opt">ไม่บังคับ</span></label>
          <input class="input" id="pv-acc" data-f="payAccount" maxlength="50" inputmode="numeric" value="${esc(old?.payAccount || '')}"></div>
        <div class="field"><label class="req" for="pv-date" data-datelabel>วันที่</label>
          <input type="date" class="input" id="pv-date" data-f="expenseDate" value="${esc(old?.expenseDate || todayYMD())}"></div>
      </div>
    </div>

    <div class="card pad stack-sm">
      <div class="flex between wrap"><b>รายการ</b><span class="text-sm muted">ยอดก่อน VAT · บัญชีเป็นคนใส่ VAT / หัก ณ ที่จ่าย</span></div>
      <p class="hint" data-officehint></p>
      <div class="stack-sm" data-lines></div>
      <button type="button" class="add-item" data-act="add-line">${icon('plus')} เพิ่มบรรทัด</button>
    </div>

    <div class="card pad stack-sm" data-jobbox>
      <b>ข้อมูล Job <span class="opt" data-jopt>ไม่บังคับ · กรอกแล้วขึ้นในใบฟ้า</span></b>
      <div class="form-grid two">
        <div class="field"><label data-jreq for="pv-job">Job No.</label><input class="input" id="pv-job" data-f="jobNo" maxlength="50" value="${esc(old?.jobNo || '')}"></div>
        <div class="field"><label data-jreq for="pv-po">PO No.</label><input class="input" id="pv-po" data-f="poNo" maxlength="50" value="${esc(old?.poNo || '')}"></div>
        <div class="field"><label data-jreq for="pv-cs">Cost sheet No.</label><input class="input" id="pv-cs" data-f="costSheetNo" maxlength="50" value="${esc(old?.costSheetNo || '')}"></div>
        <div class="field"><label for="pv-dd">วันที่จัดส่งสินค้า <span class="opt">ไม่บังคับ</span></label><input type="date" class="input" id="pv-dd" data-f="deliveryDate" value="${esc(old?.deliveryDate || '')}"></div>
      </div>
    </div>

    <div class="card pad stack-sm" data-filebox>
      <b>ไฟล์แนบ</b> <span class="text-sm muted">ถ่ายรูปหรือเลือกไฟล์ (รูป / PDF)</span>
      ${DOCS.map(([k, label]) => `<div class="field" data-doc="${k}"><label>${label}</label><div data-picker="${k}"></div></div>`).join('')}
    </div>

    <div class="card pad stack-sm">
      <div class="field"><label for="pv-note">หมายเหตุ <span class="opt">ไม่บังคับ</span></label>
        <input class="input" id="pv-note" data-f="note" maxlength="300" value="${esc(old?.note || '')}"></div>
    </div>

    <div class="submit-bar">
      <div class="grow" style="min-width:0"><div class="text-sm muted" data-count></div><div class="amount text-lg" data-total>0.00</div></div>
      <button type="button" class="btn btn-primary btn-lg" data-act="submit">${icon('send')} ${old ? 'ส่งใหม่' : 'ส่งใบเบิก'}</button>
    </div>
  </div>`;

  DOCS.forEach(([k]) => { pickers[k] = receiptPicker($(`[data-picker="${k}"]`, el), { max: 10, existing: old?.docs?.[k] || [] }); });
  const linesBox = $('[data-lines]', el);
  function addLine(desc = '', amt = '', cat = '') {
    const k = ++st.seq;
    const d = document.createElement('div');
    d.className = 'pv-line-card'; d.dataset.line = k; d.dataset.cat = cat;
    d.innerHTML = `<div class="cat-picker" data-cats>${cats.map((c) => `<button type="button" class="cat-opt ${c.code === cat ? 'on' : ''}" data-cat="${esc(c.code)}" title="${esc(CAT_HINT[c.code] || '')}">${catIcon(c.code)}<span>${esc(c.name_th)}</span></button>`).join('')}</div>
      <div class="hint" data-cathint>${esc(CAT_HINT[cat] || '')}</div>
      <div class="pv-line pv-line-lab"><span class="label">รายละเอียด</span><span class="label">จำนวนเงิน</span></div>
      <div class="pv-line"><input class="input" data-l="description" maxlength="300" aria-label="รายละเอียด" value="${esc(desc)}">
      <div class="input-group has-suf"><input type="number" class="input" data-l="amount" inputmode="decimal" step="0.01" min="0" aria-label="จำนวนเงิน" value="${esc(amt)}"><span class="suf">บาท</span></div>
      <button type="button" class="btn-icon sm" data-act="rm-line" aria-label="ลบบรรทัด">${icon('trash')}</button></div>`;
    linesBox.appendChild(d);
    renumber();
  }
  const lineRows = () => $$('.pv-line-card', linesBox);
  function renumber() { lineRows().forEach((r) => r.querySelector('[data-act=rm-line]').classList.toggle('hidden', lineRows().length < 2)); }
  function lines() {
    return lineRows().map((r) => ({ description: r.querySelector('[data-l=description]').value.trim(), amount: Math.round((Number(r.querySelector('[data-l=amount]').value) || 0) * 100) / 100,
      category: st.type === 'ADV' ? 'ENT' : r.dataset.cat || '' }));
  }
  // ใบนี้เป็นค่าใช้จ่ายสำนักงาน = ทุกบรรทัดเป็นหมวดสำนักงาน (ส่งไปผู้อนุมัติค่าใช้จ่ายสำนักงาน)
  const isOffice = () => st.type !== 'ADV' && lines().length > 0 && lines().every((l) => officeCats.includes(l.category));
  const mixedOffice = () => st.type !== 'ADV' && lines().some((l) => officeCats.includes(l.category)) && !isOffice();
  const total = () => Math.round(lines().reduce((s, l) => s + l.amount, 0) * 100) / 100;
  (old?.lines?.length ? old.lines : [{ description: '', amount: '', category: '' }]).forEach((l) => addLine(l.description, l.amount, l.category || ''));

  const val = (f) => $(`[data-f="${f}"]`, el)?.value.trim() || '';

  // แสดง/ซ่อนส่วนตามประเภท + แผนก
  function layout() {
    const adv = st.type === 'ADV', job = st.needJob;
    $('[data-typehint]', el).innerHTML = adv
      ? `ขอเงินล่วงหน้าไปเลี้ยงรับรอง · รับเงินแล้วต้องเคลียร์ใบเสร็จภายใน <b>${Number(meta.advDays) || 15} วัน</b>`
      : job ? 'แผนกนี้ต้องกรอก <b>Job No., PO No., Cost sheet No.</b> และแนบ <b>Cost sheet, PO, Invoice</b>' : 'แนบใบเสร็จอย่างน้อย 1 ไฟล์';
    $('[data-datelabel]', el).textContent = adv ? 'วันที่จะใช้' : 'วันที่';
    $$('[data-cats]', el).forEach((c) => c.classList.toggle('hidden', adv));
    $('[data-officehint]', el).innerHTML = mixedOffice() ? '<span class="err-text">ค่าใช้จ่ายสำนักงานต้องแยกเป็นอีกใบ (ไม่ปนกับหมวดอื่น)</span>' : '';
    // ข้อมูล Job: แผนกเซลล์บังคับ · แผนกอื่นกรอกได้ (ไม่บังคับ) กรอกแล้วขึ้นในใบฟ้า
    $$('[data-jreq]', el).forEach((l) => l.classList.toggle('req', job && !adv));
    $('[data-jopt]', el).classList.toggle('hidden', job && !adv);
    $('[data-filebox]', el).classList.toggle('hidden', adv);
    $$('[data-doc]', el).forEach((d) => {
      // แผนกเซลล์: Cost sheet / PO / Invoice บังคับ · แผนกอื่น: ใบเสร็จตามกฎหมวด + แนบ Cost sheet / PO / Invoice เพิ่มได้
      const k = d.dataset.doc, show = job ? k !== 'receipt' : true;
      d.classList.toggle('hidden', !show);
      d.querySelector('label').classList.toggle('req', show && !adv && (job || (k === 'receipt' && needReceipt())));
    });
  }
  // แนบใบเสร็จตามกฎหมวด: มีบรรทัดไหนเป็นหมวดที่ต้องแนบ → ต้องแนบ
  function needReceipt() { return lines().some((l) => (catOf(l.category)?.need_receipt || 'YES') === 'YES'); }
  function recalc() {
    $('[data-count]', el).textContent = `${lineRows().length} บรรทัด · ยอดก่อน VAT`;
    $('[data-total]', el).textContent = money(total()) + ' บาท';
  }
  // ถามฐานข้อมูลว่าคนเบิกอยู่แผนกที่ต้องกรอก Job ไหม (ไม่แสดงสายอนุมัติบนฟอร์ม)
  const preview = debounce(async () => {
    try {
      const r = await api.rpc('get_pv_preview', { p_requester: old ? old.requesterEmail : st.who, p_amount: total(), p_office: isOffice() }, { ttl: 30, quiet: true });
      if (!ctx.alive()) return;
      st.needJob = !!r.needJob;
      layout();
    } catch { /* ฟอร์มยังกรอกได้ · ฐานข้อมูลตรวจซ้ำตอนส่ง */ }
  }, 300);

  function validate() {
    const L = lines(), adv = st.type === 'ADV';
    if (!val('payee')) return 'กรุณาใส่ชื่อผู้รับเงิน (จ่ายให้)';
    if (!adv && L.some((l) => !l.category)) return 'กรุณาเลือกหมวดให้ครบทุกบรรทัด';
    if (mixedOffice()) return 'ค่าใช้จ่ายสำนักงานต้องแยกเป็นอีกใบ (ไม่ปนกับหมวดอื่น)';
    if (L.some((l) => !l.description)) return 'กรุณาใส่รายละเอียดให้ครบทุกบรรทัด';
    if (L.some((l) => l.amount <= 0)) return 'กรุณาใส่จำนวนเงินให้ครบทุกบรรทัด';
    if (!adv && st.needJob) {
      if (!val('jobNo') || !val('poNo') || !val('costSheetNo')) return 'กรุณากรอก Job No., PO No. และ Cost sheet No.';
      if (!pickers.costSheet.count() || !pickers.po.count() || !pickers.invoice.count()) return 'กรุณาแนบ Cost sheet, PO และ Invoice ให้ครบ';
    }
    if (!adv && !st.needJob && needReceipt() && !pickers.receipt.count() && !pickers.invoice.count()) return 'กรุณาแนบใบเสร็จ';
    return '';
  }

  async function submit() {
    const err = validate();
    if (err) { toast(err, 'bad'); return; }
    try {
      const res = await busy('กำลังเตรียมข้อมูล…', async (set) => {
        const docs = {};
        if (st.type !== 'ADV') {
          for (const [k, label] of DOCS) {
            if ($(`[data-doc="${k}"]`, el).classList.contains('hidden')) { docs[k] = []; continue; }
            docs[k] = await pickers[k].uploadAll((n, all) => set(`อัปโหลด ${label} (${n}/${all})`));
          }
        }
        set('กำลังส่ง…');
        return api.rpc('pv_submit', { p: {
          id: old?.id || '', type: st.type, requesterEmail: st.who, fundId: meta.fund?.fundId || '',
          payee: val('payee'), payBank: val('payBank'), payAccount: val('payAccount'), expenseDate: val('expenseDate'),
          jobNo: val('jobNo'), poNo: val('poNo'), costSheetNo: val('costSheetNo'), deliveryDate: val('deliveryDate'),
          note: val('note'), lines: lines(), docs,
        } });
      });
      toast(`${old ? 'ส่งใหม่แล้ว' : 'ส่งแล้ว'} ${res.id} · รอ ${res.waiting}`);
      ctx.refreshBadges();
      ctx.go('/pv/view?id=' + encodeURIComponent(res.id));
    } catch (e) { toastError(e); }
  }

  layout(); recalc(); preview();
  const offs = [
    on(el, 'click', '[data-t]', (e, t) => { st.type = t.dataset.t; $$('[data-t]', el).forEach((b) => b.classList.toggle('on', b === t)); layout(); preview(); }),
    on(el, 'change', '[data-who]', (e, t) => { st.who = t.value; preview(); }),
    on(el, 'click', '[data-cat]', (e, t) => {
      const card = t.closest('.pv-line-card'); card.dataset.cat = t.dataset.cat;
      $$('.cat-opt', card).forEach((o) => o.classList.toggle('on', o === t));
      $('[data-cathint]', card).textContent = CAT_HINT[t.dataset.cat] || '';
      layout(); preview();
    }),
    on(el, 'input', '[data-l=amount]', () => { recalc(); preview(); }),
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'add-line') { addLine(); recalc(); layout(); lineRows().at(-1).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (a === 'rm-line') { t.closest('.pv-line-card').remove(); renumber(); recalc(); layout(); preview(); }
      else if (a === 'submit') submit();
    }),
  ];
  return () => offs.forEach((f) => f());
}
