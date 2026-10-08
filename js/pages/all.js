// คำขอทั้งบริษัท (GM / บัญชี / CEO / ผู้ดูรายงาน) — เลือกช่วงวัน · กรองสถานะ/แผนก/หมวด/คน · ค้นหา · Excel
import { api, money, compact, fmtDate, fmtDateTime, esc, catName, requestBadge, ymd } from '../core.js?v=10.0.16';
import { html, raw, icon, catIcon, toast, toastError, sheet, withBtn, empty, skeleton, errorBox, requestRow, thumbs, hydrateThumbs, debounce, on } from '../ui.js?v=10.0.16';

const PRESETS = [['period', 'รอบนี้'], ['month', 'เดือนนี้'], ['last', 'เดือนก่อน'], ['custom', 'กำหนดเอง']];
const STATUSES = [['all', 'ทั้งหมด'], ['Pending', 'รออนุมัติ'], ['Approved', 'อนุมัติแล้ว'], ['Rejected', 'ไม่อนุมัติ'], ['PreApprove', 'ขออนุมัติงบ'], ['Finalized', 'ส่งบิลแล้ว']];
const PAGE = 200;

// วันสุดท้ายของเดือน ถ้าวันตัดเกินจำนวนวัน
const clampDay = (y, m, d) => new Date(y, m - 1, Math.min(d, new Date(y, m, 0).getDate()));

export async function render(ctx) {
  const { el } = ctx;
  const st = { preset: 'period', from: '', to: '', rows: null, status: 'all', dept: '', cat: '', staff: '', q: '', limit: PAGE, cutoff: 25, showFilters: false };
  try { st.cutoff = Number((await api.rpc('get_period_info', { p_year: new Date().getFullYear(), p_month: new Date().getMonth() + 1 }, { ttl: 3600 })).cutoffDay) || 25; } catch {}
  setRange(st);
  paintShell(ctx, st);
  await load(ctx, st, true);

  const repaint = () => paintResults(ctx, st);
  const offs = [
    on(el, 'click', '[data-preset]', (e, t) => {
      st.preset = t.dataset.preset;
      if (st.preset !== 'custom') { setRange(st); load(ctx, st); }
      paintShell(ctx, st, true);
    }),
    on(el, 'change', '[data-from],[data-to]', () => {
      const f = el.querySelector('[data-from]').value, t = el.querySelector('[data-to]').value;
      if (!f || !t) return;
      if (t < f) { toast('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'bad'); return; }
      st.from = f; st.to = t; paintShell(ctx, st, true); load(ctx, st);
    }),
    on(el, 'click', '[data-status]', (e, t) => { st.status = t.dataset.status; st.limit = PAGE; repaint(); }),
    on(el, 'change', '[data-f]', (e, t) => { st[t.dataset.f] = t.value; st.limit = PAGE; repaint(); }),
    on(el, 'input', '[data-search]', debounce((e, t) => { st.q = t.value.trim().toLowerCase(); st.limit = PAGE; repaint(); }, 200)),
    on(el, 'click', '[data-act]', (e, t) => act(ctx, st, t)),
    on(el, 'click', '[data-id]', (e, t) => openDetail(st, t.dataset.id)),
  ];
  return () => offs.forEach((f) => f());
}

function setRange(st) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
  if (st.preset === 'month') { st.from = ymd(new Date(y, m - 1, 1)); st.to = ymd(new Date(y, m, 0)); }
  else if (st.preset === 'last') { st.from = ymd(new Date(y, m - 2, 1)); st.to = ymd(new Date(y, m - 1, 0)); }
  else if (st.preset === 'period') {
    // รอบเบิก: (วันตัดเดือนก่อน + 1) → วันตัดเดือนนี้ · เลยวันตัดแล้ว = รอบถัดไป
    if (st.cutoff >= 31) { st.from = ymd(new Date(y, m - 1, 1)); st.to = ymd(new Date(y, m, 0)); return; }
    let ey = y, em = m;
    if (now.getDate() > clampDay(y, m, st.cutoff).getDate()) { em = m + 1; if (em > 12) { em = 1; ey++; } }
    const py = em === 1 ? ey - 1 : ey, pm = em === 1 ? 12 : em - 1;
    const s = clampDay(py, pm, st.cutoff); s.setDate(s.getDate() + 1);
    st.from = ymd(s); st.to = ymd(clampDay(ey, em, st.cutoff));
  }
}

async function load(ctx, st, first = false) {
  const key = st.from + st.to;
  const box = ctx.el.querySelector('[data-results]');
  if (!first && box) { st.rows = null; paintResults(ctx, st); }
  try {
    await api.load('get_all_requests', { p_from: st.from, p_to: st.to }, (d) => {
      if (!ctx.alive() || key !== st.from + st.to) return;
      st.rows = (d || []).slice().sort((a, b) => String(b.expense_date || b.created_at).localeCompare(String(a.expense_date || a.created_at))); st.limit = PAGE;
      paintFilters(ctx, st); paintResults(ctx, st);
    });
  } catch (e) {
    if (first) throw e;
    const b = ctx.el.querySelector('[data-results]');
    if (b && ctx.alive()) errorBox(b, e, () => load(ctx, st));
  }
}

// ─────────────── โครงหน้า ───────────────
function paintShell(ctx, st, keep = false) {
  if (keep && ctx.el.querySelector('[data-results]')) {
    // เปลี่ยนแค่ช่วงวัน — ไม่วาดทั้งหน้าใหม่ (ช่องค้นหาไม่หลุด)
    ctx.el.querySelector('[data-presets]').innerHTML = presetBtns(st);
    ctx.el.querySelector('[data-custom]').classList.toggle('hidden', st.preset !== 'custom');
    ctx.el.querySelector('[data-range]').textContent = rangeLabel(st);
    ctx.el.querySelector('[data-from]').value = st.from;
    ctx.el.querySelector('[data-to]').value = st.to;
    return;
  }
  ctx.el.innerHTML = `
  <div class="page-head"><div><h1>คำขอทั้งบริษัท</h1><div class="sub" data-range>${esc(rangeLabel(st))}</div></div>
    <div class="actions"><button class="btn btn-secondary" data-act="xls" data-busy="กำลังสร้างไฟล์…">${icon('download', 'sm')} Excel</button></div></div>
  <div class="stack-sm">
    <div class="flex wrap between">
      <div class="seg" data-presets role="group" aria-label="ช่วงวัน">${presetBtns(st)}</div>
      <div class="form-grid two grow ${st.preset === 'custom' ? '' : 'hidden'}" data-custom style="max-width:420px">
        <input type="date" class="input" data-from value="${esc(st.from)}" aria-label="ตั้งแต่วันที่">
        <input type="date" class="input" data-to value="${esc(st.to)}" aria-label="ถึงวันที่">
      </div>
    </div>
    <div class="toolbar" style="margin-bottom:0">
      <label class="search">${icon('search')}<input class="input" data-search placeholder="ค้นหา พนักงาน / ลูกค้า / สถานที่" value="${esc(st.q)}" aria-label="ค้นหา"></label>
      <button class="btn btn-secondary hide-desktop" data-act="filters" aria-expanded="${st.showFilters}">${icon('filter', 'sm')} ตัวกรอง<span data-fcount></span></button>
    </div>
    <div data-filters class="${st.showFilters ? '' : 'hide-mobile'}"></div>
    <div class="chips" data-chips></div>
  </div>
  <div class="mt-16" data-results>${skeleton(6)}</div>`;
  if (st.rows) { paintFilters(ctx, st); paintResults(ctx, st); }
}
const presetBtns = (st) => PRESETS.map(([k, l]) => `<button class="${st.preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`).join('');
const rangeLabel = (st) => (st.from && st.to ? `${fmtDate(st.from)} – ${fmtDate(st.to)}` : 'เลือกช่วงวัน');

/** ตัวเลือกแผนก/หมวด/พนักงาน มาจากข้อมูลช่วงนี้ */
function paintFilters(ctx, st) {
  const box = ctx.el.querySelector('[data-filters]'); if (!box) return;
  const rows = st.rows || [];
  const uniq = (f) => [...new Set(rows.map(f).filter(Boolean))];
  const depts = uniq((r) => r.department).sort();
  const cats = uniq((r) => String(r.category || '').toUpperCase()).sort((a, b) => catName(a).localeCompare(catName(b), 'th'));
  const staff = [...new Map(rows.map((r) => [String(r.staff_email).toLowerCase(), r.staff_name])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'th'));
  if (st.dept && !depts.includes(st.dept)) st.dept = '';
  if (st.cat && !cats.includes(st.cat)) st.cat = '';
  if (st.staff && !staff.some(([e]) => e === st.staff)) st.staff = '';
  const sel = (f, label, opts) => `<select class="input" data-f="${f}" aria-label="${label}" style="flex:1 1 160px;width:auto;min-height:40px">
    <option value="">${label}: ทั้งหมด</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${st[f] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  box.innerHTML = `<div class="flex wrap">${sel('dept', 'แผนก', depts.map((d) => [d, d]))}${sel('cat', 'หมวด', cats.map((c) => [c, catName(c)]))}${sel('staff', 'พนักงาน', staff)}</div>`;
}

function filtered(st, { ignoreStatus = false } = {}) {
  return (st.rows || []).filter((r) => {
    if (!ignoreStatus && st.status !== 'all' && r.status !== st.status) return false;
    if (st.dept && r.department !== st.dept) return false;
    if (st.cat && String(r.category).toUpperCase() !== st.cat) return false;
    if (st.staff && String(r.staff_email).toLowerCase() !== st.staff) return false;
    if (st.q && ![r.staff_name, r.staff_email, r.customer, r.venue, r.occasion, r.origin, r.destination, r.job_no, catName(r.category)]
      .some((x) => String(x || '').toLowerCase().includes(st.q))) return false;
    return true;
  });
}
const shownAmt = (r) => Number(r.status === 'PreApprove' && r.preapprove_budget ? r.preapprove_budget : r.amount) || 0;
const counts = (r) => r.status !== 'PreApprove' && r.status !== 'Finalized';   // งบล่วงหน้า/แถวงบที่ส่งบิลแล้ว ไม่นับยอด (กันนับซ้ำ)

function paintResults(ctx, st) {
  const box = ctx.el.querySelector('[data-results]'); if (!box) return;
  const nf = [st.dept, st.cat, st.staff].filter(Boolean).length;
  const fc = ctx.el.querySelector('[data-fcount]'); if (fc) fc.textContent = nf ? ` (${nf})` : '';
  const chips = ctx.el.querySelector('[data-chips]');
  if (!st.rows) { box.innerHTML = skeleton(6); if (chips) chips.innerHTML = ''; return; }

  const base = filtered(st, { ignoreStatus: true });
  const n = (s) => (s === 'all' ? base.length : base.filter((r) => r.status === s).length);
  if (chips) chips.innerHTML = STATUSES.filter(([s]) => s === 'all' || s === st.status || n(s))
    .map(([s, l]) => `<button class="chip ${st.status === s ? 'on' : ''}" data-status="${s}">${l} <span class="n">${n(s)}</span></button>`).join('');

  const rows = filtered(st);
  const sum = (list) => list.filter(counts).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const pend = base.filter((r) => r.status === 'Pending'), appr = base.filter((r) => r.status === 'Approved');
  const stats = `<div class="grid-4 mb-16">
    <div class="stat"><div class="l">${icon('list', 'sm')} จำนวน</div><div class="v">${money(rows.length, 0)}</div><div class="d">รายการ</div></div>
    <div class="stat brand"><div class="l">${icon('banknote', 'sm')} ยอดรวม</div><div class="v">${compact(sum(rows))}</div><div class="d">${money(sum(rows))} บาท</div></div>
    <div class="stat warn"><div class="l">${icon('clock', 'sm')} รออนุมัติ</div><div class="v">${pend.length}</div><div class="d">${money(sum(pend), 0)} บาท</div></div>
    <div class="stat ok"><div class="l">${icon('check-circle', 'sm')} อนุมัติแล้ว</div><div class="v">${compact(sum(appr))}</div><div class="d">${appr.length} รายการ</div></div>
  </div>`;
  if (!rows.length) {
    box.innerHTML = stats + `<div class="card">${empty({ ic: 'search', title: st.rows.length ? 'ไม่พบรายการตามตัวกรอง' : 'ไม่มีคำขอในช่วงนี้', sub: st.rows.length ? 'ลองล้างตัวกรองหรือเปลี่ยนคำค้น' : 'ลองเลือกช่วงวันอื่น',
      action: st.rows.length ? `<button class="btn btn-secondary" data-act="reset">${icon('rotate-ccw', 'sm')} ล้างตัวกรอง</button>` : '' })}</div>`;
    return;
  }
  const page = rows.slice(0, st.limit);
  const more = rows.length > page.length ? `<div class="text-center mt-12"><button class="btn btn-secondary" data-act="more">แสดงเพิ่ม (${rows.length - page.length} รายการ)</button></div>` : '';
  box.innerHTML = stats + `
    <div class="table-wrap hide-mobile"><table class="tbl">
      <thead><tr><th>วันที่</th><th>พนักงาน</th><th>หมวด</th><th>รายละเอียด</th><th class="r">จำนวนเงิน</th><th>สถานะ</th></tr></thead>
      <tbody>${page.map((r) => {
        const desc = r.customer || r.venue || (r.origin && r.destination ? `${r.origin} → ${r.destination}` : '') || r.occasion || '';
        const files = (r.receipt_paths || []).length;
        return `<tr data-id="${esc(r.id)}" style="cursor:pointer">
          <td class="nowrap">${fmtDate(r.expense_date)}</td>
          <td><div class="bold">${esc(r.staff_name)}</div><div class="text-xs muted">${esc(r.department || '')}</div></td>
          <td class="nowrap">${esc(catName(r.category))}</td>
          <td><div class="ellipsis" style="max-width:280px">${esc(desc) || '<span class="faint">-</span>'}</div>${r.mileage_km ? `<div class="text-xs muted">${money(r.mileage_km, 0)} กม.</div>` : ''}${files ? `<div class="text-xs muted">${icon('paperclip', 'sm')} ${files} ไฟล์</div>` : ''}</td>
          <td class="r"><span class="amount ${counts(r) ? '' : 'muted'}">${money(shownAmt(r))}</span>${r.status === 'PreApprove' ? '<div class="text-xs muted">งบที่ขอ</div>' : ''}</td>
          <td>${requestBadge(r)}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td colspan="4">รวม ${money(rows.length, 0)} รายการ${rows.length > page.length ? ` (แสดง ${page.length})` : ''}</td><td class="r">${money(sum(rows))}</td><td></td></tr></tfoot>
    </table></div>
    <div class="card hide-desktop"><div class="list">${page.map((r) => requestRow(r, { who: true })).join('')}</div>
      <div class="card-foot flex between"><span class="text-sm muted">รวม ${money(rows.length, 0)} รายการ</span><span class="amount">${money(sum(rows))} บาท</span></div></div>
    ${more}`;
}

// ─────────────── รายละเอียด ───────────────
function openDetail(st, id) {
  const r = (st.rows || []).find((x) => x.id === id); if (!r) return;
  const pre = r.status === 'PreApprove';
  const paths = r.receipt_paths || [];
  const rows = [
    ['พนักงาน', `${r.staff_name}${r.department ? ' · ' + r.department : ''}`], ['อีเมล', r.staff_email],
    ['หมวด', catName(r.category)], ['วันที่ใช้จ่าย', fmtDate(r.expense_date)],
    [pre ? 'งบที่ขอ' : 'จำนวนเงิน', raw(`<span class="amount">${money(shownAmt(r))}</span> บาท`)],
    !pre && Number(r.preapprove_budget) > 0 ? ['งบที่อนุมัติไว้', `${money(r.preapprove_budget)} บาท`] : null,
    r.mileage_km ? ['ระยะทาง', `${money(r.mileage_km, 0)} กม.`] : null,
    r.origin || r.destination ? ['เส้นทาง', `${r.origin || '-'} → ${r.destination || '-'}`] : null,
    r.customer ? ['ลูกค้า', r.customer] : null, r.customer_contact ? ['Contact name', r.customer_contact] : null,
    r.venue ? ['สถานที่', r.venue] : null, r.occasion ? [(/^(ENT|GOLF)$/i.test(r.category) ? 'Purpose of entertainment' : 'Purpose of visiting'), r.occasion] : null, r.attendees ? ['ผู้เข้าร่วม', r.attendees] : null,
    r.job_no ? ['Job No.', r.job_no] : null, r.remark ? ['หมายเหตุ', String(r.remark).split(' sig:')[0]] : null,
    r.manager_email ? ['หัวหน้า', `${r.manager_email}${r.manager_status ? ' · ' + ({ Approved: 'อนุมัติ', Rejected: 'ไม่อนุมัติ', Pending: 'รอ', Bypassed: 'ข้ามขั้น' }[r.manager_status] || r.manager_status) : ''}`] : null,
    r.manager_remark ? ['ความเห็นหัวหน้า', r.manager_remark] : null,
    r.approved_by ? ['อนุมัติโดย', `${r.approved_by}${r.approved_at ? ' · ' + fmtDateTime(r.approved_at) : ''}`] : null,
    ['ส่งเมื่อ', fmtDateTime(r.created_at)], ['รหัส', r.id],
  ].filter(Boolean);
  sheet({
    title: catName(r.category),
    body: `<div class="flex between mb-12"><span class="flex">${catIcon(r.category)}<span class="callout-amount"><span class="v">${money(shownAmt(r))}</span><span class="muted">บาท</span></span></span>${requestBadge(r)}</div>
      ${html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`}
      <div class="divider"></div><div class="label mb-8">${icon('paperclip', 'sm')} ใบเสร็จ (${paths.length})</div>
      ${paths.length ? thumbs(paths) : '<p class="hint">ไม่มีไฟล์แนบ</p>'}`,
    onMount: (el) => hydrateThumbs(el),
  });
}

// ─────────────── ปุ่ม ───────────────
async function act(ctx, st, t) {
  const a = t.dataset.act;
  if (a === 'more') { st.limit += PAGE; paintResults(ctx, st); return; }
  if (a === 'filters') {
    st.showFilters = !st.showFilters;
    ctx.el.querySelector('[data-filters]').classList.toggle('hide-mobile', !st.showFilters);
    t.setAttribute('aria-expanded', String(st.showFilters));
    return;
  }
  if (a === 'reset') {
    Object.assign(st, { status: 'all', dept: '', cat: '', staff: '', q: '', limit: PAGE });
    const s = ctx.el.querySelector('[data-search]'); if (s) s.value = '';
    paintFilters(ctx, st); paintResults(ctx, st); return;
  }
  if (a !== 'xls') return;
  // Excel รายการคำขอ ทำได้ทีละคน (ฝั่ง DB รับพนักงานคนเดียว) → ยังไม่เลือกคน ให้เลือกก่อน
  if (st.staff) { await downloadList(st, st.staff, t); return; }
  const people = new Map();
  filtered(st).forEach((r) => {
    const k = String(r.staff_email).toLowerCase();
    const p = people.get(k) || { name: r.staff_name, dept: r.department, n: 0, amt: 0 };
    p.n++; if (counts(r)) p.amt += Number(r.amount) || 0; people.set(k, p);
  });
  if (!people.size) { toast('ไม่มีรายการให้ดาวน์โหลด', 'bad'); return; }
  const list = [...people.entries()].sort((x, y) => String(x[1].name).localeCompare(String(y[1].name), 'th'));
  sheet({
    title: 'ดาวน์โหลด Excel รายการคำขอ',
    body: `<p class="muted text-sm mb-12">ไฟล์ทำได้ทีละคน · ${esc(rangeLabel(st))}${st.status !== 'all' ? ' · ' + esc(STATUSES.find((s) => s[0] === st.status)[1]) : ''} — เลือกพนักงาน</p>
      <div class="card"><div class="list">${list.map(([e, p]) => `<button class="row" data-pick="${esc(e)}"><span class="row-icon">${icon('user')}</span>
        <div class="row-main"><div class="row-title">${esc(p.name)}</div><div class="row-sub">${esc(p.dept || '')} · ${p.n} รายการ</div></div>
        <div class="row-end"><span class="amount">${money(p.amt)}</span></div>${icon('download', 'sm')}</button>`).join('')}</div></div>`,
    onMount: (el) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) downloadList(st, b.dataset.pick, b); }),
  });
}

async function downloadList(st, email, btn) {
  try {
    const meta = await withBtn(btn, () => api.excel({ type: 'request_list', staffEmail: email, dateFrom: st.from, dateTo: st.to, status: st.status === 'all' ? '' : st.status }));
    toast(`ดาวน์โหลดแล้ว · ${meta.staffName || ''} ${meta.count ?? ''} รายการ`);
  } catch (e) { toastError(e); }
}
