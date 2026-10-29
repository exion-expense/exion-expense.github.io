// ขอเบิก Petty Cash (ใบสำคัญจ่าย) — มี Job / ทั่วไป / Advance entertain · เลือกหมวดทุกบรรทัด · HR กรอกแทนได้ · แก้ใบที่ถูกตีกลับ (?id=)
import { api, money, esc, todayYMD, loadPettyCategories } from '../core.js?v=10.1.7';
import { icon, catIcon, toast, toastError, confirmBox, busy, receiptPicker, errorBox, debounce, on, $, $$ } from '../ui.js?v=10.1.7';
import { DOCS } from './pv-common.js?v=10.1.7';

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

const DRAFT_KEY = 'exion_pv_draft', RECENT_KEY = 'exion_pv_recent_who';
const pettyFund = () => { try { return localStorage.getItem('exion_petty_fund') || ''; } catch { return ''; } };   // กล่องที่เลือกไว้ในหน้าแรกเงินสดย่อย
const loadJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const saveJSON = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

export async function render(ctx) {
  const { el, query } = ctx;
  let meta, old = null, cats = [];
  try {
    [meta, old, cats] = await Promise.all([api.rpc('get_pv_form_meta', {}, { ttl: 60 }), query.id ? api.rpc('get_pv', { p_id: query.id }) : null, loadPettyCategories()]);
  } catch (e) { if (ctx.alive()) errorBox(el, e, () => render(ctx)); return; }
  if (!ctx.alive()) return;
  if (old && !old.canEdit) { ctx.go('/pv/view?id=' + encodeURIComponent(old.id)); return; }
  if (old) ctx.setTitle('แก้ไข ' + old.id);

  // ใบใหม่: กู้ร่างที่กรอกค้างไว้ (ไม่รวมไฟล์แนบ)
  const draft = old ? null : loadJSON(DRAFT_KEY, null);
  const src = old || draft || {};
  const st = { type: (old?.kind === 'ADV' || draft?.type === 'ADV') ? 'ADV' : 'EXP', who: draft?.who || '', needJob: false, seq: 0, whoDept: '', whoOpen: false };
  const staff = (meta.staff || []).filter((x) => x.email !== meta.me.email);
  const jobDepts = (meta.jobDepts || []).map((d) => String(d).toUpperCase());
  if (st.who && !staff.some((x) => x.email === st.who)) st.who = '';
  const officeCats = (meta.officeCats || ['OFFICE']).map((c) => String(c).toUpperCase());
  const catOf = (code) => cats.find((c) => c.code === code);
  const pickers = {};

  el.innerHTML = `
  <div class="stack">
    ${draft ? `<div class="alert" data-draftbar>${icon('info')}<div class="grow">กู้ข้อมูลที่กรอกค้างไว้แล้ว · ไฟล์แนบต้องแนบใหม่</div><button type="button" class="btn btn-ghost btn-sm" data-act="draft-clear">เริ่มใหม่</button></div>` : ''}
    ${old ? `<div class="alert bad">${icon('alert')}<div><b>ถูกตีกลับ:</b> ${esc(old.remark || '-')}<br><span class="text-sm">แก้ไขแล้วกดส่งใหม่ ใบจะเริ่มอนุมัติใหม่ตั้งแต่ขั้นแรก (เลขเดิม ${esc(old.id)})</span></div></div>` : ''}
    <div class="card pad stack-sm">
      ${!old ? `<div class="seg" role="tablist" data-type>
        <button type="button" data-t="EXP" class="${st.type === 'EXP' ? 'on' : ''}">${icon('receipt', 'sm')} ค่าใช้จ่าย</button>
        <button type="button" data-t="ADV" class="${st.type === 'ADV' ? 'on' : ''}">${icon('utensils', 'sm')} Advance entertain</button></div>` : ''}
      ${meta.canBehalf && !old ? `<div class="field"><label>เบิกให้</label><div class="pv-who" data-whobox></div>
        <div class="hint">HR / บัญชีกรอกแทนได้ — ใบเป็นของคนที่เลือก และขึ้นว่ากรอกโดยคุณ</div></div>` : ''}
      <p class="hint" data-typehint></p>
    </div>

    <div class="card pad stack-sm">
      <div class="form-grid two">
        <div class="field span-2"><label class="req" for="pv-payee">จ่ายให้</label>
          <input class="input" id="pv-payee" data-f="payee" maxlength="150" list="pv-payees" autocomplete="off" value="${esc(src.payee || '')}">
          <datalist id="pv-payees"></datalist><div class="hint hidden" data-payeehint></div></div>
        <div class="field"><label for="pv-bank">ธนาคาร <span class="opt">ไม่บังคับ</span></label>
          <input class="input" id="pv-bank" data-f="payBank" maxlength="100" value="${esc(src.payBank || '')}"></div>
        <div class="field"><label for="pv-acc">เลขบัญชี <span class="opt">ไม่บังคับ</span></label>
          <input class="input" id="pv-acc" data-f="payAccount" maxlength="50" inputmode="numeric" value="${esc(src.payAccount || '')}"></div>
        <div class="field"><label class="req" for="pv-date" data-datelabel>วันที่</label>
          <input type="date" class="input" id="pv-date" data-f="expenseDate" value="${esc(src.expenseDate || todayYMD())}"></div>
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
      <div class="field"><label for="pv-note">หมายเหตุ <span class="opt">ไม่บังคับ</span></label>
        <input class="input" id="pv-note" data-f="note" maxlength="300" value="${esc(src.note || '')}"></div>
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
    d.className = 'pv-line-card' + (cat ? '' : ' picking'); d.dataset.line = k; d.dataset.catval = cat;   // ไม่ใช้ data-cat บนการ์ด (ชนกับปุ่มหมวด)
    const c0 = catOf(cat);
    d.innerHTML = `<div data-catwrap>
      <div class="pv-cat-chosen" data-catchosen>${c0 ? `${catIcon(cat)}<div class="grow" style="min-width:0"><b>${esc(c0.name_th)}</b><div class="hint" data-cathint>${esc(CAT_HINT[cat] || '')}</div></div>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-act="cat-change">เปลี่ยนหมวด</button></div>
      <div class="cat-picker" data-cats>${cats.map((c) => `<button type="button" class="cat-opt ${c.code === cat ? 'on' : ''}" data-cat="${esc(c.code)}" title="${esc(CAT_HINT[c.code] || '')}">${catIcon(c.code)}<span>${esc(c.name_th)}</span></button>`).join('')}</div>
</div>
      <div class="pv-line pv-line-lab"><span class="label">รายละเอียด</span><span class="label">จำนวนเงิน</span></div>
      <div class="pv-line"><input class="input" data-l="description" maxlength="300" aria-label="รายละเอียด" value="${esc(desc)}">
      <div class="input-group has-suf"><input type="number" class="input" data-l="amount" inputmode="decimal" step="0.01" min="0" aria-label="จำนวนเงิน" value="${Number(amt) > 0 ? esc(amt) : ''}"><span class="suf">บาท</span></div>
      <button type="button" class="btn-icon sm" data-act="rm-line" aria-label="ลบบรรทัด">${icon('trash')}</button></div>`;
    linesBox.appendChild(d);
    renumber();
  }
  const lineRows = () => $$('.pv-line-card', linesBox);
  function renumber() { lineRows().forEach((r) => r.querySelector('[data-act=rm-line]').classList.toggle('hidden', lineRows().length < 2)); }
  function lines() {
    return lineRows().map((r) => ({ description: r.querySelector('[data-l=description]').value.trim(), amount: Math.round((Number(r.querySelector('[data-l=amount]').value) || 0) * 100) / 100,
      category: st.type === 'ADV' ? 'ENT' : r.dataset.catval || '' }));
  }
  // ใบนี้เป็นค่าใช้จ่ายสำนักงาน = ทุกบรรทัดเป็นหมวดสำนักงาน (ส่งไปผู้อนุมัติค่าใช้จ่ายสำนักงาน)
  const isOffice = () => st.type !== 'ADV' && lines().length > 0 && lines().every((l) => officeCats.includes(l.category));
  const mixedOffice = () => st.type !== 'ADV' && lines().some((l) => officeCats.includes(l.category)) && !isOffice();
  const total = () => Math.round(lines().reduce((s, l) => s + l.amount, 0) * 100) / 100;
  (src.lines?.length ? src.lines : [{ description: '', amount: '', category: '' }]).forEach((l) => addLine(l.description, l.amount, l.category || ''));

  const val = (f) => $(`[data-f="${f}"]`, el)?.value.trim() || '';

  // แสดง/ซ่อนส่วนตามประเภท + แผนก
  function layout() {
    const adv = st.type === 'ADV', job = st.needJob;
    $('[data-typehint]', el).innerHTML = adv
      ? `ขอเงินล่วงหน้าไปเลี้ยงรับรอง · รับเงินแล้วต้องเคลียร์ใบเสร็จภายใน <b>${Number(meta.advDays) || 15} วัน</b>`
      : job ? 'แผนกนี้ต้องกรอก <b>Job No., PO No., Cost sheet No.</b> และแนบ <b>Cost sheet, PO, Invoice</b>' : 'แนบใบเสร็จอย่างน้อย 1 ไฟล์';
    $('[data-datelabel]', el).textContent = adv ? 'วันที่จะใช้' : 'วันที่';
    $$('[data-catwrap]', el).forEach((c) => c.classList.toggle('hidden', adv));
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
    if (st.sending) return;   // กันกดส่งซ้ำ (ระหว่างเช็คใบซ้ำ / อัปโหลด)
    st.sending = true;
    try { await doSubmit(); } finally { st.sending = false; }
  }
  async function doSubmit() {
    const err = validate();
    if (err) { toast(err, 'bad'); return; }
    // กันจ่ายซ้ำ: Job + PO เดียวกัน หรือผู้รับเงิน + ยอดเท่ากันใน 60 วัน
    try {
      const dup = await api.rpc('get_pv_dupes', { p_job: val('jobNo'), p_po: val('poNo'), p_payee: val('payee'), p_amount: total(), p_exclude: old?.id || '' });
      if (dup?.length && !(await confirmBox({ title: 'อาจซ้ำกับใบที่มีอยู่แล้ว',
        message: dup.map((x) => `${x.id} · ${x.reason} · ${x.requesterName}${x.amount != null ? ` · ${money(x.amount)} บาท` : ''}`).join('\n') + '\n\nตรวจแล้วไม่ซ้ำ กดส่งต่อได้', ok: 'ส่งต่อ' }))) return;
    } catch { /* เช็คไม่ได้ ไม่ขวางการส่ง */ }
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
          id: old?.id || '', type: st.type, requesterEmail: st.who, fundId: pettyFund() || meta.fund?.fundId || '',
          payee: val('payee'), payBank: val('payBank'), payAccount: val('payAccount'), expenseDate: val('expenseDate'),
          jobNo: val('jobNo'), poNo: val('poNo'), costSheetNo: val('costSheetNo'), deliveryDate: val('deliveryDate'),
          note: val('note'), lines: lines(), docs,
        } });
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
      <div class="text-sm muted">${esc(deptOf(x))}${job ? ' · <span class="badge b-brand plain">ต้องกรอก Job</span>' : ''}</div></div>`;
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
    const any = val('payee') || L.some((l) => l.description || l.amount) || val('jobNo') || val('note');
    saveJSON(DRAFT_KEY, any ? { type: st.type, who: st.who, payee: val('payee'), payBank: val('payBank'), payAccount: val('payAccount'),
      expenseDate: val('expenseDate'), jobNo: val('jobNo'), poNo: val('poNo'), costSheetNo: val('costSheetNo'), deliveryDate: val('deliveryDate'),
      note: val('note'), lines: L } : null);
  }
  const saveDraft = debounce(() => { if (ctx.alive()) saveDraftNow(); }, 500);
  // ── ผู้รับเงินที่เคยจ่าย ──
  let payees = [];
  api.rpc('get_pv_payees', {}, { ttl: 300, quiet: true }).then((list) => {
    payees = list || [];
    const dl = $('#pv-payees', el); if (dl) dl.innerHTML = payees.map((p) => `<option value="${esc(p.payee)}"></option>`).join('');
  }).catch(() => {});

  paintWho();
  layout(); recalc(); preview();
  const offs = [
    on(el, 'click', '[data-t]', (e, t) => { st.type = t.dataset.t; $$('[data-t]', el).forEach((b) => b.classList.toggle('on', b === t)); layout(); preview(); saveDraft(); }),
    on(el, 'click', '.cat-opt[data-cat]', (e, t) => {
      const card = t.closest('.pv-line-card'), code = t.dataset.cat, c = catOf(code);
      card.dataset.catval = code; card.classList.remove('picking');
      $$('.cat-opt', card).forEach((o) => o.classList.toggle('on', o === t));
      $('[data-catchosen]', card).innerHTML = `${catIcon(code)}<div class="grow" style="min-width:0"><b>${esc(c?.name_th || code)}</b><div class="hint" data-cathint>${esc(CAT_HINT[code] || '')}</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="cat-change">เปลี่ยนหมวด</button>`;
      layout(); preview(); saveDraft();
    }),
    // เบิกให้: เปิด/ค้นหา/กรองแผนก/เลือก
    on(el, 'input', '[data-whoq]', () => paintWhoList()),
    on(el, 'click', '[data-whodept]', (e, t) => { st.whoDept = t.dataset.whodept; paintWho(); $('[data-whoq]', el)?.focus(); }),
    on(el, 'click', '[data-whopick]', (e, t) => {
      st.who = t.dataset.whopick; st.whoOpen = false;
      if (st.who) saveJSON(RECENT_KEY, [st.who, ...loadJSON(RECENT_KEY, []).filter((x) => x !== st.who)].slice(0, 6));
      paintWho(); preview(); saveDraft();
    }),
    // ผู้รับเงินที่เคยจ่าย → เติมธนาคาร/เลขบัญชีให้ (เฉพาะช่องที่ยังว่าง)
    on(el, 'change', '[data-f=payee]', (e, t) => {
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
    }),
    on(el, 'input', 'input, textarea', () => saveDraft()),
    on(el, 'input', '[data-l=amount]', () => { recalc(); preview(); }),
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'add-line') { addLine(); recalc(); layout(); lineRows().at(-1).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (a === 'cat-change') { t.closest('.pv-line-card').classList.add('picking'); }
      else if (a === 'who-open') { st.whoOpen = !st.whoOpen; paintWho(); if (st.whoOpen) $('[data-whoq]', el)?.focus(); }
      else if (a === 'draft-clear') { saveJSON(DRAFT_KEY, null); ctx.go('/petty/request?r=' + Date.now()); }
      else if (a === 'rm-line') { t.closest('.pv-line-card').remove(); renumber(); recalc(); layout(); preview(); saveDraft(); }
      else if (a === 'submit') submit();
    }),
  ];
  // ปิดแท็บ / สลับแอปบนมือถือ → บันทึกร่างทันที (ไม่รอ 0.5 วินาที)
  const onHide = () => { if (!st.sent) saveDraftNow(); };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  return () => { offs.forEach((f) => f()); window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); };
}
