// ทีมของฉัน (หัวหน้า / GM) — ยอดรายคนต่อเดือน · ดูบิลรายคน · ขอเบิกแทน · ออกรหัสชั่วคราวให้ลูกทีม
import { api, auth, money, compact, fmtDate, fmtDateTime, esc, initials, monthLabel, catName, todayYMD } from '../core.js?v=10.0.15';
import { icon, catIcon, toast, toastError, sheet, confirmBox, withBtn, busy, empty, skeleton, requestRow, thumbs, hydrateThumbs, monthNav, shiftMonth, bars, debounce, on } from '../ui.js?v=10.0.15';

const STAGE = { waiting: ['รออนุมัติ', 'b-pending'], approved: ['อนุมัติแล้ว', 'b-approved'], paid: ['โอนแล้ว', 'b-paid'], rejected: ['ไม่อนุมัติ', 'b-rejected'] };
const pad2 = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const clampDay = (y, m, d) => new Date(y, m - 1, Math.min(d, new Date(y, m, 0).getDate()));
/** รอบเบิกของเดือน m = (วันตัดเดือนก่อน + 1) → วันตัดเดือน m · วันตัด ≥ 31 = ทั้งเดือน */
function periodOf(y, m, cutoff) {
  if (!cutoff || cutoff >= 31) return [ymdOf(new Date(y, m - 1, 1)), ymdOf(new Date(y, m, 0))];
  const s = clampDay(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, cutoff); s.setDate(s.getDate() + 1);
  return [ymdOf(s), ymdOf(clampDay(y, m, cutoff))];
}

export async function render(ctx) {
  const { el } = ctx;
  const now = new Date();
  const qm = /^(\d{4})-(\d{2})$/.exec(ctx.query.ym || '');
  const st = { y: qm ? +qm[1] : now.getFullYear(), m: qm ? +qm[2] : now.getMonth() + 1, team: null, vis: null, cutoff: 31 };
  try { st.cutoff = Number((await api.rpc('get_period_info', { p_year: st.y, p_month: st.m }, { ttl: 3600 })).cutoffDay) || 31; } catch {}
  // เลยวันตัดแล้ว = อยู่ในรอบของเดือนถัดไป
  if (!qm && st.cutoff < 31 && now.getDate() > st.cutoff) [st.y, st.m] = shiftMonth(st.y, st.m, 1);

  const paintNow = () => { if (ctx.alive() && st.team) paint(ctx, st); };
  const loadMonth = () => {
    const key = `${st.y}-${st.m}`;
    return api.load('get_visible_requests', { p_year: st.y, p_month: st.m }, (d) => {
      if (`${st.y}-${st.m}` !== key) return;          // เปลี่ยนเดือนไปแล้ว
      st.vis = d; paintNow();
    });
  };
  st.reload = () => Promise.all([api.load('get_my_team', {}, (d) => { st.team = d; paintNow(); }), loadMonth()]).catch(toastError);
  await Promise.all([api.load('get_my_team', {}, (d) => { st.team = d; paintNow(); }), loadMonth()]);

  const offs = [
    on(el, 'click', '[data-mprev],[data-mnext]', (e, t) => {
      [st.y, st.m] = shiftMonth(st.y, st.m, t.hasAttribute('data-mprev') ? -1 : 1);
      st.vis = null; paintNow();
      loadMonth().catch((err) => { toastError(err); });
    }),
    on(el, 'click', '[data-member]', (e, t) => openMember(ctx, st, t.dataset.member)),
  ];
  return () => offs.forEach((f) => f());
}

// ─────────────── สรุปรายคน ───────────────
function monthStats(st) {
  const [d1, d2] = periodOf(st.y, st.m, st.cutoff);
  const by = new Map();
  (st.team.team || []).forEach((p) => by.set(p.email, { p, total: 0, approved: 0, pending: 0, pendingAmt: 0, count: 0, cats: new Map() }));
  const cats = new Map();
  (st.vis?.items || []).forEach((r) => {
    const s = by.get(String(r.staff_email).toLowerCase()); if (!s) return;
    const d = r.expense_date || String(r.created_at || '').slice(0, 10);
    if (!(d >= d1 && d <= d2)) return;                // ข้อมูลมาเผื่อ 45 วัน — เอาเฉพาะรอบนี้
    const amt = Number(r.amount) || 0;
    if (r.status === 'PreApprove' && r.preapprove_status === 'Pending') { s.pending++; s.count++; return; }
    if (r.status === 'Pending') { s.pending++; s.pendingAmt += amt; s.total += amt; s.count++; }
    if (r.status === 'Approved') {
      s.approved += amt; s.total += amt; s.count++;
      const k = String(r.category).toUpperCase();
      cats.set(k, (cats.get(k) || 0) + amt);
    }
  });
  return { rows: [...by.values()], cats };
}

function paint(ctx, st) {
  const t = st.team, team = t.team || [];
  const role = ctx.profile.role || {};
  const [p1, p2] = periodOf(st.y, st.m, st.cutoff);
  const head = `<div class="page-head"><div><h1>ทีมของฉัน</h1><div class="sub">${esc(t.teamName || t.manager || '')}${team.length ? ` · ${team.length} คน` : ''} · รอบ ${fmtDate(p1, { year: false })} – ${fmtDate(p2)}</div></div>
    <div class="actions">${monthNav(st.y, st.m)}</div></div>`;
  if (!team.length) {
    ctx.el.innerHTML = head + `<div class="card">${empty({ ic: 'users', title: 'ยังไม่มีลูกทีม', sub: 'พนักงานที่ระบุคุณเป็นหัวหน้าจะแสดงที่นี่' })}</div>`;
    return;
  }
  const noLogin = team.filter((p) => !p.hasPassword);
  if (!st.vis) {
    ctx.el.innerHTML = head + skeleton(Math.min(6, team.length + 1));
    return;
  }
  const { rows, cats } = monthStats(st);
  rows.sort((a, b) => b.total - a.total || String(a.p.name).localeCompare(String(b.p.name)));
  const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
  const active = rows.filter((x) => x.count).length;

  ctx.el.innerHTML = head + `
  <div class="stack">
    <div class="grid-4">
      <div class="stat"><div class="l">${icon('users', 'sm')} สมาชิก</div><div class="v">${team.length}</div><div class="d">เบิกรอบนี้ ${active} คน</div></div>
      <div class="stat ok"><div class="l">${icon('check-circle', 'sm')} อนุมัติแล้ว</div><div class="v">${compact(sum('approved'))}</div><div class="d">บาท · ${monthLabel(st.y, st.m)}</div></div>
      <div class="stat warn"><div class="l">${icon('clock', 'sm')} รออนุมัติ</div><div class="v">${sum('pending')}</div><div class="d">${money(sum('pendingAmt'), 0)} บาท</div></div>
      <div class="stat"><div class="l">${icon('chart', 'sm')} เฉลี่ย/คน</div><div class="v">${compact(active ? sum('total') / active : 0)}</div><div class="d">ของคนที่เบิก</div></div>
    </div>
    ${noLogin.length && !role.isViewer ? `<div class="alert warn">${icon('key')}<div><b>${noLogin.length} คนยังไม่เคยเข้าระบบ</b> — ${esc(noLogin.map((p) => p.name).join(', '))}<br>
      <span class="text-sm">แตะชื่อ แล้วกด “ออกรหัสชั่วคราว” เพื่อให้พนักงานตั้งรหัสผ่านเอง</span></div></div>` : ''}
    <div class="split">
      <div class="card"><div class="card-head"><h3>${icon('users')} สมาชิก · ${monthLabel(st.y, st.m)}</h3><span class="text-sm muted">ยอดรวม ${money(sum('total'), 0)}</span></div>
        <div class="list">${memberList(rows, t.manager)}</div></div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('trending')} อันดับยอดเบิก</h3></div>
          <div class="pad">${sum('total') ? bars(rows.filter((x) => x.total).map((x) => ({ label: x.p.name, value: x.total }))) : '<p class="muted text-sm">ยังไม่มีรายการในรอบนี้</p>'}</div></div>
        ${cats.size ? `<div class="card"><div class="card-head"><h3>${icon('pie')} ตามหมวด (อนุมัติแล้ว)</h3></div>
          <div class="pad">${bars([...cats.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: catName(k), value: v })))}</div></div>` : ''}
      </div>
    </div>
  </div>`;
}

/** จัดกลุ่ม: ขึ้นตรงกับฉันก่อน แล้วตามด้วยทีมของหัวหน้าทีมย่อยแต่ละคน */
function memberList(rows, me) {
  if (!rows.some((x) => x.p.direct === false)) return rows.map((x) => memberRow(x)).join('');
  const groups = new Map();
  rows.forEach((x) => { const k = x.p.direct === false ? String(x.p.managerName || '-') : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'th')));
  return keys.map((k) => `<div class="team-group">${k === '' ? `ขึ้นตรงกับ${esc(me || 'คุณ')}` : `ทีมของ ${esc(k)}`} · ${groups.get(k).length} คน</div>`
    + groups.get(k).map((x) => memberRow(x)).join('')).join('');
}

function memberRow(x) {
  const p = x.p;
  return `<button class="row" data-member="${esc(p.email)}"><span class="avatar">${esc(initials(p.name))}</span>
    <div class="row-main"><div class="row-title">${esc(p.name)}${p.fullName && p.fullName !== p.name ? ` <span class="muted text-sm">· ${esc(p.fullName)}</span>` : ''}</div>
      <div class="row-sub">${esc(p.position || p.department || '')}${x.count ? ` · ${x.count} รายการ` : ' · ยังไม่มีรายการ'}${!p.hasPassword ? ' · <span class="warn-text">ยังไม่เคยเข้าระบบ</span>' : ''}</div></div>
    <div class="row-end"><span class="amount">${money(x.approved)}</span>${x.pending ? `<span class="badge b-pending">รอ ${x.pending}</span>` : x.approved ? '<span class="badge b-approved plain">อนุมัติแล้ว</span>' : ''}</div>
  </button>`;
}

// ─────────────── รายละเอียดลูกทีม ───────────────
function openMember(ctx, st, email) {
  const p = (st.team.team || []).find((x) => x.email === email); if (!p) return;
  const role = ctx.profile.role || {};
  const ym = `${st.y}-${pad2(st.m)}`;
  const data = { claim: null, exps: null };
  const s = sheet({
    title: p.name, wide: true,
    body: `<div class="flex gap-12 mb-16"><span class="avatar lg">${esc(initials(p.name))}</span><div class="grow">
        <div class="bold text-lg">${esc(p.fullName || p.name)}</div><div class="muted text-sm">${esc(p.email)}</div>
        <div class="flex wrap mt-4">${p.position ? `<span class="badge plain">${esc(p.position)}</span>` : ''}${p.department ? `<span class="badge plain">${esc(p.department)}</span>` : ''}
          ${p.hasPassword ? '<span class="badge b-ok">เข้าระบบแล้ว</span>' : '<span class="badge b-pending">ยังไม่เคยเข้าระบบ</span>'}</div></div></div>
      ${role.isViewer ? '' : `<div class="alert ${p.hasPassword ? 'neutral' : 'warn'} mb-16">${icon('key')}<div class="grow"><div class="text-sm">${p.hasPassword ? 'ลืมรหัสผ่าน? ออกรหัสชั่วคราวให้พนักงานตั้งรหัสใหม่เอง' : 'ยังไม่เคยเข้าระบบ — ออกรหัสชั่วคราวให้พนักงานใช้ตั้งรหัสผ่านครั้งแรก'}</div>
        <button class="btn btn-secondary btn-sm mt-8" data-code>${icon('key', 'sm')} ออกรหัสชั่วคราว</button></div></div>`}
      <div data-claims>${skeleton(3)}</div>`,
    foot: `<button class="btn btn-secondary" data-xls data-busy="กำลังสร้างไฟล์…" disabled>${icon('download', 'sm')} ดาวน์โหลดฟอร์ม</button>
      ${role.isViewer ? '' : `<button class="btn btn-primary hidden" data-req>${icon('send', 'sm')} ขอเบิกแทน</button>`}`,
    onMount: (el, close) => {
      el.querySelector('[data-code]')?.addEventListener('click', (e) => issueCode(p, e.currentTarget));
      el.querySelector('[data-xls]').addEventListener('click', (e) => downloadForm(st, p, data.claim, e.currentTarget));
      el.querySelector('[data-req]')?.addEventListener('click', () => requestFor(ctx, st, p, () => { close(); st.reload(); }));
      el.addEventListener('click', (e) => {
        if (e.target.closest('a[href^="#/export/"]')) close();
        const row = e.target.closest('.row[data-id]');
        if (row && data.claim) { const r = data.claim.items.find((x) => x.id === row.dataset.id); if (r) itemSheet(r); }
      });
    },
  });
  Promise.all([
    api.rpc('get_staff_claim_items', { p_staff_email: p.email, p_ym: ym }),
    api.rpc('get_my_export_requests', { p_staff_email: p.email }).catch(() => []),
  ]).then(([claim, exps]) => {
    if (!s.el.isConnected) return;
    data.claim = claim; data.exps = exps || [];
    s.el.querySelector('[data-claims]').innerHTML = claimsHtml(st, claim, data.exps);
    s.el.querySelector('[data-xls]').disabled = false;
    const hasApproved = (claim.items || []).some((r) => r.status === 'Approved');
    const req = s.el.querySelector('[data-req]');
    if (req && claim.source === 'month' && hasApproved) req.classList.remove('hidden');
  }).catch((e) => {
    if (s.el.isConnected) s.el.querySelector('[data-claims]').innerHTML = `<div class="alert bad">${icon('alert')}<div>${esc(e.message)}</div></div>`;
  });
}

function claimsHtml(st, c, exps) {
  const items = c.items || [], auto = c.autoAllowance || [];
  const exp = c.exportId ? exps.find((e) => e.id === c.exportId) : null;
  const [stTxt, stCls] = exp ? STAGE[exp.stage] || STAGE.waiting : ['', ''];
  return `
    <div class="grid-3 collapse mb-12">
      <div class="stat ok"><div class="l">อนุมัติแล้ว</div><div class="v">${money(c.approvedTotal, 0)}</div><div class="d">รวมค่าเหมาจ่าย</div></div>
      <div class="stat warn"><div class="l">รออนุมัติ</div><div class="v">${money(c.pendingTotal, 0)}</div><div class="d">${items.filter((r) => r.status === 'Pending').length} รายการ</div></div>
      <div class="stat"><div class="l">ช่วงรอบ</div><div class="v" style="font-size:16px">${fmtDate(c.periodStart, { year: false })} – ${fmtDate(c.periodEnd)}</div><div class="d">${c.source === 'export' ? 'ตามใบขอเบิกรายเดือน' : 'รอบที่ยังไม่ได้ขอเบิก'}</div></div>
    </div>
    ${exp ? `<a class="alert ${exp.stage === 'waiting' ? 'warn' : 'ok'} mb-12" href="#/export/${encodeURIComponent(exp.id)}" style="color:inherit">${icon('file')}<div class="grow">
        ขอเบิกรายเดือนแล้ว · <b>${money(exp.total_amount)}</b> บาท · <span class="badge ${stCls}">${stTxt}</span></div>${icon('chevron-right', 'sm')}</a>` : ''}
    <div class="card"><div class="card-head"><h3>${icon('receipt')} รายการ ${monthLabel(st.y, st.m)}</h3><span class="text-sm muted">${items.length + auto.length} รายการ</span></div>
      ${items.length || auto.length ? `<div class="list">${items.map((r) => requestRow(r)).join('')}
        ${auto.map((a) => `<div class="row">${catIcon(a.category)}<div class="row-main"><div class="row-title">${esc(catName(a.category))}</div><div class="row-sub">ค่าเหมาจ่ายอัตโนมัติ</div></div>
          <div class="row-end"><span class="amount">${money(a.amount)}</span><span class="badge b-info plain">อัตโนมัติ</span></div></div>`).join('')}</div>`
        : empty({ ic: 'receipt', title: 'ยังไม่มีรายการในรอบนี้' })}</div>
    <div class="card mt-12"><div class="card-head"><h3>${icon('calendar')} ขอเบิกรายเดือน</h3></div>
      ${exps.length ? `<div class="list">${exps.slice(0, 4).map((e) => {
        const [t, cl] = STAGE[e.stage] || STAGE.waiting;
        return `<a class="row" href="#/export/${encodeURIComponent(e.id)}"><div class="row-main"><div class="row-title">รอบ ${monthLabel(e.year, e.month)}</div>
          <div class="row-sub">${e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)} · ` : ''}${e.item_count} รายการ${e.paid_at ? ' · โอน ' + fmtDate(e.paid_at) : ''}</div></div>
          <div class="row-end"><span class="amount">${money(e.total_amount)}</span><span class="badge ${cl}">${t}</span></div></a>`;
      }).join('')}</div>` : '<p class="pad hint">ยังไม่เคยขอเบิกรายเดือน</p>'}</div>`;
}

function itemSheet(r) {
  const paths = r.receipt_paths || [];
  const kv = [['วันที่', fmtDate(r.expense_date)], ['จำนวนเงิน', money(r.amount) + ' บาท'], r.mileage_km ? ['ระยะทาง', money(r.mileage_km, 0) + ' กม.'] : null,
    r.origin || r.destination ? ['เส้นทาง', `${r.origin || '-'} → ${r.destination || '-'}`] : null, r.customer ? ['ลูกค้า', r.customer] : null,
    r.venue ? ['สถานที่', r.venue] : null, r.occasion ? [(/^(ENT|GOLF)$/i.test(r.category) ? 'Purpose of entertainment' : 'Purpose of visiting'), r.occasion] : null, r.manager_remark ? ['ความเห็นหัวหน้า', r.manager_remark] : null]
    .filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  sheet({
    title: catName(r.category),
    body: `<dl class="kv">${kv}</dl><div class="divider"></div>${paths.length ? thumbs(paths) : '<p class="hint">ไม่มีไฟล์แนบ</p>'}`,
    onMount: (el) => hydrateThumbs(el),
  });
}

// ─────────────── ปุ่ม ───────────────
async function downloadForm(st, p, c, btn) {
  if (!c) return;
  const final = c.exportId && c.exportStatus === 'Approved';
  const body = final ? { type: 'staff_form', kind: 'final', exportId: c.exportId }
    : { type: 'staff_form', kind: 'draft', staffEmail: p.email, year: st.y, month: st.m, periodStart: c.periodStart, periodEnd: c.periodEnd };
  try {
    const meta = await withBtn(btn, () => api.excel(body));
    toast(`ดาวน์โหลดแล้ว · ${meta.itemCount ?? ''} รายการ · ${money(meta.totalAmount)} บาท${final ? '' : ' (ฉบับตรวจสอบ)'}`);
  } catch (e) { toastError(e); }
}

/** หัวหน้าขอเบิกรายเดือนแทนลูกทีม (ไม่ต้องพิมพ์วันที่เอง — เลือกจากปฏิทิน + ดูยอดก่อนส่ง) */
async function requestFor(ctx, st, p, after) {
  let info;
  try { info = await busy('กำลังโหลดรอบ…', () => api.rpc('get_period_info', { p_year: st.y, p_month: st.m, p_staff_email: p.email })); }
  catch (e) { toastError(e); return; }
  const v = { start: info.expectedStart || info.periodStart, end: info.suggestedEnd };
  const s = sheet({
    title: `ขอเบิกรายเดือนแทน ${p.name}`,
    body: `<p class="muted text-sm mb-12">รอบ ${monthLabel(st.y, st.m, true)} · ตัดรอบ${esc(info.cutoffLabel)}${info.hasSettled ? ` · ปิดรอบล่าสุดถึง ${esc(info.lastSettledTH)}` : ''}</p>
      <div class="form-grid two">
        <div class="field"><label for="rs">เริ่ม</label><input id="rs" type="date" class="input" value="${esc(v.start)}" max="${esc(info.maxEnd || todayYMD())}"></div>
        <div class="field"><label for="re">สิ้นสุด</label><input id="re" type="date" class="input" value="${esc(v.end)}" max="${esc(info.maxEnd || todayYMD())}"></div>
      </div>
      <div class="mt-12" data-pv><span class="spin"></span></div>`,
    foot: `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-go disabled>${icon('send', 'sm')} ส่งขออนุมัติ</button>`,
    onMount: (el) => {
      const pv = el.querySelector('[data-pv]'), go = el.querySelector('[data-go]');
      const preview = debounce(async () => {
        v.start = el.querySelector('#rs').value; v.end = el.querySelector('#re').value;
        go.disabled = true;
        if (!v.start || !v.end || v.end < v.start) { pv.innerHTML = `<div class="alert bad">${icon('alert')}<div>ช่วงวันไม่ถูกต้อง</div></div>`; return; }
        try {
          const r = await api.rpc('preview_period', { p_staff_email: p.email, p_start: v.start, p_end: v.end }, { quiet: true });
          if (!el.isConnected) return;
          pv.innerHTML = `<div class="alert ${r.count ? 'neutral' : 'bad'}">${icon('calculator')}<div>${esc(r.periodStartTH)} – ${esc(r.periodEndTH)}<br>
            <b>${r.count}</b> รายการ · <b class="amount">${money(r.total)}</b> บาท</div></div>
            ${(r.warnings || []).map((w) => `<div class="alert warn mt-8">${icon('alert')}<div>${esc(w)}</div></div>`).join('')}`;
          go.disabled = !r.count;
        } catch (e) { pv.innerHTML = `<div class="alert bad">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
      }, 300);
      el.querySelectorAll('input[type=date]').forEach((i) => i.addEventListener('change', preview));
      preview();
      go.onclick = () => withBtn(go, async () => {
        try {
          const r = await api.rpc('request_export_approval', { p_staff_email: p.email, p_year: st.y, p_month: st.m, p_start: v.start, p_end: v.end });
          toast(r.auto ? 'อนุมัติอัตโนมัติแล้ว — ดาวน์โหลดฟอร์มได้เลย' : 'ส่งขออนุมัติแล้ว — แจ้งผู้อนุมัติแล้ว');
          if ((r.warnings || []).length) toast(r.warnings[0], 'info');
          ctx.refreshBadges();
          s.close(); after();
        } catch (e) { toastError(e); }
      });
    },
  });
}

/** ออกรหัสชั่วคราว 6 หลัก — รหัสผ่านเดิมของพนักงานจะใช้ไม่ได้ทันที */
export async function issueCode(p, btn) {
  const ok = await confirmBox({
    title: 'ออกรหัสชั่วคราว',
    message: `ให้ ${p.fullName || p.name}\n\nรหัสผ่านเดิมของพนักงานจะใช้ไม่ได้ทันที — พนักงานต้องใช้รหัสนี้ตั้งรหัสผ่านใหม่ภายใน 24 ชม.`,
    ok: 'ออกรหัส',
  });
  if (!ok) return;
  try {
    const out = await withBtn(btn, () => auth.issueCode(p.email));
    const hours = Number(out.expiresInHours) || 24;
    const exp = new Date(Date.now() + hours * 3600e3);
    const code = String(out.code || '');
    sheet({
      title: 'รหัสชั่วคราว',
      body: `<p class="muted text-sm text-center">สำหรับ <b>${esc(out.name || p.name)}</b> · ${esc(p.email)}</p>
        <div class="callout-amount mt-12" style="justify-content:center"><span class="v" style="font-size:40px;letter-spacing:.25em;padding-left:.25em">${esc(code)}</span></div>
        <p class="text-center hint mt-4">ใช้ได้ถึง ${fmtDateTime(exp)} (${hours} ชม.) · ใช้ได้ครั้งเดียว</p>
        <button class="btn btn-secondary btn-block mt-16" data-copy>${icon('copy', 'sm')} คัดลอกรหัส</button>
        <div class="alert neutral mt-16">${icon('info')}<div class="text-sm"><b>บอกพนักงานให้:</b><br>
          1. เปิดแอป EXION แล้วกรอกอีเมล ${esc(p.email)}<br>
          2. กด “ลืมรหัสผ่าน” → กรอกรหัสชั่วคราว (ถ้าเป็นครั้งแรกจะเข้าหน้าตั้งรหัสเลย)<br>
          3. กรอกรหัส 6 หลักนี้ แล้วตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัว มีตัวเลข)</div></div>
        <p class="hint mt-12">ส่งรหัสให้พนักงานโดยตรงเท่านั้น — อย่าโพสต์ในกลุ่ม</p>`,
      foot: `<button class="btn btn-primary" data-x>เสร็จแล้ว</button>`,
      dismissable: false,
      onMount: (el) => {
        el.querySelector('[data-copy]').onclick = async () => {
          try { await navigator.clipboard.writeText(code); toast('คัดลอกรหัสแล้ว'); }
          catch { toast('คัดลอกไม่ได้ — จดรหัสบนจอแทน', 'bad'); }
        };
      },
    });
  } catch (e) { toastError(e); }
}
