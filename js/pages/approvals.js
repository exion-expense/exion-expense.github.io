// รออนุมัติ — กล่องเดียวแทน inbox / manager-inbox / senior-inbox เดิม
// แท็บ "รายการเบิก" (เลือกหลายรายการ อนุมัติทีเดียว) + "ขอเบิกรายเดือน" (ใบ Export รอเซ็น)
import { api, money, fmtDate, fmtDateTime, timeAgo, esc, initials, monthLabel, catName, requestBadge } from '../core.js';
import { html, raw, icon, catIcon, toast, toastError, sheet, confirmBox, promptBox, busy, empty, thumbs, hydrateThumbs, signaturePad, debounce, on } from '../ui.js';

export async function render(ctx) {
  const { el } = ctx;
  const st = { items: null, exports: null, tab: ctx.query.tab === 'exports' ? 'exports' : null, sel: new Set(), q: '', sigSkipped: false };

  const paint = () => {
    if (!ctx.alive() || st.items == null || st.exports == null) return;
    // ไม่มีรายการเบิกแต่มีใบรายเดือน → เปิดแท็บรายเดือนให้เลย
    if (!st.tab) st.tab = !st.items.length && st.exports.length ? 'exports' : 'items';
    const ids = new Set(st.items.map((r) => r.id));
    [...st.sel].forEach((id) => { if (!ids.has(id)) st.sel.delete(id); });
    paintPage(ctx, st);
  };
  const load = () => Promise.all([
    api.load('get_pending_approvals', {}, (d) => { st.items = d || []; paint(); }),
    api.load('get_export_approval_inbox', {}, (d) => { st.exports = d || []; paint(); }).catch(() => { st.exports = st.exports || []; paint(); }),
  ]);
  st.reload = () => load().catch(toastError);
  await load();

  const offs = [
    on(el, 'click', '[data-tab]', (e, t) => { st.tab = t.dataset.tab; paintPage(ctx, st); }),
    on(el, 'click', '[data-act]', (e, t) => act(ctx, st, t)),
    on(el, 'change', '[data-sel]', (e, t) => { t.checked ? st.sel.add(t.dataset.sel) : st.sel.delete(t.dataset.sel); paintList(ctx, st); }),
    on(el, 'click', '.row[data-id]', (e, t) => { if (e.target.closest('.check, a, button')) return; openDetail(ctx, st, t.dataset.id); }),
    on(el, 'input', '[data-search]', debounce((e, t) => { st.q = t.value.trim().toLowerCase(); paintList(ctx, st); }, 200)),
  ];
  return () => offs.forEach((f) => f());
}

// ─────────────── วาดหน้า ───────────────
const amtOf = (r) => Number(r.status === 'PreApprove' && r.preapprove_budget ? r.preapprove_budget : r.amount) || 0;
const isBudget = (r) => r.status === 'PreApprove';

function paintPage(ctx, st) {
  const total = st.items.reduce((s, r) => s + amtOf(r), 0);
  const nExp = st.exports.length;
  ctx.el.innerHTML = `
  <div class="page-head compact"><div><h1>รออนุมัติ</h1>
    <div class="sub">${st.items.length ? `${st.items.length} รายการ · ${money(total)} บาท` : 'ไม่มีรายการเบิกค้าง'}${nExp ? ` · ขอเบิกรายเดือน ${nExp} ใบ` : ''}</div></div></div>
  <div class="tabs" role="tablist">
    <button data-tab="items" class="${st.tab === 'items' ? 'on' : ''}" role="tab">${icon('receipt', 'sm')} รายการเบิก <span class="n">${st.items.length}</span></button>
    <button data-tab="exports" class="${st.tab === 'exports' ? 'on' : ''}" role="tab">${icon('calendar', 'sm')} ขอเบิกรายเดือน <span class="n">${nExp}</span></button>
  </div>
  <div data-body></div>`;
  const body = ctx.el.querySelector('[data-body]');
  if (st.tab === 'exports') { body.innerHTML = exportsTab(st.exports); return; }
  if (!st.items.length) { body.innerHTML = `<div class="card">${empty({ ic: 'check-circle', title: 'ไม่มีรายการรออนุมัติ 🎉', sub: nExp ? 'มีใบขอเบิกรายเดือนรออยู่ในอีกแท็บ' : 'จัดการครบทุกรายการแล้ว' })}</div>`; return; }
  body.innerHTML = `
    ${st.items.length >= 6 ? `<div class="toolbar"><label class="search">${icon('search')}<input class="input" data-search placeholder="ค้นหาชื่อ / หมวด / ลูกค้า" value="${esc(st.q)}" aria-label="ค้นหา"></label></div>` : ''}
    <div data-list></div><div data-bar></div>`;
  paintList(ctx, st);
}

function visible(st) {
  if (!st.q) return st.items;
  return st.items.filter((r) => [r.staff_name, catName(r.category), r.customer, r.venue, r.occasion, r.origin, r.destination, r.department]
    .some((x) => String(x || '').toLowerCase().includes(st.q)));
}

function paintList(ctx, st) {
  const list = ctx.el.querySelector('[data-list]'); if (!list) return;
  const rows = visible(st);
  // จัดกลุ่มตามพนักงาน
  const groups = new Map();
  rows.forEach((r) => { const k = r.staff_email; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const nBudget = rows.filter(isBudget).length;
  list.innerHTML = !rows.length ? `<div class="card">${empty({ ic: 'search', title: 'ไม่พบรายการที่ค้นหา' })}</div>` : `
    ${nBudget ? `<div class="alert neutral mb-12">${icon('shield')}<div>มี <b>${nBudget}</b> รายการเป็น <b>คำขออนุมัติงบล่วงหน้า</b> (ยังไม่มีบิลจริง) — อนุมัติแล้วพนักงานจึงส่งบิลใช้จริงได้</div></div>` : ''}
    <div class="card"><div class="list">${[...groups.values()].map((g) => {
      const sub = g.reduce((s, r) => s + amtOf(r), 0);
      const allOn = g.every((r) => st.sel.has(r.id));
      return `<div class="group-label"><span class="flex gap-4" style="min-width:0"><span class="ellipsis">${esc(g[0].staff_name)}</span><span class="faint">· ${g.length} รายการ</span></span>
        <span class="flex gap-4"><span class="amount">${money(sub)}</span>
        <button class="btn btn-ghost btn-sm" data-act="selgroup" data-email="${esc(g[0].staff_email)}">${allOn ? 'ยกเลิกเลือก' : 'เลือกทั้งหมด'}</button></span></div>
        ${g.map((r) => itemRow(r, st.sel.has(r.id))).join('')}`;
    }).join('')}</div></div>`;
  paintBar(ctx, st);
}

function itemRow(r, checked) {
  const pre = isBudget(r);
  const desc = r.customer || r.venue || (r.origin && r.destination ? `${r.origin} → ${r.destination}` : '') || r.occasion || '';
  const files = (r.receipt_paths || []).length;
  const over = !pre && Number(r.preapprove_budget) > 0 && Number(r.amount) > Number(r.preapprove_budget);
  return `<div class="row click ${checked ? 'selected' : ''}" data-id="${esc(r.id)}">
    <label class="check"><input type="checkbox" data-sel="${esc(r.id)}" ${checked ? 'checked' : ''} aria-label="เลือกรายการ"></label>
    ${catIcon(r.category)}
    <div class="row-main">
      <div class="row-title">${pre ? '<span class="brand-text">ขออนุมัติงบ</span> · ' : ''}${esc(catName(r.category))}</div>
      <div class="row-sub">${fmtDate(r.expense_date)}${desc ? ' · ' + esc(desc) : ''}${r.mileage_km ? ` · ${money(r.mileage_km, 0)} กม.` : ''}${files ? ` · ${icon('paperclip', 'sm')}${files}` : ''}${r.manager_status === 'Bypassed' ? ' · ข้ามขั้นหัวหน้า' : ''}${over ? ' · <span class="bad-text">เกินงบ</span>' : ''}</div>
    </div>
    <div class="row-end"><span class="amount">${money(amtOf(r))}</span>${requestBadge(r)}</div>
  </div>`;
}

function paintBar(ctx, st) {
  const bar = ctx.el.querySelector('[data-bar]'); if (!bar) return;
  if (!st.sel.size) { bar.innerHTML = ''; return; }
  const sum = st.items.filter((r) => st.sel.has(r.id)).reduce((s, r) => s + amtOf(r), 0);
  bar.innerHTML = `<div class="action-bar">
    <button class="btn-icon sm" style="color:#fff" data-act="clear" aria-label="ล้างที่เลือก">${icon('x')}</button>
    <div class="grow"><b>${st.sel.size}</b> รายการ<div class="text-sm amount" style="opacity:.85">${money(sum)} บาท</div></div>
    <button class="btn btn-danger" data-act="reject-sel">ไม่อนุมัติ</button>
    <button class="btn btn-success" data-act="approve-sel">${icon('check', 'sm')} อนุมัติ</button>
  </div>`;
}

const STAGE = { waiting: ['รออนุมัติ', 'b-pending'], approved: ['อนุมัติแล้ว', 'b-approved'], paid: ['โอนแล้ว', 'b-paid'], rejected: ['ไม่อนุมัติ', 'b-rejected'] };
function exportsTab(list) {
  if (!list.length) return `<div class="card">${empty({ ic: 'check-circle', title: 'ไม่มีรายการรออนุมัติ 🎉', sub: 'ไม่มีใบขอเบิกรายเดือนรอคุณเซ็น' })}</div>`;
  return `<div class="card"><div class="list">${list.map((e) => {
    const [t, c] = STAGE[e.stage] || STAGE.waiting;
    return `<a class="row" href="#/export/${encodeURIComponent(e.id)}"><span class="avatar">${esc(initials(e.staff_name))}</span>
      <div class="row-main"><div class="row-title">${esc(e.staff_name)} · รอบ ${monthLabel(e.year, e.month)}</div>
        <div class="row-sub">${e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)} · ` : ''}${e.item_count} รายการ · ขอเมื่อ ${esc(timeAgo(e.requested_at))}</div></div>
      <div class="row-end"><span class="amount">${money(e.total_amount)}</span><span class="badge ${c}">${t}</span></div>
      ${icon('chevron-right', 'sm')}</a>`;
  }).join('')}</div></div>
  <p class="hint mt-12">แตะเพื่อตรวจรายการและอนุมัติ — ยอดในใบคือรายการที่อนุมัติแล้วในช่วงรอบ</p>`;
}

// ─────────────── รายละเอียด 1 รายการ ───────────────
function detailKv(r) {
  const pre = isBudget(r);
  const budget = Number(r.preapprove_budget) || 0;
  const rows = [
    ['พนักงาน', `${r.staff_name}${r.department ? ' · ' + r.department : ''}`],
    ['หมวด', catName(r.category)],
    ['วันที่ใช้จ่าย', fmtDate(r.expense_date)],
    [pre ? 'งบที่ขอ' : 'จำนวนเงิน', raw(`<span class="amount">${money(amtOf(r))}</span> บาท`)],
    !pre && budget ? ['งบที่อนุมัติไว้', raw(`${money(budget)} บาท${Number(r.amount) > budget ? ` · <b class="bad-text">เกินงบ ${money(Number(r.amount) - budget)}</b>` : ' · <span class="ok-text">อยู่ในงบ</span>'}`)] : null,
    r.mileage_km ? ['ระยะทาง', `${money(r.mileage_km, 0)} กม.`] : null,
    r.origin || r.destination ? ['เส้นทาง', `${r.origin || '-'} → ${r.destination || '-'}`] : null,
    r.customer ? ['ลูกค้า', r.customer] : null,
    r.customer_contact ? ['ผู้ติดต่อ', r.customer_contact] : null,
    r.venue ? ['สถานที่', r.venue] : null,
    r.occasion ? ['โอกาส', r.occasion] : null,
    r.attendees ? ['ผู้เข้าร่วม', r.attendees] : null,
    r.job_no ? ['Job No.', r.job_no] : null,
    r.remark ? ['หมายเหตุ', String(r.remark).split(' sig:')[0]] : null,
    ['ขั้นอนุมัติ', r._stage === 'senior' ? (r.manager_status === 'Bypassed' ? 'ขั้นสุดท้าย (ข้ามขั้นหัวหน้า)' : 'ขั้นสุดท้าย') : 'หัวหน้า'],
    ['ส่งเมื่อ', fmtDateTime(r.created_at)],
    ['รหัส', r.id],
  ].filter(Boolean);
  return html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

function openDetail(ctx, st, id) {
  const r = st.items.find((x) => x.id === id); if (!r) return;
  const paths = r.receipt_paths || [];
  sheet({
    title: (isBudget(r) ? 'ขออนุมัติงบ · ' : '') + catName(r.category),
    body: `<div class="flex between mb-12"><span class="flex">${catIcon(r.category)}<span class="callout-amount"><span class="v">${money(amtOf(r))}</span><span class="muted">บาท</span></span></span>${requestBadge(r)}</div>
      ${isBudget(r) ? `<div class="alert neutral mb-12">${icon('shield')}<div>คำขออนุมัติงบล่วงหน้า — ยังไม่มีบิลจริง อนุมัติแล้วพนักงานจึงส่งบิลใช้จริงได้</div></div>` : ''}
      ${detailKv(r)}
      <div class="divider"></div>
      <div class="label mb-8">${icon('paperclip', 'sm')} ใบเสร็จ (${paths.length})</div>
      ${paths.length ? thumbs(paths) : '<p class="hint">ไม่มีไฟล์แนบ</p>'}`,
    foot: `<button class="btn btn-danger" data-no>${icon('x', 'sm')} ไม่อนุมัติ</button><button class="btn btn-success" data-yes>${icon('check', 'sm')} อนุมัติ</button>`,
    onMount: (el, close) => {
      hydrateThumbs(el);
      el.querySelector('[data-yes]').onclick = () => { close(); decide(ctx, st, [id], 'Approved', { single: true }); };
      el.querySelector('[data-no]').onclick = () => { close(); decide(ctx, st, [id], 'Rejected', { single: true }); };
    },
  });
}

// ─────────────── ปุ่ม ───────────────
function act(ctx, st, t) {
  const a = t.dataset.act;
  if (a === 'selgroup') {
    const g = visible(st).filter((r) => r.staff_email === t.dataset.email);
    const allOn = g.every((r) => st.sel.has(r.id));
    g.forEach((r) => (allOn ? st.sel.delete(r.id) : st.sel.add(r.id)));
    paintList(ctx, st);
  } else if (a === 'clear') { st.sel.clear(); paintList(ctx, st); }
  else if (a === 'approve-sel') decide(ctx, st, [...st.sel], 'Approved');
  else if (a === 'reject-sel') decide(ctx, st, [...st.sel], 'Rejected');
}

/** อนุมัติ/ไม่อนุมัติ หลายรายการ — ลบออกจากจอทันที แล้วคืนรายการที่ไม่สำเร็จ */
async function decide(ctx, st, ids, decision, { single = false } = {}) {
  if (!ids.length) return;
  const picked = st.items.filter((r) => ids.includes(r.id));
  const sum = picked.reduce((s, r) => s + amtOf(r), 0);
  let remark = '', sig = null;
  if (decision === 'Rejected') {
    remark = await promptBox({ title: `ไม่อนุมัติ ${ids.length} รายการ`, label: 'เหตุผล (พนักงานจะเห็น)', placeholder: 'เช่น ใบเสร็จไม่ชัด / ไม่อยู่ในนโยบาย', required: true, ok: 'ไม่อนุมัติ', danger: true });
    if (remark == null) return;
  } else {
    if (!single && ids.length > 1) {
      const names = [...new Set(picked.map((r) => r.staff_name))];
      const ok = await confirmBox({ title: `อนุมัติ ${ids.length} รายการ`, message: `${names.join(', ')}\nรวม ${money(sum)} บาท`, ok: 'อนุมัติทั้งหมด' });
      if (!ok) return;
    }
    sig = await ensureSignature(ctx, st);
    if (sig === false) return;          // ปิดหน้าต่างลายเซ็น = ยกเลิก
  }
  // ตัดออกจากจอก่อน (optimistic)
  const before = st.items;
  st.items = st.items.filter((r) => !ids.includes(r.id));
  ids.forEach((id) => st.sel.delete(id));
  paintPage(ctx, st);
  try {
    const res = await api.rpc('decide_many', { p_ids: ids, p_decision: decision, p_remark: remark, p_signature_path: sig || null, p_mode: 'auto' });
    const done = res.done || [], failed = res.failed || [];
    const verb = decision === 'Approved' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (failed.length) {
      const bad = new Set(failed.map((f) => f.id));
      st.items = before.filter((r) => bad.has(r.id) || !ids.includes(r.id));
      if (ctx.alive()) paintPage(ctx, st);
      const why = [...new Set(failed.map((f) => f.error))].slice(0, 2).join(' / ');
      toast(done.length ? `${verb}แล้ว ${done.length} รายการ · ไม่สำเร็จ ${failed.length} รายการ: ${why}` : `${verb}ไม่สำเร็จ: ${why}`, 'bad');
    } else toast(`${verb}แล้ว ${done.length} รายการ`);
  } catch (e) {
    st.items = before;
    if (ctx.alive()) paintPage(ctx, st);
    toastError(e);
  }
  ctx.refreshBadges();
  if (ctx.alive()) st.reload();
}

/** ลายเซ็นผู้อนุมัติ — ระบบใช้ลายเซ็นที่บันทึกไว้ (DB ไม่บังคับ) · ยังไม่มี → ชวนเซ็นครั้งเดียว
 *  คืน path ใหม่ / null (ใช้ของเดิมหรือข้าม) / false (ยกเลิก) */
async function ensureSignature(ctx, st) {
  if (ctx.profile.hasSignature || st.sigSkipped) return null;
  try {
    const me = await api.rpc('get_my_signature', {}, { ttl: 60 });
    if (me?.hasSignature) { ctx.profile.hasSignature = true; return null; }
  } catch { return null; }
  let pad;
  const s = sheet({
    title: 'ลายเซ็นผู้อนุมัติ',
    body: `<p class="muted text-sm mb-12">คุณยังไม่มีลายเซ็นในระบบ — เซ็นครั้งเดียว ระบบจะใช้กับทุกรายการที่คุณอนุมัติและในฟอร์มขอเบิก</p><div data-pad></div>`,
    foot: `<button class="btn btn-secondary" data-skip>ข้ามไปก่อน</button><button class="btn btn-primary" data-save>บันทึกและอนุมัติ</button>`,
    onMount: (el, close) => {
      pad = signaturePad(el.querySelector('[data-pad]'));
      el.querySelector('[data-skip]').onclick = () => close('skip');
      el.querySelector('[data-save]').onclick = () => {
        if (pad.isEmpty()) { toast('กรุณาเซ็นชื่อในกรอบก่อน', 'bad'); return; }
        close('save');
      };
    },
  });
  const v = await s.done;
  if (v === 'skip') { st.sigSkipped = true; return null; }
  if (v !== 'save') return false;
  try {
    const path = await busy('กำลังบันทึกลายเซ็น…', async () => {
      const p = await api.upload(await pad.toBlob(), 'signatures');
      await api.rpc('save_signature', { p_path: p });
      return p;
    });
    ctx.profile.hasSignature = true; ctx.profile.signaturePath = path;
    toast('บันทึกลายเซ็นแล้ว');
    return path;
  } catch (e) { toastError(e); return false; }
}

