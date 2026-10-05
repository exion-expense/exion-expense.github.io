// สรุป & Excel — วิเคราะห์ยอดเบิกตามสิทธิ์ (ตัวเอง / ทีม / ทั้งบริษัท ฝั่งเซิร์ฟเวอร์ตัดสิน) + ดาวน์โหลด Excel
import { api, money, compact, fmtDate, esc, monthLabel, catName, ymd } from '../core.js';
import { icon, requestRow, toast, toastError, withBtn, bars, donut, PALETTE, monthNav, shiftMonth, empty, errorBox, on } from '../ui.js';

const SCOPE_TH = { self: 'ของฉัน', team: 'ทีมของฉัน', all: 'ทั้งบริษัท' };
const PAGE = 30;

export async function render(ctx) {
  const { el } = ctx;
  const role = ctx.profile.role || {};
  const now = new Date();
  const st = { y: now.getFullYear(), m: now.getMonth() + 1, who: '', status: 'all', data: null, staff: null, shown: PAGE };
  const canSummary = role.isGM || role.isAccountant || role.isCEO;
  const me = String(ctx.profile.email || '').toLowerCase();

  el.innerHTML = `<div class="stack"><div id="sm-top"></div><div id="sm-body"></div><div id="sm-xls"></div></div>`;
  const $ = (id) => el.querySelector('#' + id);

  async function load() {
    const y = st.y, m = st.m;
    paintTop();
    try {
      await api.load('get_visible_requests', { p_year: y, p_month: m }, (d) => {
        if (!ctx.alive() || y !== st.y || m !== st.m) return;
        st.data = d;
        if (st.who && !(d.staffList || []).some((s) => s.email === st.who)) st.who = '';
        paintTop(); paintBody(); paintXls();
      });
    } catch (e) {
      if (ctx.alive() && y === st.y && m === st.m) errorBox($('sm-body'), e, load);
    }
  }

  // รายการในเดือนที่เลือก (ตัดบิลเก่าที่ส่งมาด้วยออก) · ไม่นับไม่อนุมัติ / ขออนุมัติงบ / บิลที่ปิดแล้ว
  function filtered() {
    const d = st.data || {};
    const first = `${st.y}-${String(st.m).padStart(2, '0')}-01`;
    const last = ymd(new Date(st.y, st.m, 0));
    return (d.items || []).filter((r) => {
      const day = r.expense_date || ymd(r.created_at);
      if (!day || day < first || day > last) return false;
      if (!(r.status === 'Approved' || r.status === 'Pending')) return false;
      if (st.status !== 'all' && r.status !== st.status) return false;
      if (st.who && String(r.staff_email).toLowerCase() !== st.who) return false;
      return true;
    });
  }

  function paintTop() {
    const d = st.data;
    const staff = (d?.staffList || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
    const scope = d?.scope || 'self';
    $('sm-top').innerHTML = `
      <div class="page-head compact"><div><h1>สรุป & Excel</h1><div class="sub">${d ? `ขอบเขต: ${esc(SCOPE_TH[scope] || scope)}` : 'กำลังโหลด…'}</div></div>
        <div class="actions">${monthNav(st.y, st.m)}</div></div>
      <div class="toolbar">
        <div class="seg" role="tablist">${[['all', 'ทั้งหมด'], ['Approved', 'อนุมัติแล้ว'], ['Pending', 'รออนุมัติ']].map(([k, l]) =>
          `<button class="${st.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`).join('')}</div>
        ${d && scope !== 'self' ? `<select class="input" id="sm-who" aria-label="เลือกพนักงาน" style="width:auto;min-width:180px">
          <option value="">ทุกคน (${staff.length})</option>${staff.map((s) => `<option value="${esc(s.email)}" ${st.who === s.email ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
      </div>`;
  }

  function paintBody() {
    const items = filtered();
    const sum = (arr) => arr.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const appr = items.filter((r) => r.status === 'Approved'), pend = items.filter((r) => r.status === 'Pending');
    const total = sum(items);
    const scope = st.data?.scope || 'self';

    if (!items.length) {
      $('sm-body').innerHTML = `<div class="card">${empty({ ic: 'chart', title: `ไม่มีรายการเดือน ${monthLabel(st.y, st.m, true)}`, sub: st.status !== 'all' || st.who ? 'ลองเปลี่ยนตัวกรอง' : 'ลองเลือกเดือนอื่น' })}</div>`;
      return;
    }
    // ตามหมวด
    const byCat = group(items, (r) => r.category);
    const catTop = byCat.slice(0, 9);
    const catRest = byCat.slice(9).reduce((s, x) => s + x.value, 0);
    const donutItems = catTop.map((x, i) => ({ label: catName(x.key), value: x.value, n: x.n, color: PALETTE[i % PALETTE.length] }));
    if (catRest > 0) donutItems.push({ label: 'อื่นๆ', value: catRest, color: '#9AA0AE' });
    // ตามคน / แผนก
    const byStaff = group(items, (r) => r.staff_name || r.staff_email);
    const byDept = group(items, (r) => r.department || 'ไม่ระบุแผนก');
    const showStaff = scope !== 'self' && !st.who && byStaff.length > 1;

    $('sm-body').innerHTML = `
      <div class="grid-4">
        <div class="stat brand"><div class="l">${icon('banknote', 'sm')} ยอดรวม</div><div class="v">${money(total, 0)}</div><div class="d">บาท · ${monthLabel(st.y, st.m)}</div></div>
        <div class="stat"><div class="l">${icon('receipt', 'sm')} จำนวนรายการ</div><div class="v">${money(items.length, 0)}</div><div class="d">${showStaff ? `${byStaff.length} คน` : 'รายการ'}</div></div>
        <div class="stat ok"><div class="l">${icon('check-circle', 'sm')} อนุมัติแล้ว</div><div class="v">${money(sum(appr), 0)}</div><div class="d">${appr.length} รายการ</div></div>
        <div class="stat warn"><div class="l">${icon('clock', 'sm')} รออนุมัติ</div><div class="v">${money(sum(pend), 0)}</div><div class="d">${pend.length} รายการ</div></div>
      </div>
      <div class="split">
        <div class="stack">
          <div class="card"><div class="card-head"><h3>${icon('calendar')} ยอดรายวัน</h3><span class="muted text-sm">สูงสุด ${money(Math.max(...daily(items).map((x) => x.v)), 0)}</span></div>
            <div class="pad">${dailyChart(items)}</div></div>
          ${showStaff ? `<div class="card"><div class="card-head"><h3>${icon('users')} ตามพนักงาน</h3><span class="muted text-sm">${byStaff.length > 10 ? 'อันดับ 1–10' : `${byStaff.length} คน`}</span></div>
            <div class="pad">${bars(byStaff.slice(0, 10).map((x) => ({ label: x.key, value: x.value })))}</div></div>` : ''}
          ${byDept.length > 1 ? `<div class="card"><div class="card-head"><h3>${icon('building')} ตามแผนก</h3></div>
            <div class="pad">${bars(byDept.map((x) => ({ label: x.key, value: x.value })))}</div></div>` : ''}
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><h3>${icon('pie')} ตามหมวด</h3></div>
            <div class="pad"><div class="flex gap-16 wrap" style="justify-content:center">${donut(donutItems)}
              <div class="legend grow">${donutItems.map((x) => `<div class="flex between"><span class="ellipsis"><i class="sw" style="background:${x.color}"></i>${esc(x.label)}</span>
                <span class="amount text-sm">${money(x.value, 0)} <span class="muted">${Math.round((x.value / (total || 1)) * 100)}%</span></span></div>`).join('')}</div></div></div></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>${icon('list')} รายการ</h3><span class="muted text-sm">${items.length} รายการ</span></div>
        <div class="list">${items.slice().sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || '')))
          .slice(0, st.shown).map((r) => requestRow(r, { who: scope !== 'self' && !st.who, href: String(r.staff_email).toLowerCase() === me ? '#/requests?id=' + encodeURIComponent(r.id) : '' })).join('')}</div>
        ${items.length > st.shown ? `<div class="card-foot"><button class="btn btn-ghost btn-block" data-act="more">แสดงเพิ่ม (${items.length - st.shown})</button></div>` : ''}
      </div>`;
  }

  // ─────────── Excel ───────────
  function paintXls() {
    const staff = st.staff || [];
    const first = `${st.y}-${String(st.m).padStart(2, '0')}-01`, last = ymd(new Date(st.y, st.m, 0));
    const depts = [...new Set((st.data?.items || []).map((r) => r.department).filter(Boolean))].sort();
    const opts = (id) => `<select class="input" id="${id}">${staff.map((s) => `<option value="${esc(s.email)}" ${(st.who ? s.email === st.who : s.self) ? 'selected' : ''}>${esc(s.fullName || s.name)}${s.self ? ' (ฉัน)' : ''}</option>`).join('')}</select>`;
    $('sm-xls').innerHTML = `<div class="card" id="export"><div class="card-head"><h3>${icon('sheet')} ดาวน์โหลด Excel</h3><span class="muted text-sm">${monthLabel(st.y, st.m, true)}</span></div>
      <div class="pad stack">
        ${!staff.length ? '<div class="flex"><span class="spin"></span><span class="muted text-sm">กำลังโหลดรายชื่อ…</span></div>' : `
        <div class="stack-sm">
          <div class="bold">${icon('file', 'sm')} ฟอร์มขอเบิก (รายงาน)</div>
          <p class="hint">ฟอร์มเดียวกับที่ใช้ขอเบิก ตามรอบของเดือนที่เลือก — ใช้ตรวจยอดก่อนขอเบิกจริง</p>
          <div class="form-grid two">
            <div class="field"><label for="sx-staff">พนักงาน</label>${opts('sx-staff')}</div>
            <div class="field"><label>&nbsp;</label><button class="btn btn-secondary" data-act="xls-report" data-busy="กำลังสร้างไฟล์…">${icon('download')} ดาวน์โหลดฟอร์ม</button></div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="stack-sm">
          <div class="bold">${icon('list', 'sm')} รายการคำขอ (สำหรับบัญชี)</div>
          <div class="form-grid two">
            <div class="field"><label for="sx-lstaff">พนักงาน</label>${opts('sx-lstaff')}</div>
            <div class="field"><label for="sx-lst">สถานะ</label><select class="input" id="sx-lst"><option value="">ทุกสถานะ</option><option value="Approved">อนุมัติแล้ว</option><option value="Pending">รออนุมัติ</option><option value="Rejected">ไม่อนุมัติ</option></select></div>
            <div class="field"><label for="sx-from">ตั้งแต่</label><input class="input" type="date" id="sx-from" value="${first}"></div>
            <div class="field"><label for="sx-to">ถึง</label><input class="input" type="date" id="sx-to" value="${last}"></div>
          </div>
          <button class="btn btn-secondary" data-act="xls-list" data-busy="กำลังสร้างไฟล์…">${icon('download')} ดาวน์โหลดรายการ</button>
        </div>`}
        ${canSummary ? `<div class="divider"></div>
        <div class="stack-sm">
          <div class="bold">${icon('users', 'sm')} สรุปทุกคน (ใบสรุปเบิกจ่ายรายเดือน)</div>
          <p class="hint">ยอดจากใบขอเบิกที่อนุมัติแล้วของเดือน ${monthLabel(st.y, st.m, true)} แยกตามหมวด</p>
          <div class="form-grid two">
            <div class="field"><label for="sx-dept">แผนก</label><select class="input" id="sx-dept"><option value="*">ทุกแผนก</option>${depts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select></div>
            <div class="field"><label>&nbsp;</label><button class="btn btn-secondary" data-act="xls-summary" data-busy="กำลังสร้างไฟล์…">${icon('download')} ดาวน์โหลดสรุป</button></div>
          </div>
        </div>` : ''}
      </div></div>`;
  }

  async function act(t) {
    const a = t.dataset.act;
    const v = (id) => el.querySelector('#' + id)?.value || '';
    try {
      if (a === 'more') { st.shown += PAGE; paintBody(); return; }
      let body = null;
      if (a === 'xls-report') body = { type: 'staff_form', kind: 'report', staffEmail: v('sx-staff'), year: st.y, month: st.m };
      if (a === 'xls-list') {
        if (v('sx-from') && v('sx-to') && v('sx-to') < v('sx-from')) { toast('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'bad'); return; }
        body = { type: 'request_list', staffEmail: v('sx-lstaff'), dateFrom: v('sx-from'), dateTo: v('sx-to'), status: v('sx-lst') };
      }
      if (a === 'xls-summary') body = { type: 'staff_summary', ym: `${st.y}-${String(st.m).padStart(2, '0')}`, dept: v('sx-dept') || '*' };
      if (!body) return;
      const meta = await withBtn(t, () => api.excel(body));
      if (meta) toast(`ดาวน์โหลดแล้ว · ${meta.filename}${meta.count != null ? ` · ${meta.count} รายการ` : ''}`);
    } catch (e) { toastError(e); }
  }

  api.rpc('get_exportable_staff', {}, { ttl: 600 }).then((s) => { st.staff = s || []; if (ctx.alive() && st.data) paintXls(); })
    .catch((e) => { st.staff = []; toastError(e); });
  await load();
  if (ctx.query?.export) $('export')?.scrollIntoView({ block: 'start' });

  const offs = [
    on(el, 'click', '[data-act]', (e, t) => act(t)),
    on(el, 'click', '[data-mprev],[data-mnext]', (e, t) => {
      [st.y, st.m] = shiftMonth(st.y, st.m, t.hasAttribute('data-mprev') ? -1 : 1);
      st.data = null; st.shown = PAGE;
      $('sm-body').innerHTML = '<div class="card"><div class="skel-row"><div class="skel a"></div><div class="skel b"></div><div class="skel c"></div></div><div class="skel-row"><div class="skel a"></div><div class="skel b"></div><div class="skel c"></div></div></div>';
      load();
    }),
    on(el, 'click', '[data-status]', (e, t) => { st.status = t.dataset.status; st.shown = PAGE; paintTop(); if (st.data) paintBody(); }),
    on(el, 'change', '#sm-who', (e, t) => { st.who = t.value; st.shown = PAGE; if (st.data) { paintBody(); paintXls(); } }),
  ];
  return () => offs.forEach((f) => f());
}

// รวมยอดตาม key → [{key, value, n}] เรียงมากไปน้อย
function group(items, keyFn) {
  const m = new Map();
  items.forEach((r) => { const k = keyFn(r); const g = m.get(k) || { key: k, value: 0, n: 0 }; g.value += Number(r.amount) || 0; g.n++; m.set(k, g); });
  return [...m.values()].sort((a, b) => b.value - a.value);
}

// ยอดรายวันของเดือน (ใช้วันที่ใช้จ่าย)
function daily(items) {
  if (!items.length) return [{ d: 1, v: 0 }];
  const any = items[0].expense_date || ymd(items[0].created_at);
  const [y, m] = any.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const out = Array.from({ length: days }, (_, i) => ({ d: i + 1, v: 0, date: `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}` }));
  items.forEach((r) => { const day = Number((r.expense_date || ymd(r.created_at)).slice(8, 10)); if (out[day - 1]) out[day - 1].v += Number(r.amount) || 0; });
  return out;
}

// กราฟแท่งแนวตั้งแบบง่าย (SVG) — ชี้ที่แท่งเพื่อดูยอด
function dailyChart(items) {
  const d = daily(items);
  const max = Math.max(1, ...d.map((x) => x.v));
  const w = 10, h = 100;
  const rects = d.map((x, i) => {
    const bh = x.v > 0 ? Math.max(2, (x.v / max) * (h - 4)) : 0;
    return `<rect x="${i * w + 1.5}" y="${h - bh}" width="${w - 3}" height="${bh}" rx="1.5" fill="#B7081D"><title>${esc(fmtDate(x.date))} · ${money(x.v)} บาท</title></rect>`;
  }).join('');
  const busiest = d.reduce((a, b) => (b.v > a.v ? b : a), d[0]);
  return `<svg viewBox="0 0 ${d.length * w} ${h}" preserveAspectRatio="none" width="100%" height="120" role="img" aria-label="กราฟยอดรายวัน">
      <line x1="0" y1="${h - 0.5}" x2="${d.length * w}" y2="${h - 0.5}" stroke="#E7E9EE" stroke-width="1"/>${rects}</svg>
    <div class="flex between text-xs muted mt-4"><span>1</span><span>${Math.ceil(d.length / 2)}</span><span>${d.length}</span></div>
    ${busiest.v > 0 ? `<p class="hint mt-8">วันที่ใช้จ่ายมากสุด: ${esc(fmtDate(busiest.date))} · ${compact(busiest.v)} บาท</p>` : ''}`;
}
