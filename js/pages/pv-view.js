// ใบสำคัญจ่าย 1 ใบ — ขั้นอนุมัติ / กดอนุมัติ-ตีกลับ / บัญชี 1 เลือก VAT-WHT + จ่ายเงิน / เคลียร์ advance / พิมพ์ใบฟ้า
import { api, money, fmtDate, fmtDateTime, esc, todayYMD, catName, loadPettyCategories } from '../core.js?v=10.1.4';
import { icon, catIcon, toast, toastError, confirmBox, promptBox, busy, withBtn, sheet, thumbs, hydrateThumbs, receiptPicker, errorBox, skeleton, on, $ } from '../ui.js?v=10.1.4';
import { DOCS, KIND, isTest, stageBadge, kindBadge, voucherHtml, hydrateSigs, printVoucher, PRINT_SIZES, PRINT_COLORS, printPrefs, savePrintPrefs } from './pv-common.js?v=10.1.4';

const ACT = { submit: 'ส่งใบเบิก', resubmit: 'แก้แล้วส่งใหม่', approve: 'อนุมัติ', reject: 'ตีกลับ', pay: 'จ่ายเงิน', cancel: 'ยกเลิก',
  adv_clear: 'ส่งเคลียร์', adv_back: 'ตีกลับการเคลียร์', adv_ok: 'เคลียร์เรียบร้อย' };

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
  const st = { v: null, vat: null, wht: null, clr: null };

  async function load() {
    try {
      [st.v] = await Promise.all([api.rpc('get_pv', { p_id: id }), loadPettyCategories().catch(() => [])]);
      if (!ctx.alive()) return;
      ctx.setTitle(st.v.id);
      paint();
    } catch (e) { if (ctx.alive()) errorBox(el, e, load); }
  }
  const after = async (msg) => { if (msg) toast(msg); ctx.refreshBadges(); await load(); };

  function paint() {
    const v = st.v;
    const steps = v.steps || [];
    const done = (s) => s.state === 'done';
    const nowIdx = v.status === 'Pending' ? v.step : -1;
    const payDone = v.status === 'Paid', payNow = v.status === 'Approved';
    el.innerHTML = `
    <div class="stack">
      <div class="card pad stack-sm">
        <div class="flex between wrap gap-8">
          <div class="stack-sm" style="gap:4px"><div class="flex wrap gap-8"><b class="mono text-lg">${esc(v.id)}</b>${isTest(v.id) ? '<span class="badge b-pending">ข้อมูลทดลอง</span>' : ''}${kindBadge(v.kind)}${v.isOffice ? '<span class="badge b-info plain">Office expenses</span>' : ''}</div>
            <div class="text-sm muted">${esc(v.requesterName)}${v.department ? ' · ' + esc(v.department) : ''}${v.onBehalfBy ? ` · <span class="badge b-info plain">กรอกโดย ${esc(v.onBehalfBy)}</span>` : ''} · ${fmtDateTime(v.createdAt)}</div></div>
          <div class="text-right"><div class="callout-amount"><span class="v amount">${money(v.amount)}</span><span class="muted">บาท</span></div>${stageBadge(v)}</div>
        </div>
        <div class="pv-progress">${steps.map((s, i) => `<div class="pv-ps ${done(s) ? 'done' : i === nowIdx ? 'now' : ''}">
            <span class="dot">${done(s) ? icon('check', 'sm') : ''}</span><span class="t">${esc(s.label)}</span>
            <span class="n">${esc(done(s) ? s.byName : s.names)}</span>${done(s) && s.at ? `<span class="d">${fmtDate(s.at)}</span>` : ''}</div>`).join('')}
          <div class="pv-ps ${payDone ? 'done' : payNow ? 'now' : ''}"><span class="dot">${payDone ? icon('check', 'sm') : ''}</span><span class="t">จ่ายเงิน</span>
            <span class="n">${payDone ? esc(v.paidBy || 'บัญชี 1') : 'บัญชี 1'}</span>${payDone ? `<span class="d">${fmtDate(v.paidAt)}</span>` : ''}</div>
        </div>
        ${v.status === 'Returned' || (v.status === 'Pending' && v.remark) ? `<div class="alert ${v.status === 'Returned' ? 'bad' : 'warn'}">${icon('alert')}<div><b>${v.status === 'Returned' ? 'ถูกตีกลับให้แก้' : 'ถูกตีกลับมาที่ขั้นนี้'}:</b> ${esc(v.remark)}</div></div>` : ''}
        ${v.advOverdue ? `<div class="alert bad">${icon('clock')}<div>เลยกำหนดเคลียร์ advance (${fmtDate(v.advDue)}) — ส่งใบเสร็จด้านล่าง</div></div>` : v.kind === 'ADV' && v.advDue && v.advClear !== 'Cleared' ? `<div class="alert warn">${icon('clock')}<div>ต้องเคลียร์ advance ภายใน <b>${fmtDate(v.advDue)}</b></div></div>` : ''}
      </div>

      ${actionCard(v)}

      <div class="card pad stack-sm">
        <div class="flex between wrap"><b>รายละเอียด</b>${canPrint(v) ? `<button type="button" class="btn btn-secondary btn-sm" data-act="voucher">${icon('file', 'sm')} ใบฟ้า / พิมพ์</button>` : '<span class="text-xs muted">พิมพ์ใบฟ้าได้ตั้งแต่ขั้นบัญชี 1</span>'}</div>
        <dl class="kv">${[
          ['จ่ายให้', v.payee], ['ธนาคาร', v.payBank], ['เลขบัญชี', v.payAccount], ['Job No.', v.jobNo], ['PO No.', v.poNo], ['Cost sheet No.', v.costSheetNo],
          [v.kind === 'ADV' ? 'วันที่จะใช้' : 'วันที่', v.expenseDate ? fmtDate(v.expenseDate) : ''], ['วันที่จัดส่งสินค้า', v.deliveryDate ? fmtDate(v.deliveryDate) : ''], ['หมายเหตุ', v.note],
          ['ประเภท', KIND[v.kind]],
        ].filter(([, x]) => x).map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl>
        <div class="table-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>#</th><th>หมวด</th><th>รายการ</th><th class="r">จำนวนเงิน</th></tr></thead><tbody>
          ${(v.lines || []).map((l, i) => `<tr><td>${i + 1}</td><td><span class="flex gap-8 nowrap" style="align-items:center">${catIcon(l.category, 28)}${esc(catName(l.category))}</span></td><td>${esc(l.description)}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}
          <tr><td></td><td></td><td class="muted">ยอดก่อน VAT</td><td class="r">${money(v.base)}</td></tr>
          ${Number(v.vatAmount) ? `<tr><td></td><td></td><td class="muted">VAT ${Number(v.vatRate)}%</td><td class="r">${money(v.vatAmount)}</td></tr>` : ''}
          ${Number(v.whtAmount) ? `<tr><td></td><td></td><td class="muted">หัก ณ ที่จ่าย ${Number(v.whtRate)}%</td><td class="r">(${money(v.whtAmount)})</td></tr>` : ''}
        </tbody><tfoot><tr><td></td><td></td><td>ยอดจ่ายสุทธิ</td><td class="r">${money(v.amount)}</td></tr></tfoot></table></div>
      </div>

      ${filesCard(v)}

      <div class="card pad stack-sm"><b>ประวัติ</b>
        <div class="pv-history">${(v.history || []).slice().reverse().map((h) => `<div class="it ${h.act === 'reject' || h.act === 'adv_back' ? 'bad' : h.act === 'pay' || h.act === 'adv_ok' ? 'ok' : ''}">
          <span class="dot"></span><div class="grow"><b>${esc(h.name || h.by)}</b> · ${esc(ACT[h.act] || h.act)}${h.label && h.act !== 'submit' && h.act !== 'resubmit' ? ' · ' + esc(h.label) : ''}
          ${h.remark ? `<div class="text-sm muted">“${esc(h.remark)}”</div>` : ''}</div><span class="text-xs muted nowrap">${fmtDateTime(h.at)}</span></div>`).join('')}</div>
      </div>
    </div>`;
    hydrateThumbs(el);
    const cp = $('[data-clrpick]', el); st.clr = cp ? receiptPicker(cp, { max: 10 }) : null;
  }

  function actionCard(v) {
    const parts = [];
    if (v.canAct && v.isFin1Step) {
      const vat = st.vat ?? (Number(v.vatRate) || null), wht = st.wht ?? (Number(v.whtRate) || null);
      const b = Number(v.base) || 0, va = vat ? Math.round(b * vat) / 100 : 0, wa = wht ? Math.round(b * wht) / 100 : 0;
      parts.push(`<div class="stack-sm"><b>บัญชี 1: เลือก VAT และหัก ณ ที่จ่าย</b>
        <div class="flex wrap gap-16">
          <div><div class="text-sm muted mb-8">VAT</div><div class="seg"><button type="button" data-vat="0" class="${vat === 0 ? 'on' : ''}">ไม่มี</button><button type="button" data-vat="7" class="${vat === 7 ? 'on' : ''}">7%</button></div></div>
          <div><div class="text-sm muted mb-8">หัก ณ ที่จ่าย</div><div class="seg"><button type="button" data-wht="0" class="${wht === 0 ? 'on' : ''}">ไม่หัก</button><button type="button" data-wht="3" class="${wht === 3 ? 'on' : ''}">3%</button></div></div>
        </div>
        <div class="text-sm">${money(b)} ${vat ? `+ VAT ${money(va)}` : ''} ${wht ? `− WHT ${money(wa)}` : ''} = <b class="amount">${money(b + va - wa)}</b> บาท</div></div>`);
    }
    if (v.canAct) {
      parts.push(`<div class="btn-row"><button type="button" class="btn btn-danger" data-act="reject">${icon('x')} ตีกลับ</button>
        <button type="button" class="btn btn-success" data-act="approve">${icon('check')} อนุมัติ${v.stepLabel ? ' (' + esc(v.stepLabel) + ')' : ''}</button></div>`);
    }
    if (v.canPay) {
      parts.push(`<div class="stack-sm"><b>จ่ายเงิน</b><div class="flex wrap gap-8 items-end">
        <div class="field" style="margin:0"><label for="pv-paydate">วันที่จ่าย</label><input type="date" class="input" id="pv-paydate" data-paydate value="${todayYMD()}" max="${todayYMD()}"></div>
        <button type="button" class="btn btn-success" data-act="pay">${icon('banknote')} บันทึกจ่ายเงิน ${money(v.amount)} บาท</button></div>
        <div class="hint">เงินออกจากกล่องเงินสด และขึ้นตาราง MSBC ทันที</div></div>`);
    }
    if (v.canClearAdv) {
      parts.push(`<div class="stack-sm"><b>เคลียร์ advance</b>
        <div class="form-grid two"><div class="field"><label class="req" for="pv-actual">ยอดที่ใช้จริง</label>
          <div class="input-group has-suf"><input type="number" class="input" id="pv-actual" data-actual inputmode="decimal" step="0.01" min="0" placeholder="0.00"><span class="suf">บาท</span></div>
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

  function filesCard(v) {
    const groups = DOCS.map(([k, label]) => [label, v.docs?.[k] || []]).filter(([, p]) => p.length);
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
    if (action === 'approve' && v.isFin1Step && (st.vat ?? null) === null) { toast('เลือก VAT และหัก ณ ที่จ่ายก่อน', 'bad'); return; }
    if (action === 'approve' && v.isFin1Step && (st.wht ?? null) === null) { toast('เลือกหัก ณ ที่จ่ายก่อน', 'bad'); return; }
    await withBtn(btn, async () => {
      try {
        const r = await api.rpc('pv_decide', { p_id: v.id, p_action: action, p_remark: remark, p_vat: st.vat, p_wht: st.wht });
        await after(action === 'approve' ? (r.status === 'Approved' ? 'อนุมัติครบแล้ว · รอจ่ายเงิน' : `อนุมัติแล้ว · ต่อไป ${r.waiting}`) : `ตีกลับแล้ว · ไปที่ ${r.waiting}`);
      } catch (e) { toastError(e); }
    });
  }
  async function pay(btn) {
    const v = st.v, d = $('[data-paydate]', el)?.value || todayYMD();
    if (!(await confirmBox({ title: 'ยืนยันจ่ายเงิน', message: `${v.id} · ${v.payee}\n${money(v.amount)} บาท · วันที่ ${fmtDate(d)}`, ok: 'จ่ายเงินแล้ว' }))) return;
    await withBtn(btn, async () => {
      try {
        const r = await api.rpc('pv_pay', { p_id: v.id, p_date: d });
        await after(`บันทึกจ่ายแล้ว · เงินในกล่อง ${money(r?.balance?.cash ?? 0)} บาท`);
        if (r?.negative) setTimeout(() => toast('เงินในกล่องติดลบ — เคลียร์บิล / เติมเงินที่หน้ากล่องเงินสด', 'bad'), 600);
      } catch (e) { toastError(e); }
    });
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
        const redraw = () => { sh.querySelector('[data-pvprev]').innerHTML = voucherHtml(v, pr); hydrateSigs(sh); savePrintPrefs(pr); };
        sh.addEventListener('click', (e) => {
          const sz = e.target.closest('[data-size]'), co = e.target.closest('[data-color]');
          if (sz) { pr.size = sz.dataset.size; sh.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', b === sz)); redraw(); }
          if (co) { pr.color = co.dataset.color; sh.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b === co)); redraw(); }
        });
        hydrateSigs(sh);
        sh.querySelector('[data-print]').onclick = () => { close(true); printVoucher(v, pr); };
      } });
  }

  el.innerHTML = skeleton(4);
  await load();
  const offs = [
    on(el, 'click', '[data-vat]', (e, t) => { st.vat = Number(t.dataset.vat); paint(); }),
    on(el, 'click', '[data-wht]', (e, t) => { st.wht = Number(t.dataset.wht); paint(); }),
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'approve' || a === 'reject') decide(t, a);
      else if (a === 'pay') pay(t);
      else if (a === 'adv-clear') clearAdv();
      else if (a === 'adv-ok') confirmAdv(t, true);
      else if (a === 'adv-back') confirmAdv(t, false);
      else if (a === 'cancel') cancel();
      else if (a === 'voucher') showVoucher();
    }),
  ];
  return () => offs.forEach((f) => f());
}
