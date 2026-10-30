// ใบสำคัญจ่าย 1 ใบ — ขั้นอนุมัติ / กดอนุมัติ-ตีกลับ / บัญชี 1 เลือก VAT + หัก ณ ที่จ่ายหลายอัตรา / ส่วนของบัญชี (รอบจ่าย · วันที่ + No. ของบัญชี · แก้ไข · สลิป)
// จ่ายเงิน (+ สลิปโอน) / เคลียร์ advance / พิมพ์ใบฟ้า
import { api, money, fmtDate, fmtDateTime, esc, todayYMD, catName, loadPettyCategories } from '../core.js?v=10.3.1';
import { icon, catIcon, toast, toastError, confirmBox, promptBox, busy, withBtn, sheet, thumbs, hydrateThumbs, receiptPicker, errorBox, skeleton, on, $, $$ } from '../ui.js?v=10.3.1';
import { DOCS, KIND, isTest, stageBadge, kindBadge, roundBadge, roundLabel, whtLines, remarkText, deptInfo, lineDept, roundNet, roundAdj, roundText, roundSeg, voucherHtml, hydrateSigs, printVoucher, PRINT_SIZES, PRINT_COLORS, printPrefs, savePrintPrefs } from './pv-common.js?v=10.3.1';

const ACT = { submit: 'ส่งใบเบิก', resubmit: 'แก้แล้วส่งใหม่', approve: 'อนุมัติ', reject: 'ตีกลับ', pay: 'จ่ายเงิน', cancel: 'ยกเลิก',
  adv_clear: 'ส่งเคลียร์', adv_back: 'ตีกลับการเคลียร์', adv_ok: 'เคลียร์เรียบร้อย', edit: 'แก้ไขใบ', round: 'เลือกรอบจ่าย', slip: 'แนบสลิป' };
const WHT_RATES = [1, 3, 5];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// พิมพ์ใบฟ้าได้ตั้งแต่ถึงขั้นบัญชี 1 (ลายเซ็นเติมตามคนที่อนุมัติแล้ว)
function canPrint(v) {
  if (['Approved', 'Paid'].includes(v.status)) return true;
  const f1 = (v.steps || []).findIndex((s) => s.k === 'fin1');
  return v.status === 'Pending' && f1 >= 0 && v.step >= f1;
}

export async function render(ctx) {
  const { el, query } = ctx;
  const id = query.id;
  if (!id) { ctx.go('/pv'); return; }
  // vat: null = ยังไม่เลือก · wht: null = ยังไม่เลือก / [] = ไม่หัก / [{rate, base}]
  const st = { v: null, vat: null, wht: null, rnd: '', clr: null, slip: null, slip2: null, cash: null };   // rnd: ปัดเศษ '' / DOWN / UP

  async function load() {
    try {
      [st.v] = await Promise.all([api.rpc('get_pv', { p_id: id }), loadPettyCategories().catch(() => [])]);
      if (!ctx.alive()) return;
      ctx.setTitle(st.v.id);
      // บัญชี 1 เคยเลือก VAT / หัก ณ ที่จ่ายแล้ว (ใบถูกตีกลับมา) → ใช้ค่าเดิม ไม่ต้องเลือกใหม่
      if (st.v.isFin1Step && st.vat == null && (st.v.history || []).some((h) => h.act === 'approve' && h.label === 'บัญชี 1')) {
        st.vat = Number(st.v.vatRate) || 0; st.wht = whtLines(st.v).map((w) => ({ rate: Number(w.rate), base: Number(w.base) })); st.rnd = st.v.roundMode || '';
      }
      st.cash = (st.v.canPay || st.v.canSetRound) ? await api.rpc('get_pv_cash_check', {}, { quiet: true }).catch(() => null) : null;
      if (ctx.alive()) paint();
    } catch (e) { if (ctx.alive()) errorBox(el, e, load); }
  }
  const after = async (msg) => { if (msg) toast(msg); ctx.refreshBadges(); await load(); };

  function paint() {
    const v = st.v;
    const steps = v.steps || [];
    const done = (s) => s.state === 'done';
    const nowIdx = v.status === 'Pending' ? v.step : -1;
    const payDone = v.status === 'Paid', payNow = v.status === 'Approved';
    const W = whtLines(v), dpt = deptInfo(v);
    el.innerHTML = `
    <div class="stack">
      <div class="card pad stack-sm">
        <div class="flex between wrap gap-8">
          <div class="stack-sm" style="gap:4px"><div class="flex wrap gap-8"><b class="mono text-lg">${esc(v.id)}</b>${isTest(v.id) ? '<span class="badge b-pending">ข้อมูลทดลอง</span>' : ''}${kindBadge(v.kind)}${v.isOffice ? '<span class="badge b-info plain">Office expenses</span>' : ''}</div>
            <div><b>${esc(v.supplier || v.payee)}</b></div>
            <div class="text-sm muted">${esc(v.requesterName)}${v.department ? ' · ' + esc(v.department) : ''}${v.onBehalfBy ? ` · <span class="badge b-info plain">กรอกโดย ${esc(v.onBehalfBy)}</span>` : ''} · ${fmtDateTime(v.createdAt)}</div></div>
          <div class="text-right"><div class="callout-amount"><span class="v amount">${money(v.amount)}</span><span class="muted">บาท</span></div>
            <div class="flex wrap gap-8" style="justify-content:flex-end">${stageBadge(v)}${v.stage === 'pay' ? '' : roundBadge(v)}</div></div>
        </div>
        <div class="pv-progress">${steps.map((s, i) => `<div class="pv-ps ${done(s) ? 'done' : i === nowIdx ? 'now' : ''}">
            <span class="dot">${done(s) ? icon('check', 'sm') : ''}</span><span class="t">${esc(s.label)}</span>
            <span class="n">${done(s) ? esc(s.byName) : ''}</span>${done(s) && s.at ? `<span class="d">${fmtDate(s.at)}</span>` : ''}</div>`).join('')}
          <div class="pv-ps ${payDone ? 'done' : payNow ? 'now' : ''}"><span class="dot">${payDone ? icon('check', 'sm') : ''}</span><span class="t">${v.payRound === 'D20' ? 'โอนรอบ 20' : 'จ่ายเงิน'}</span>
            <span class="n">${payDone ? esc(v.paidBy || '') : ''}</span>${payDone ? `<span class="d">${fmtDate(v.paidAt)}</span>` : v.payRound === 'D20' && v.payDue ? `<span class="d">${fmtDate(v.payDue)}</span>` : ''}</div>
        </div>
        ${v.status === 'Returned' || (v.status === 'Pending' && v.remark) ? `<div class="alert ${v.status === 'Returned' ? 'bad' : 'warn'}">${icon('alert')}<div><b>${v.status === 'Returned' ? 'ถูกตีกลับให้แก้' : 'ถูกตีกลับมาที่ขั้นนี้'}:</b> ${esc(v.remark)}</div></div>` : ''}
        ${v.advOverdue ? `<div class="alert bad">${icon('clock')}<div>เลยกำหนดเคลียร์ advance (${fmtDate(v.advDue)}) — ส่งใบเสร็จด้านล่าง</div></div>` : v.kind === 'ADV' && v.advDue && v.advClear !== 'Cleared' ? `<div class="alert warn">${icon('clock')}<div>ต้องเคลียร์ advance ภายใน <b>${fmtDate(v.advDue)}</b></div></div>` : ''}
      </div>

      ${actionCard(v)}
      ${finCard(v)}

      <div class="card pad stack-sm">
        <div class="flex between wrap"><b>รายละเอียด</b>${canPrint(v) ? `<button type="button" class="btn btn-secondary btn-sm" data-act="voucher">${icon('file', 'sm')} ใบฟ้า / พิมพ์</button>` : '<span class="text-xs muted">พิมพ์ใบฟ้าได้ตั้งแต่ขั้นบัญชี 1</span>'}</div>
        <dl class="kv">${[
          ['Supplier', v.supplier], ['จ่ายให้', v.payee], ['ธนาคาร', v.payBank], ['เลขบัญชี', v.payAccount], ['Job No.', v.jobNo], ['PO No.', v.poNo], ['Cost sheet No.', v.costSheetNo],
          [v.kind === 'ADV' ? 'วันที่จะใช้' : 'วันที่', v.expenseDate ? fmtDate(v.expenseDate) : ''], ['วันที่จัดส่งสินค้า', v.deliveryDate ? fmtDate(v.deliveryDate) : ''],
          ['หมายเหตุ', remarkText(v)], ['แผนก (ใบฟ้า)', dpt.mixed ? `${dpt.label} (แยกตามบรรทัด)` : v.deptCode ? `${v.deptName}${v.deptName !== v.deptCode ? ' · ' + v.deptCode : ''}` : ''],
          ['รอบจ่าย', roundLabel(v)], ['No. (เลขของบัญชี)', v.docId], ['วันที่ (หัวใบ)', v.docDate ? fmtDate(v.docDate) : ''], ['ประเภท', KIND[v.kind]],
        ].filter(([, x]) => x).map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl>
        <div class="table-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>#</th><th>หมวด</th><th>รายการ</th><th class="r">จำนวนเงิน</th></tr></thead><tbody>
          ${(v.lines || []).map((l, i) => `<tr><td>${i + 1}</td><td><span class="flex gap-8 nowrap" style="align-items:center">${catIcon(l.category, 28)}${esc(catName(l.category))}</span></td><td>${esc(l.description) || '<span class="muted">-</span>'}${dpt.mixed ? ` <span class="badge plain">${esc(lineDept(v, l))}</span>` : ''}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}
          <tr><td></td><td></td><td class="muted">ยอดก่อน VAT</td><td class="r">${money(v.base)}</td></tr>
          ${Number(v.vatAmount) ? `<tr><td></td><td></td><td class="muted">VAT ${Number(v.vatRate)}%</td><td class="r">${money(v.vatAmount)}</td></tr>` : ''}
          ${W.map((w) => `<tr><td></td><td></td><td class="muted">หัก ณ ที่จ่าย ${Number(w.rate)}% · ฐาน ${money(w.base)}</td><td class="r">(${money(w.amount)})</td></tr>`).join('')}
          ${roundAdj(v) ? `<tr><td></td><td></td><td class="muted">ปัดเศษสตางค์</td><td class="r">${roundText(roundAdj(v))}</td></tr>` : ''}
        </tbody><tfoot><tr><td></td><td></td><td>ยอดจ่ายสุทธิ</td><td class="r">${money(v.amount)}</td></tr></tfoot></table></div>
      </div>

      ${filesCard(v)}

      <div class="card pad stack-sm"><b>ประวัติ</b>
        <div class="pv-history">${(v.history || []).slice().reverse().map((h) => `<div class="it ${h.act === 'reject' || h.act === 'adv_back' ? 'bad' : h.act === 'pay' || h.act === 'adv_ok' ? 'ok' : ''}">
          <span class="dot"></span><div class="grow"><b>${esc(h.name || h.by)}</b> · ${esc(ACT[h.act] || h.act)}${h.label && !['submit', 'resubmit', 'edit'].includes(h.act) ? ' · ' + esc(h.label) : ''}
          ${h.remark ? `<div class="text-sm muted">${h.act === 'edit' ? esc(h.remark) : `“${esc(h.remark)}”`}</div>` : ''}</div><span class="text-xs muted nowrap">${fmtDateTime(h.at)}</span></div>`).join('')}</div>
      </div>
    </div>`;
    hydrateThumbs(el);
    const pick = (sel) => { const n = $(sel, el); return n ? receiptPicker(n, { max: 10 }) : null; };
    st.clr = pick('[data-clrpick]'); st.slip = pick('[data-slippick]'); st.slip2 = pick('[data-slip2pick]');
  }

  // ─────────────── VAT / หัก ณ ที่จ่าย (บัญชี 1) ───────────────
  function taxTotals(v) {
    const b = Number(v.base) || 0, va = st.vat ? r2(b * st.vat / 100) : 0;
    const wa = (st.wht || []).reduce((s, w) => s + r2((Number(w.base) || 0) * w.rate / 100), 0);
    const raw = r2(b + va - r2(wa)), net = roundNet(raw, st.rnd);
    return { b, va, wa: r2(wa), raw, net, adj: r2(net - raw) };
  }
  function vatCalc(v) {
    const t = taxTotals(v);
    return `${money(t.b)} ${st.vat ? `+ VAT ${money(t.va)}` : ''} ${t.wa ? `− หัก ณ ที่จ่าย ${money(t.wa)}` : ''} = ${t.adj ? `${money(t.raw)} · ปัดเศษ ${roundText(t.adj)} = ` : ''}<b class="amount">${money(t.net)}</b> บาท`;
  }
  function taxBox(v) {
    const vat = st.vat, W = st.wht;
    return `<div class="flex wrap gap-16">
        <div><div class="text-sm muted mb-8">VAT</div><div class="seg"><button type="button" data-vat="0" class="${vat === 0 ? 'on' : ''}">ไม่มี</button><button type="button" data-vat="7" class="${vat === 7 ? 'on' : ''}">7%</button></div></div>
        <div><div class="text-sm muted mb-8">หัก ณ ที่จ่าย</div><div class="seg"><button type="button" data-whtmode="none" class="${W && !W.length ? 'on' : ''}">ไม่หัก</button><button type="button" data-whtmode="on" class="${W?.length ? 'on' : ''}">หัก ณ ที่จ่าย</button></div></div>
      </div>
      ${W?.length ? `<div class="pv-wht">${W.map((w, i) => `<div class="pv-wht-row" data-whti="${i}">
          <div class="seg sm">${WHT_RATES.map((r) => `<button type="button" data-whtrate="${r}" class="${w.rate === r ? 'on' : ''}">${r}%</button>`).join('')}</div>
          <div class="input-group has-pre"><span class="pre">ฐาน</span><input type="number" class="input" data-whtbase inputmode="decimal" step="0.01" min="0" aria-label="ยอดฐานหัก ณ ที่จ่าย" value="${w.base || ''}"></div>
          <span class="amount nowrap" data-whtamt>${money(r2((Number(w.base) || 0) * w.rate / 100))}</span>
          <button type="button" class="btn-icon sm" data-whtrm="${i}" aria-label="ลบบรรทัดหัก ณ ที่จ่าย">${icon('trash')}</button></div>`).join('')}
        <button type="button" class="btn btn-ghost btn-sm" data-act="wht-add">${icon('plus', 'sm')} เพิ่มอีกอัตรา</button></div>` : ''}
      <div data-rndbox>${roundSeg(taxTotals(v).raw, st.rnd)}</div>
      <div class="text-sm" data-vatcalc>${vatCalc(v)}</div>`;
  }
  const repaintTax = () => { const b = $('[data-taxbox]', el); if (b) b.innerHTML = taxBox(st.v); };
  function whtLeft() { return r2((Number(st.v.base) || 0) - (st.wht || []).reduce((s, w) => s + (Number(w.base) || 0), 0)); }
  function taxError() {
    if (st.vat == null) return 'เลือก VAT ก่อน';
    if (st.wht == null) return 'เลือกหัก ณ ที่จ่าย (หรือ "ไม่หัก") ก่อน';
    if (st.wht.some((w) => !(Number(w.base) > 0))) return 'ใส่ยอดฐานหัก ณ ที่จ่ายให้ครบ';
    if (whtLeft() < -0.004) return 'ยอดฐานหัก ณ ที่จ่ายรวมเกินยอดก่อน VAT';
    return '';
  }

  function actionCard(v) {
    const parts = [];
    if (v.canAct && v.isFin1Step) parts.push(`<div class="stack-sm"><b>บัญชี 1: เลือก VAT และหัก ณ ที่จ่าย</b><div class="stack-sm" data-taxbox>${taxBox(v)}</div></div>`);
    if (v.canAct) {
      parts.push(`<div class="btn-row"><button type="button" class="btn btn-danger" data-act="reject">${icon('x')} ตีกลับ</button>
        <button type="button" class="btn btn-success" data-act="approve">${icon('check')} อนุมัติ${v.stepLabel ? ' (' + esc(v.stepLabel) + ')' : ''}</button></div>`);
    }
    if (v.canPay) {
      const d20 = v.payRound === 'D20', c = st.cash;
      const short = !d20 && c && Number(c.cash) < Number(v.amount);
      parts.push(`<div class="stack-sm"><b>${d20 ? 'โอนเงิน (รอบวันที่ 20)' : 'จ่ายเงิน'}</b>
        ${short ? `<div class="alert bad">${icon('alert')}<div>เงินในกล่องเหลือ <b>${money(c.cash)}</b> บาท ไม่พอจ่ายใบนี้ — เติมเงินกล่อง หรือเปลี่ยนเป็นรอบวันที่ 20</div></div>` : ''}
        <div class="flex wrap gap-8 items-end">
          <div class="field" style="margin:0"><label for="pv-paydate">วันที่${d20 ? 'โอน' : 'จ่าย'}</label><input type="date" class="input" id="pv-paydate" data-paydate value="${todayYMD()}" max="${todayYMD()}"></div>
          <button type="button" class="btn btn-success" data-act="pay">${icon('banknote')} บันทึก${d20 ? 'โอน' : 'จ่าย'}เงิน ${money(v.amount)} บาท</button></div>
        <div class="field" style="margin:0"><label>สลิปโอนเงิน <span class="opt">ไม่บังคับ · คนเบิกเห็นในใบ</span></label><div data-slippick></div></div>
        <div class="hint">${d20 ? 'โอนจากบัญชีบริษัท · ไม่หักเงินในกล่อง และไม่ขึ้นตาราง MSBC' : 'เงินออกจากกล่องเงินสด และขึ้นตาราง MSBC ทันที'}</div></div>`);
    }
    if (v.canClearAdv) {
      parts.push(`<div class="stack-sm"><b>เคลียร์ advance</b>
        <div class="form-grid two"><div class="field"><label class="req" for="pv-actual">ยอดที่ใช้จริง</label>
          <div class="input-group has-suf"><input type="number" class="input" id="pv-actual" data-actual inputmode="decimal" step="0.01" min="0"><span class="suf">บาท</span></div>
          <div class="hint">เบิกไป ${money(v.amount)} บาท · ใช้น้อยกว่า = คืนเงินเข้ากล่อง · ใช้เกิน = ระบบสร้างใบเบิกส่วนเกินให้</div></div>
          <div class="field"><label for="pv-clrnote">หมายเหตุ <span class="opt">ไม่บังคับ</span></label><input class="input" id="pv-clrnote" data-clrnote maxlength="300"></div>
          <div class="field span-2"><label class="req">ใบเสร็จ</label><div data-clrpick></div></div></div>
        <div class="btn-row"><button type="button" class="btn btn-primary" data-act="adv-clear">${icon('send')} ส่งเคลียร์</button></div></div>`);
    }
    if (v.canConfirmAdv) {
      const diff = Number(v.amount) - Number(v.advActual);
      parts.push(`<div class="stack-sm"><b>ตรวจเคลียร์ advance</b>
        <div class="text-sm">เบิก ${money(v.amount)} · ใช้จริง <b>${money(v.advActual)}</b> → ${diff > 0 ? `คืนเงินเข้ากล่อง <b>${money(diff)}</b>` : diff < 0 ? `ใช้เกิน <b>${money(-diff)}</b> (สร้างใบเบิกส่วนเกิน)` : 'ยอดตรงกัน'}</div>
        ${v.advClearNote ? `<div class="text-sm muted">“${esc(v.advClearNote)}”</div>` : ''}
        ${thumbs(v.advClearPaths || [])}
        <div class="btn-row"><button type="button" class="btn btn-danger" data-act="adv-back">${icon('x')} ตีกลับ</button>
        <button type="button" class="btn btn-success" data-act="adv-ok">${icon('check')} ยืนยันเคลียร์</button></div></div>`);
    }
    if (v.canEdit) parts.push(`<div class="btn-row"><a class="btn btn-primary" href="#/pv/new?id=${encodeURIComponent(v.id)}">${icon('edit')} แก้ไขแล้วส่งใหม่</a></div>`);
    if (v.canCancel) parts.push(`<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-act="cancel">${icon('trash', 'sm')} ยกเลิกใบนี้</button></div>`);
    if (v.advExtraId) parts.push(`<div class="alert">${icon('info')}<div>ส่วนที่ใช้เกินอยู่ในใบ <a href="#/pv/view?id=${encodeURIComponent(v.advExtraId)}"><b>${esc(v.advExtraId)}</b></a></div></div>`);
    if (v.advReturnId) parts.push(`<div class="alert ok">${icon('check')}<div>คืนเงิน ${money(Number(v.amount) - Number(v.advActual))} บาทเข้ากล่องแล้ว</div></div>`);
    return parts.length ? `<div class="card pad stack">${parts.join('<div class="divider"></div>')}</div>` : '';
  }

  // ส่วนของบัญชี: รอบจ่าย · วันที่ + No. (เลขของบัญชี) ที่หัวใบ · แนบสลิปหลังจ่าย · แก้ไขใบ
  function finCard(v) {
    const parts = [];
    if (v.canSetRound) {
      const c = st.cash;
      parts.push(`<div class="stack-sm"><div class="text-sm muted">รอบจ่าย <span class="opt">ทุกคนเห็นในสถานะ</span></div>
        <div class="seg"><button type="button" data-round="PETTY" class="${v.payRound === 'PETTY' ? 'on' : ''}">Petty cash</button>
          <button type="button" data-round="D20" class="${v.payRound === 'D20' ? 'on' : ''}">รอบ 20 · ${fmtDate(v.payRound === 'D20' && v.payDue ? v.payDue : v.nextD20, { year: false })}</button></div>
        <div class="hint">Petty cash = จ่ายจากเงินในกล่อง · รอบ 20 = โอนจากบัญชีบริษัท (ไม่หักกล่อง ไม่ขึ้น MSBC)</div>
        ${c?.over ? `<div class="alert warn">${icon('alert')}<div>ใบรอจ่ายรอบ Petty cash รวม <b>${money(c.pending)}</b> บาท เกินเงินในกล่อง (${money(c.cash)}) อยู่ ${money(c.short)} บาท</div></div>` : ''}</div>`);
    }
    if (v.canDocInfo) {
      parts.push(`<div class="stack-sm"><div class="text-sm muted">หัวใบฟ้า (บัญชีกรอก · ว่างไว้ = ปริ้นแล้วเขียนมือ)</div>
        <div class="flex wrap gap-8 items-end">
          <div class="field" style="margin:0"><label for="pv-docdate">วันที่ / Date</label><input type="date" class="input" id="pv-docdate" data-docdate value="${esc(v.docDate || '')}"></div>
          <div class="field" style="margin:0"><label for="pv-docid">No. (เลขของบัญชี)</label><input class="input" id="pv-docid" data-docid maxlength="50" value="${esc(v.docId || '')}"></div>
          <button type="button" class="btn btn-secondary" data-act="docinfo">${icon('check', 'sm')} บันทึก</button></div>
        <div class="hint">ID document ในใบฟ้า = เลข ${esc(v.id)} (ขึ้นให้เอง)${!v.docDate ? ' · ไม่ใส่วันที่ = ใช้วันที่จ่ายเงิน (หลังจ่ายแล้ว)' : ''}</div></div>`);
    }
    if (v.canAddSlip) {
      parts.push(`<div class="stack-sm"><div class="text-sm muted">แนบสลิปโอนเงินเพิ่ม</div><div data-slip2pick></div>
        <div><button type="button" class="btn btn-secondary btn-sm" data-act="add-slip">${icon('paperclip', 'sm')} แนบสลิป</button></div></div>`);
    }
    if (v.canFinEdit) parts.push(`<div class="btn-row"><a class="btn btn-secondary" href="#/pv/new?id=${encodeURIComponent(v.id)}&fin=1">${icon('edit')} แก้ไขใบนี้ (บัญชี)</a>
      <span class="text-xs muted">แก้ได้ทุกช่อง · ระบบบันทึกว่าแก้อะไร${v.status === 'Paid' ? ' · จ่ายแล้วแก้ยอดเงินไม่ได้' : ''}</span></div>`);
    return parts.length ? `<div class="card pad stack"><b>${icon('wallet', 'sm')} ส่วนของบัญชี</b>${parts.join('<div class="divider"></div>')}</div>` : '';
  }

  function filesCard(v) {
    const groups = DOCS.map(([k, label]) => [label, v.docs?.[k] || []]).filter(([, p]) => p.length);
    if (v.docs?.slip?.length) groups.push(['สลิปโอนเงิน', v.docs.slip]);
    if (v.advClearPaths?.length && !v.canConfirmAdv) groups.push(['ใบเสร็จเคลียร์ advance', v.advClearPaths]);
    if (!groups.length) return '';
    return `<div class="card pad stack-sm"><b>${icon('paperclip', 'sm')} ไฟล์แนบ</b>${groups.map(([l, p]) => `<div><div class="text-sm muted mb-8">${esc(l)} (${p.length})</div>${thumbs(p)}</div>`).join('')}</div>`;
  }

  // ─────────────── การกระทำ ───────────────
  async function decide(btn, action) {
    const v = st.v;
    let remark = '';
    if (action === 'reject') {
      remark = await promptBox({ title: 'ตีกลับใบนี้', label: 'เหตุผล (คนก่อนหน้าจะเห็น)', hint: v.step === 0 ? 'ใบจะกลับไปให้คนเบิกแก้' : 'ใบจะถอยกลับไปขั้นก่อนหน้า 1 ขั้น', required: true, ok: 'ตีกลับ', danger: true });
      if (remark == null) return;
    }
    if (action === 'approve' && v.isFin1Step) { const err = taxError(); if (err) { toast(err, 'bad'); return; } }
    await withBtn(btn, async () => {
      try {
        const fin1 = action === 'approve' && v.isFin1Step;
        const r = await api.rpc('pv_decide', { p_id: v.id, p_action: action, p_remark: remark, p_vat: fin1 ? st.vat : null,
          p_wht_lines: fin1 ? st.wht.map((w) => ({ rate: w.rate, base: r2(w.base) })) : null, p_round: fin1 ? st.rnd : null });
        await after(action === 'approve' ? (r.status === 'Approved' ? 'อนุมัติครบแล้ว · รอจ่ายเงิน' : `อนุมัติแล้ว · ต่อไป ${r.waiting}`) : `ตีกลับแล้ว · ไปที่ ${r.waiting}`);
      } catch (e) { toastError(e); }
    });
  }
  async function pay(btn) {
    const v = st.v, d = $('[data-paydate]', el)?.value || todayYMD(), d20 = v.payRound === 'D20';
    const ns = st.slip?.count() || 0;
    if (!(await confirmBox({ title: d20 ? 'ยืนยันโอนเงิน (รอบวันที่ 20)' : 'ยืนยันจ่ายเงิน', message: `${v.id} · ${v.payee}\n${money(v.amount)} บาท · วันที่ ${fmtDate(d)}${ns ? `\nแนบสลิป ${ns} ไฟล์` : ''}`, ok: d20 ? 'โอนแล้ว' : 'จ่ายเงินแล้ว' }))) return;
    try {
      const r = await busy('กำลังบันทึก…', async (set) => {
        const slips = st.slip ? await st.slip.uploadAll((n, all) => set(`อัปโหลดสลิป (${n}/${all})`)) : [];
        set('กำลังบันทึก…');
        return api.rpc('pv_pay', { p_id: v.id, p_date: d, p_slips: slips });
      });
      await after(r?.round === 'D20' ? 'บันทึกโอนเงินแล้ว (ไม่หักเงินในกล่อง)' : `บันทึกจ่ายแล้ว · เงินในกล่อง ${money(r?.balance?.cash ?? 0)} บาท`);
      if (r?.negative) setTimeout(() => toast('เงินในกล่องติดลบ — เคลียร์บิล / เติมเงินที่หน้ากล่องเงินสด', 'bad'), 600);
    } catch (e) { toastError(e); }
  }
  async function setRound(btn, r) {
    const v = st.v;
    if (v.payRound === r) return;
    await withBtn(btn, async () => {
      try { await api.rpc('pv_set_round', { p_id: v.id, p_round: r }); await after(r === 'D20' ? 'ตั้งเป็นรอบวันที่ 20 แล้ว · คนเบิกเห็นสถานะ' : 'ตั้งเป็นรอบ Petty cash แล้ว'); }
      catch (e) { toastError(e); }
    });
  }
  async function saveDocInfo(btn) {
    await withBtn(btn, async () => {
      try {
        await api.rpc('pv_set_docinfo', { p_id: st.v.id, p_doc_date: $('[data-docdate]', el)?.value || null, p_doc_id: $('[data-docid]', el)?.value.trim() || '' });
        await after('บันทึกหัวใบแล้ว');
      } catch (e) { toastError(e); }
    });
  }
  async function addSlip() {
    if (!st.slip2?.count()) { toast('เลือกไฟล์สลิปก่อน', 'bad'); return; }
    try {
      await busy('กำลังแนบสลิป…', async (set) => {
        const paths = await st.slip2.uploadAll((n, all) => set(`อัปโหลดสลิป (${n}/${all})`));
        await api.rpc('pv_add_slip', { p_id: st.v.id, p_paths: paths });
      });
      await after('แนบสลิปแล้ว · แจ้งคนเบิกแล้ว');
    } catch (e) { toastError(e); }
  }
  async function clearAdv() {
    const v = st.v, a = Number($('[data-actual]', el)?.value);
    if (!(a >= 0) || $('[data-actual]', el).value === '') { toast('กรุณาใส่ยอดที่ใช้จริง', 'bad'); return; }
    if (a > 0 && !st.clr?.count()) { toast('กรุณาแนบใบเสร็จ', 'bad'); return; }
    try {
      await busy('กำลังส่งเคลียร์…', async (set) => {
        const paths = await st.clr.uploadAll((n, all) => set(`อัปโหลดใบเสร็จ (${n}/${all})`));
        await api.rpc('pv_adv_clear', { p_id: v.id, p_actual: a, p_paths: paths, p_note: $('[data-clrnote]', el)?.value.trim() || '' });
      });
      await after('ส่งเคลียร์แล้ว · รอบัญชีตรวจ');
    } catch (e) { toastError(e); }
  }
  async function confirmAdv(btn, ok) {
    let remark = '';
    if (!ok) { remark = await promptBox({ title: 'ตีกลับการเคลียร์', label: 'เหตุผล', required: true, ok: 'ตีกลับ', danger: true }); if (remark == null) return; }
    await withBtn(btn, async () => {
      try {
        const r = await api.rpc('pv_adv_confirm', { p_id: st.v.id, p_action: ok ? 'approve' : 'reject', p_remark: remark });
        await after(!ok ? 'ตีกลับแล้ว' : r.extraId ? `เคลียร์แล้ว · สร้างใบส่วนเกิน ${r.extraId}` : r.returnId ? 'เคลียร์แล้ว · รับเงินคืนเข้ากล่อง' : 'เคลียร์แล้ว');
      } catch (e) { toastError(e); }
    });
  }
  async function cancel() {
    const why = await promptBox({ title: 'ยกเลิกใบนี้', label: 'เหตุผล', ok: 'ยกเลิกใบ', danger: true });
    if (why == null) return;
    try { await api.rpc('pv_cancel', { p_id: st.v.id, p_remark: why }); await after('ยกเลิกแล้ว'); } catch (e) { toastError(e); }
  }
  function showVoucher() {
    const v = st.v;
    const pr = printPrefs();
    sheet({ title: 'ใบสำคัญจ่าย ' + v.id, wide: true,
      body: `<div class="pv-printopts">
          <div class="flex gap-8" style="align-items:center"><span class="text-sm muted">ขนาด</span><div class="seg">${PRINT_SIZES.map(([k, l]) => `<button type="button" data-size="${k}" class="${pr.size === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="flex gap-8" style="align-items:center"><span class="text-sm muted">สีกระดาษ</span><div class="pv-swatches">${PRINT_COLORS.map(([k, l, c]) => `<button type="button" class="pv-swatch ${pr.color === k ? 'on' : ''}" data-color="${k}" style="background:${c}" title="${l}" aria-label="สี${l}"></button>`).join('')}</div></div>
        </div><div class="pv-preview" data-pvprev>${voucherHtml(v, pr)}</div>`,
      foot: `<button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-primary" data-print>${icon('file')} พิมพ์</button>`,
      onMount: (sh, close) => {
        const fit = () => { const box = sh.querySelector('[data-pvprev]'), sheetEl = box.querySelector('.pv-sheet'); if (!sheetEl) return;
          const z = Math.min(1, (box.clientWidth - 8) / 780); sheetEl.style.zoom = z < 1 ? String(Math.floor(z * 100) / 100) : ''; };
        const redraw = () => { sh.querySelector('[data-pvprev]').innerHTML = voucherHtml(v, pr); hydrateSigs(sh); savePrintPrefs(pr); fit(); };
        sh.addEventListener('click', (e) => {
          const sz = e.target.closest('[data-size]'), co = e.target.closest('[data-color]');
          if (sz) { pr.size = sz.dataset.size; sh.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', b === sz)); redraw(); }
          if (co) { pr.color = co.dataset.color; sh.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b === co)); redraw(); }
        });
        hydrateSigs(sh); fit();
        sh.querySelector('[data-print]').onclick = () => { close(true); printVoucher(v, pr); };
      } });
  }

  el.innerHTML = skeleton(4);
  await load();
  const offs = [
    on(el, 'click', '[data-vat]', (e, t) => { st.vat = Number(t.dataset.vat); repaintTax(); }),
    on(el, 'click', '[data-rnd]', (e, t) => { st.rnd = t.dataset.rnd; repaintTax(); }),
    on(el, 'click', '[data-whtmode]', (e, t) => {
      if (t.dataset.whtmode === 'none') st.wht = [];
      else if (!st.wht?.length) st.wht = [{ rate: 3, base: Number(st.v.base) || 0 }];
      repaintTax();
    }),
    on(el, 'click', '[data-whtrate]', (e, t) => { const i = +t.closest('[data-whti]').dataset.whti; st.wht[i].rate = Number(t.dataset.whtrate); repaintTax(); }),
    on(el, 'click', '[data-whtrm]', (e, t) => { st.wht.splice(+t.dataset.whtrm, 1); repaintTax(); }),
    // พิมพ์ยอดฐาน: อัปเดตตัวเลขอย่างเดียว (ไม่วาดใหม่ เคอร์เซอร์ไม่หลุด)
    on(el, 'input', '[data-whtbase]', (e, t) => {
      const row = t.closest('[data-whti]'), w = st.wht[+row.dataset.whti];
      w.base = Number(t.value) || 0;
      row.querySelector('[data-whtamt]').textContent = money(r2(w.base * w.rate / 100));
      const c = $('[data-vatcalc]', el); if (c) c.innerHTML = vatCalc(st.v);
      const rb = $('[data-rndbox]', el); if (rb) rb.innerHTML = roundSeg(taxTotals(st.v).raw, st.rnd);
    }),
    on(el, 'click', '[data-round]', (e, t) => setRound(t, t.dataset.round)),
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'approve' || a === 'reject') decide(t, a);
      else if (a === 'wht-add') { st.wht.push({ rate: 1, base: Math.max(0, whtLeft()) }); repaintTax(); $$('[data-whtbase]', el).at(-1)?.focus(); }
      else if (a === 'pay') pay(t);
      else if (a === 'docinfo') saveDocInfo(t);
      else if (a === 'add-slip') addSlip();
      else if (a === 'adv-clear') clearAdv();
      else if (a === 'adv-ok') confirmAdv(t, true);
      else if (a === 'adv-back') confirmAdv(t, false);
      else if (a === 'cancel') cancel();
      else if (a === 'voucher') showVoucher();
    }),
  ];
  return () => offs.forEach((f) => f());
}
