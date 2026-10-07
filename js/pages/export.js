// ตรวจคำขอเบิกรายเดือน (ใบ Export) — ผู้อนุมัติเซ็น / ปรับช่วงรอบ · บัญชี/GM ยืนยันโอน · ดาวน์โหลดฟอร์ม
import { api, money, fmtDate, fmtDateTime, esc, initials, monthLabel, catName, requestBadge, todayYMD } from '../core.js?v=10.0.14';
import { html, raw, icon, catIcon, toast, toastError, sheet, confirmBox, promptBox, withBtn, empty, thumbs, hydrateThumbs, debounce, on } from '../ui.js?v=10.0.14';

const STAGE = { waiting: ['รออนุมัติ', 'b-pending'], approved: ['อนุมัติแล้ว · รอโอน', 'b-approved'], paid: ['โอนแล้ว', 'b-paid'], rejected: ['ไม่อนุมัติ', 'b-rejected'] };

export async function render(ctx) {
  const { el, params } = ctx;
  const id = params.id;
  const st = { d: null, start: null, end: null, preview: null, warnings: null };

  const load = () => api.load('get_export_request_detail', { p_id: id }, (d) => {
    if (!ctx.alive()) return;
    st.d = d;
    if (!st.start) { st.start = d.request.period_start; st.end = d.request.period_end; }
    paint(ctx, st);
  });
  st.reload = async () => { st.start = st.end = null; st.preview = null; st.warnings = null; await load(); checkPeriod(ctx, st, true); };
  await load();
  checkPeriod(ctx, st, true);

  const onDate = debounce(() => checkPeriod(ctx, st, false), 350);
  const offs = [
    on(el, 'click', '[data-act]', (e, t) => act(ctx, st, t)),
    on(el, 'click', '.row[data-item]', (e, t) => openItem(st, t.dataset.item)),
    on(el, 'change', '[data-start],[data-end]', (e, t) => {
      if (t.dataset.start !== undefined) st.start = t.value; else st.end = t.value;
      onDate();
    }),
  ];
  return () => offs.forEach((f) => f());
}

// ─────────────── วาดหน้า ───────────────
function paint(ctx, st) {
  const { d } = st;
  const e = d.request;
  const stage = e.stage || 'waiting';
  const [stTxt, stCls] = STAGE[stage] || STAGE.waiting;
  const role = ctx.profile.role || {};
  const canPay = (role.isAccountant || role.isGM) && stage === 'approved';
  ctx.setTitle(`${e.staff_name} · ${monthLabel(e.year, e.month)}`);

  ctx.el.innerHTML = `
  <div class="stack">
    <section class="hero">
      <div class="flex gap-12" style="position:relative;z-index:1">
        <span class="avatar lg" style="background:rgba(255,255,255,.18)">${esc(initials(e.staff_name))}</span>
        <div class="grow"><div class="eyebrow">ขอเบิกรายเดือน · รอบ ${monthLabel(e.year, e.month, true)}</div>
          <div class="text-lg bold">${esc(e.staff_name)}</div>
          <div class="text-sm" style="opacity:.85">${e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)}` : 'ช่วงรอบตามปกติ'}</div></div>
      </div>
      <div class="big mt-16" style="position:relative;z-index:1">฿${money(e.total_amount)}</div>
      <div class="hero-stats">
        <div class="hs"><div class="v">${money(e.item_count, 0)}</div><div class="l">รายการ</div></div>
        ${drifted(d) ? `<div class="hs"><div class="v">${money(d.total, 0)}</div><div class="l">ยอดคำนวณตอนนี้</div></div>`
          : `<div class="hs"><div class="v">${e.period_start ? money(days(e.period_start, e.period_end), 0) : '-'}</div><div class="l">วันในรอบ</div></div>`}
        <div class="hs"><div class="v" style="font-size:15px">${stTxt}</div><div class="l">สถานะ</div></div>
      </div>
    </section>

    ${alerts(st)}

    <div class="split">
      <div class="stack">${itemsCard(d)}</div>
      <div class="stack">
        ${statusCard(e, stage, stTxt, stCls)}
        ${d.canApprove ? periodCard(st) : ''}
        <div class="card"><div class="card-head"><h3>${icon('download')} เอกสาร</h3></div>
          <div class="pad stack-sm">
            <button class="btn btn-secondary btn-block" data-act="xls" data-busy="กำลังสร้างไฟล์…">${icon('sheet')} ฟอร์มขอเบิก (Excel)</button>
            <p class="hint">${stage === 'approved' || stage === 'paid' ? 'ฉบับจริง พร้อมลายเซ็นผู้อนุมัติ' : 'ฉบับตรวจสอบ — ยังไม่มีลายเซ็นอนุมัติ'}</p>
            ${canPay ? `<div class="divider" style="margin:6px 0"></div>
              <button class="btn btn-success btn-block" data-act="paid">${icon('banknote')} ยืนยันโอนแล้ว</button>
              <p class="hint">ระบบจะแจ้งพนักงานทันทีว่าได้รับเงินแล้ว</p>` : ''}
          </div></div>
      </div>
    </div>

    ${d.canApprove ? `<div class="submit-bar">
      <div class="grow"><div class="text-xs muted">ยอดที่จะอนุมัติ</div><b class="amount text-lg" data-bar-total>${money(st.preview ? st.preview.total : d.total)}</b></div>
      <button class="btn btn-danger" data-act="reject">ไม่อนุมัติ</button>
      <button class="btn btn-success" data-act="approve">${icon('check', 'sm')} อนุมัติ</button>
    </div>` : ''}
  </div>`;
}

const snapOf = (e) => ({ snapTotal: Number(e.snapshot?.total ?? e.total_amount) || 0, snapCount: Number(e.snapshot?.count ?? e.item_count) || 0 });
const drifted = (d) => { const { snapTotal, snapCount } = snapOf(d.request); return Math.abs(snapTotal - Number(d.total || 0)) > 0.01 || snapCount !== Number(d.itemCount || 0); };
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;

/** ยอดตอนขอ vs ตอนนี้ (มีคนแก้/ลบ/อนุมัติเพิ่มหลังขอ) + คำเตือนช่วงวัน */
function alerts(st) {
  const { d } = st;
  const e = d.request;
  const out = [];
  if (e.stage === 'rejected') out.push(`<div class="alert bad">${icon('x-circle')}<div><b>ไม่อนุมัติ</b>${e.approver_remark ? ' — ' + esc(e.approver_remark) : ''}</div></div>`);
  const { snapTotal, snapCount } = snapOf(e);
  if (e.stage !== 'rejected' && drifted(d)) {
    const snap = e.snapshot || {};
    const nowIds = new Set((d.items || []).map((r) => r.id));
    const oldIds = new Set(snap.ids || []);
    const added = [...nowIds].filter((x) => !oldIds.has(x)).length, gone = [...oldIds].filter((x) => !nowIds.has(x)).length;
    out.push(`<div class="alert warn">${icon('alert')}<div><b>ยอดเปลี่ยนจากตอนขอเบิก</b><br>
      ตอนขอ ${money(snapTotal)} บาท (${snapCount} รายการ) → ตอนนี้ ${money(d.total)} บาท (${d.itemCount} รายการ)
      ${added || gone ? `<br><span class="text-sm">รายการใหม่ ${added} · หายไป ${gone} — มีการแก้ไข/ลบ/อนุมัติเพิ่มหลังส่งคำขอ</span>` : ''}</div></div>`);
  }
  (st.warnings || []).forEach((w) => out.push(`<div class="alert warn">${icon('alert')}<div>${esc(w)}</div></div>`));
  return out.length ? `<div class="stack-sm">${out.join('')}</div>` : '';
}

function statusCard(e, stage, stTxt, stCls) {
  const steps = [['ขอเบิก', true], ['อนุมัติ', stage === 'approved' || stage === 'paid'], ['โอนแล้ว', stage === 'paid']];
  const nowIdx = steps.findIndex((s) => !s[1]);
  const rows = [
    ['ขอเมื่อ', fmtDateTime(e.requested_at)],
    e.requested_by && e.requested_by.toLowerCase() !== String(e.staff_email).toLowerCase() ? ['ขอแทนโดย', e.requested_by] : null,
    ['ผู้อนุมัติ', e.decided_by === 'auto' ? 'อนุมัติอัตโนมัติ' : e.approver_name || e.approver_email || '-'],
    e.decided_at ? [stage === 'rejected' ? 'ไม่อนุมัติเมื่อ' : 'อนุมัติเมื่อ', fmtDateTime(e.decided_at)] : null,
    e.approver_remark && stage !== 'rejected' ? ['หมายเหตุ', e.approver_remark] : null,
    e.paid_at ? ['โอนเมื่อ', `${fmtDateTime(e.paid_at)}${e.paid_by_name ? ' · ' + e.paid_by_name : ''}`] : null,
  ].filter(Boolean);
  return `<div class="card"><div class="card-head"><h3>${icon('clock')} สถานะ</h3><span class="badge ${stCls}">${esc(stTxt)}</span></div>
    <div class="pad">
      <div class="steps mb-16">${steps.map(([l, ok], i) => {
        const fail = stage === 'rejected' && i === 1;
        return `<div class="st ${fail ? 'fail' : ok ? 'done' : i === nowIdx ? 'now' : ''}"><span class="dot">${fail ? icon('x') : ok ? icon('check') : ''}</span>${l}</div>`;
      }).join('')}</div>
      ${html`<dl class="kv tight">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`}
    </div></div>`;
}

function periodCard(st) {
  const e = st.d.request;
  const today = todayYMD();
  return `<div class="card"><div class="card-head"><h3>${icon('calendar')} ช่วงรอบ</h3></div>
    <div class="pad stack-sm">
      <div class="form-grid two">
        <div class="field"><label for="ps">เริ่ม</label><input id="ps" type="date" class="input" data-start value="${esc(st.start || '')}" max="${today}"></div>
        <div class="field"><label for="pe">สิ้นสุด</label><input id="pe" type="date" class="input" data-end value="${esc(st.end || '')}" max="${today}"></div>
      </div>
      <div data-preview>${previewHtml(st)}</div>
      <p class="hint">ปรับช่วงได้ถ้าพนักงานเลือกวันผิด — ยอดจะคำนวณใหม่ตอนอนุมัติ${e.period_start ? ` (เดิม ${fmtDate(e.period_start)} – ${fmtDate(e.period_end)})` : ''}</p>
    </div></div>`;
}

function changed(st) {
  const e = st.d.request;
  return !!(st.start && st.end) && (st.start !== e.period_start || st.end !== e.period_end);
}
function previewHtml(st) {
  const p = st.preview;
  if (!p) return '';
  return `<div class="alert ${changed(st) ? 'warn' : 'neutral'}">${icon(changed(st) ? 'alert' : 'info')}<div>
    ${changed(st) ? '<b>จะปรับช่วงรอบ</b> · ' : ''}${p.periodStartTH || ''} – ${p.periodEndTH || ''}<br>
    <b>${p.count}</b> รายการ · <b class="amount">${money(p.total)}</b> บาท${p.pendingCount ? ` · รออนุมัติอีก ${p.pendingCount}` : ''}</div></div>`;
}

/** ดูยอด/คำเตือนของช่วงที่เลือก (ตัวเลขเดียวกับที่จะอยู่ในไฟล์) */
async function checkPeriod(ctx, st, first) {
  const e = st.d?.request;
  if (!e || e.stage !== 'waiting' || !st.start || !st.end) return;
  if (st.end < st.start) { toast('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'bad'); return; }
  try {
    const p = await api.rpc('preview_period', { p_staff_email: e.staff_email, p_start: st.start, p_end: st.end, p_export_id: e.id }, { quiet: !first });
    if (!ctx.alive()) return;
    st.preview = p;
    st.warnings = p.warnings || [];
    if (first) { paint(ctx, st); return; }
    const box = ctx.el.querySelector('[data-preview]'); if (box) box.innerHTML = previewHtml(st);
    const bt = ctx.el.querySelector('[data-bar-total]'); if (bt) bt.textContent = money(p.total);
  } catch (err) { if (!first) toastError(err); }
}

// ─────────────── รายการแยกหมวด ───────────────
function itemsCard(d) {
  const items = d.items || [], auto = d.autoAllowance || [];
  if (!items.length && !auto.length) return `<div class="card">${empty({ ic: 'receipt', title: 'ไม่มีรายการในช่วงนี้', sub: 'อาจถูกลบหรือแก้ไขหลังส่งคำขอ' })}</div>`;
  const groups = new Map();
  items.forEach((r) => { const k = String(r.category || '').toUpperCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const sorted = [...groups.entries()].map(([k, g]) => [k, g, g.reduce((s, r) => s + Number(r.amount || 0), 0)]).sort((a, b) => b[2] - a[2]);
  return `<div class="card"><div class="card-head"><h3>${icon('receipt')} รายการในรอบ</h3><span class="text-sm muted">${d.itemCount} รายการ</span></div>
    <div class="list">
      ${sorted.map(([k, g, sub]) => `<div class="group-label"><span>${esc(catName(k))} · ${g.length}</span><span class="amount">${money(sub)}</span></div>
        ${g.map(itemRow).join('')}`).join('')}
      ${auto.length ? `<div class="group-label"><span>ค่าเหมาจ่ายอัตโนมัติ</span><span class="amount">${money(auto.reduce((s, a) => s + Number(a.amount || 0), 0))}</span></div>
        ${auto.map((a) => `<div class="row">${catIcon(a.category)}<div class="row-main"><div class="row-title">${esc(catName(a.category))}</div>
          <div class="row-sub">เพิ่มให้อัตโนมัติตามสิทธิ์รายเดือน</div></div><div class="row-end"><span class="amount">${money(a.amount)}</span><span class="badge b-info plain">อัตโนมัติ</span></div></div>`).join('')}` : ''}
    </div>
    <div class="card-foot flex between"><span class="bold">รวมทั้งสิ้น</span><span class="amount text-lg">${money(d.total)} บาท</span></div></div>`;
}

function itemRow(r) {
  const desc = r.customer || r.venue || (r.origin && r.destination ? `${r.origin} → ${r.destination}` : '') || r.occasion || '';
  const files = (r.receipt_paths || []).length;
  return `<div class="row click" data-item="${esc(r.id)}">${catIcon(r.category)}
    <div class="row-main"><div class="row-title">${esc(desc || catName(r.category))}</div>
      <div class="row-sub">${fmtDate(r.expense_date)}${r.mileage_km ? ` · ${money(r.mileage_km, 0)} กม.` : ''}${files ? ` · ${icon('paperclip', 'sm')}${files}` : ''}</div></div>
    <div class="row-end"><span class="amount">${money(r.amount)}</span>${r.status !== 'Approved' ? requestBadge(r) : ''}</div></div>`;
}

function openItem(st, id) {
  const r = (st.d.items || []).find((x) => x.id === id); if (!r) return;
  const paths = r.receipt_paths || [];
  const rows = [
    ['หมวด', catName(r.category)], ['วันที่ใช้จ่าย', fmtDate(r.expense_date)],
    ['จำนวนเงิน', raw(`<span class="amount">${money(r.amount)}</span> บาท`)],
    r.mileage_km ? ['ระยะทาง', `${money(r.mileage_km, 0)} กม.`] : null,
    r.origin || r.destination ? ['เส้นทาง', `${r.origin || '-'} → ${r.destination || '-'}`] : null,
    r.customer ? ['ลูกค้า', r.customer] : null, r.customer_contact ? ['Contact name', r.customer_contact] : null,
    r.venue ? ['สถานที่', r.venue] : null, r.occasion ? [(/^(ENT|GOLF)$/i.test(r.category) ? 'Purpose of entertainment' : 'Purpose of visiting'), r.occasion] : null, r.attendees ? ['ผู้เข้าร่วม', r.attendees] : null,
    r.job_no ? ['Job No.', r.job_no] : null, r.remark ? ['หมายเหตุ', String(r.remark).split(' sig:')[0]] : null,
    r.approved_by ? ['อนุมัติโดย', `${r.approved_by}${r.approved_at ? ' · ' + fmtDateTime(r.approved_at) : ''}`] : null,
    ['รหัส', r.id],
  ].filter(Boolean);
  sheet({
    title: catName(r.category),
    body: `${html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`}
      <div class="divider"></div><div class="label mb-8">${icon('paperclip', 'sm')} ใบเสร็จ (${paths.length})</div>
      ${paths.length ? thumbs(paths) : '<p class="hint">ไม่มีไฟล์แนบ</p>'}`,
    onMount: (el) => hydrateThumbs(el),
  });
}

// ─────────────── ปุ่ม ───────────────
async function act(ctx, st, t) {
  const e = st.d.request;
  try {
    if (t.dataset.act === 'approve') {
      const ch = changed(st);
      if (ch && st.end < st.start) { toast('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'bad'); return; }
      const total = st.preview ? st.preview.total : st.d.total;
      const ok = await confirmBox({
        title: 'อนุมัติคำขอเบิกรายเดือน',
        message: `${e.staff_name} · รอบ ${monthLabel(e.year, e.month)}\n${ch ? `ปรับช่วงเป็น ${fmtDate(st.start)} – ${fmtDate(st.end)}\n` : ''}ยอด ${money(total)} บาท\n\nอนุมัติแล้วบัญชีจะเห็นบนบอร์ดโอนเงินทันที`,
        ok: 'อนุมัติ',
      });
      if (!ok) return;
      await withBtn(t, () => api.rpc('approve_export_request', { p_id: e.id, p_decision: 'Approved', p_remark: '', p_start: ch ? st.start : null, p_end: ch ? st.end : null }));
      toast('อนุมัติแล้ว — แจ้งพนักงานและบัญชีแล้ว');
    } else if (t.dataset.act === 'reject') {
      const why = await promptBox({ title: 'ไม่อนุมัติคำขอเบิกรายเดือน', label: 'เหตุผล (พนักงานจะเห็น)', placeholder: 'เช่น ช่วงวันไม่ถูกต้อง / มีรายการต้องแก้ก่อน', required: true, ok: 'ไม่อนุมัติ', danger: true });
      if (why == null) return;
      await withBtn(t, () => api.rpc('approve_export_request', { p_id: e.id, p_decision: 'Rejected', p_remark: why }));
      toast('บันทึกแล้ว — แจ้งพนักงานแล้ว');
    } else if (t.dataset.act === 'paid') {
      const ok = await confirmBox({ title: 'ยืนยันโอนเงินแล้ว', message: `${e.staff_name} · รอบ ${monthLabel(e.year, e.month)}\n${money(e.total_amount)} บาท\n\nระบบจะแจ้งพนักงานทันที`, ok: 'ยืนยันโอนแล้ว' });
      if (!ok) return;
      await withBtn(t, () => api.rpc('mark_export_paid', { p_id: e.id }));
      toast('บันทึกการโอนแล้ว');
    } else if (t.dataset.act === 'xls') {
      const approved = e.stage === 'approved' || e.stage === 'paid';
      const body = approved
        ? { type: 'staff_form', kind: 'final', exportId: e.id }
        : { type: 'staff_form', kind: 'draft', staffEmail: e.staff_email, year: e.year, month: e.month, periodStart: e.period_start || undefined, periodEnd: e.period_end || undefined };
      const meta = await withBtn(t, () => api.excel(body));
      if (meta) {
        toast(`ดาวน์โหลดแล้ว · ${meta.itemCount ?? ''} รายการ · ${money(meta.totalAmount)} บาท`);
        if (meta.drift) toast(`ยอดในไฟล์ (${money(meta.drift.currentTotal)}) ไม่ตรงกับตอนอนุมัติ (${money(meta.drift.approvedTotal)}) — บันทึกไว้ให้ตรวจสอบแล้ว`, 'bad');
      }
      return;
    } else return;
    ctx.refreshBadges();
    if (ctx.alive()) await st.reload();
  } catch (err) { toastError(err); }
}
