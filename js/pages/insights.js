// แดชบอร์ดลูกค้า — ใช้เงินกับลูกค้ารายไหนเท่าไร ไปกี่ครั้ง ไปเพื่ออะไร (ฝั่งเซิร์ฟเวอร์ตัดสินขอบเขต: ทั้งบริษัท / ทีมของฉัน)
import { api, money, compact, fmtDate, esc, catName, ymd } from '../core.js';
import { icon, catIcon, toast, toastError, withBtn, bars, donut, PALETTE, sheet, errorBox, skeleton, on, debounce } from '../ui.js';

const SCOPE_TH = { all: 'ทั้งบริษัท', team: 'ทีมของฉัน' };
const PRESETS = [['month', 'เดือนนี้'], ['last', 'เดือนก่อน'], ['3m', '3 เดือน'], ['6m', '6 เดือน'], ['ytd', 'ปีนี้'], ['custom', 'กำหนดเอง']];
const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TOP = 15;

function range(preset) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const first = (yy, mm) => ymd(new Date(yy, mm, 1));
  switch (preset) {
    case 'last': return [first(y, m - 1), ymd(new Date(y, m, 0))];
    case '3m': return [first(y, m - 2), ymd(now)];
    case '6m': return [first(y, m - 5), ymd(now)];
    case 'ytd': return [first(y, 0), ymd(now)];
    default: return [first(y, m), ymd(now)];
  }
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const ymLabel = (ym) => { const [y, m] = String(ym).split('-').map(Number); return `${MONTH_TH[m - 1]} ${String(y + 543).slice(2)}`; };

export async function render(ctx) {
  const { el } = ctx;
  const [f0, t0] = range('month');
  const st = { preset: 'month', from: f0, to: t0, dept: '', staff: '', q: '', all: false, data: null };

  el.innerHTML = `<div class="stack"><div id="in-top"></div><div id="in-body">${skeleton(6)}</div></div>`;
  const $ = (id) => el.querySelector('#' + id);

  async function load() {
    const key = JSON.stringify([st.from, st.to, st.dept, st.staff]);
    paintTop();
    try {
      const d = await api.rpc('get_customer_dashboard', { p_from: st.from, p_to: st.to, p_dept: st.dept || null, p_staff: st.staff || null });
      if (!ctx.alive() || key !== JSON.stringify([st.from, st.to, st.dept, st.staff])) return;
      st.data = d;
      paintTop(); paintBody();
    } catch (e) { if (ctx.alive()) errorBox($('in-body'), e, load); }
  }

  // ─────────────── ตัวกรอง ───────────────
  function paintTop() {
    const d = st.data, o = d?.options || {};
    const staff = (o.staff || []).filter((s) => !st.dept || s.dept === st.dept);
    $('in-top').innerHTML = `
      <div class="page-head compact"><div><h1>แดชบอร์ดลูกค้า</h1>
        <div class="sub">${d ? `${esc(SCOPE_TH[d.scope] || d.scope)} · ${esc(fmtDate(d.from))} – ${esc(fmtDate(d.to))}` : 'กำลังโหลด…'}</div></div>
        <div class="actions"><button class="btn btn-secondary" data-act="xls" ${d ? '' : 'disabled'}>${icon('download', 'sm')} Excel</button></div></div>
      <div class="chips" role="tablist">${PRESETS.map(([k, l]) => `<button class="chip ${st.preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
      ${st.preset === 'custom' ? `<div class="toolbar mt-8"><input class="input" type="date" id="in-from" value="${esc(st.from)}" aria-label="ตั้งแต่" style="width:auto">
        <span class="muted">ถึง</span><input class="input" type="date" id="in-to" value="${esc(st.to)}" aria-label="ถึง" style="width:auto"></div>` : ''}
      <div class="toolbar mt-8">
        ${(o.depts || []).length > 1 ? `<select class="input" id="in-dept" aria-label="แผนก" style="width:auto;min-width:150px">
          <option value="">ทุกแผนก</option>${o.depts.map((x) => `<option ${st.dept === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
        ${staff.length > 1 ? `<select class="input" id="in-staff" aria-label="พนักงาน" style="width:auto;min-width:170px">
          <option value="">ทุกคน (${staff.length})</option>${staff.map((s) => `<option value="${esc(s.email)}" ${st.staff === s.email ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        ${st.dept || st.staff ? `<button class="btn btn-ghost btn-sm" data-act="clear">${icon('x', 'sm')} ล้างตัวกรอง</button>` : ''}
      </div>`;
  }

  // ─────────────── เนื้อหา ───────────────
  function paintBody() {
    const d = st.data, k = d.kpi || {};
    if (!k.bills) {
      $('in-body').innerHTML = `<div class="card pad text-center"><div class="muted">${icon('chart')} ไม่มีค่าใช้จ่ายในช่วงนี้</div></div>`;
      return;
    }
    const diff = d.prevTotal > 0 ? Math.round(((k.total - d.prevTotal) / d.prevTotal) * 100) : null;
    const q = d.quality || {};
    const complete = q.bills ? Math.round(((q.bills - Math.max(q.noPurpose, q.noCustomer, q.noContact)) / q.bills) * 100) : 100;
    $('in-body').innerHTML = `<div class="stack">
      <div class="grid-4">
        ${stat('wallet', 'ยอดรวม', compact(k.total), diff == null ? `${money(k.bills, 0)} บิล` : `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}% จากช่วงก่อน`, 'brand')}
        ${stat('map', 'ไปพบลูกค้า', `${money(k.visits, 0)} ครั้ง`, `${money(k.staff, 0)} คน`)}
        ${stat('building', 'ลูกค้า', `${money(k.customers, 0)} ราย`, `${pct(k.withCustomer, k.total)}% ของยอดระบุลูกค้า`)}
        ${stat('calculator', 'เฉลี่ยต่อครั้ง', compact(k.visits ? k.withCustomer / k.visits : 0), 'บาท / การไปพบ 1 ครั้ง')}
        ${stat('check-circle', 'อนุมัติแล้ว', compact(k.approved), `รออนุมัติ ${compact(k.pending)}`, 'ok')}
        ${stat('utensils', 'ค่ารับรอง / กอล์ฟ', compact(k.ent), `${pct(k.ent, k.total)}% ของยอดรวม`)}
        ${stat('receipt', 'จำนวนบิล', money(k.bills, 0), d.nrows > (d.rows || []).length ? `แสดง ${money(d.rows.length, 0)} ล่าสุด` : 'ในช่วงที่เลือก')}
        ${stat('shield', 'ข้อมูลครบ', `${complete}%`, 'มี Purpose + ลูกค้า + Contact', complete < 80 ? 'warn' : 'ok')}
      </div>
      ${customersCard(d)}
      <div class="grid-2 collapse-m">${purposeCard(d)}${categoryCard(d)}</div>
      ${staffCard(d)}
      ${d.scope === 'all' && !st.dept && (d.depts || []).length > 1 ? deptCard(d) : ''}
      ${trendCard(d)}
      ${budgetCard(d)}
      ${qualityCard(d)}
    </div>`;
  }

  function stat(ic, l, v, sub, tone = '') {
    return `<div class="stat ${tone}"><div class="l">${icon(ic, 'sm')} ${esc(l)}</div><div class="v">${v}</div><div class="d">${esc(sub)}</div></div>`;
  }

  function customersCard(d) {
    const term = st.q.trim().toLowerCase();
    const list = (d.customers || []).filter((c) => !term || String(c.name).toLowerCase().includes(term) || String(c.key).includes(term));
    const shown = st.all || term ? list : list.slice(0, TOP);
    const max = Math.max(1, ...list.map((c) => c.total));
    return `<div class="card"><div class="card-head"><h3>${icon('building')} ลูกค้าที่ใช้จ่ายสูงสุด</h3><span class="text-sm muted">${money(list.length, 0)} ราย · แตะเพื่อดูทุกครั้งที่ไป</span></div>
      <div class="pad-x pb-8"><input class="input" id="in-q" placeholder="ค้นหาชื่อลูกค้า" value="${esc(st.q)}" autocomplete="off"></div>
      ${shown.length ? `<div class="table-wrap" style="border:0;border-radius:0;max-height:none"><table class="tbl"><thead><tr>
        <th>ลูกค้า</th><th class="r">ยอด</th><th class="r">ครั้ง</th><th class="r">เฉลี่ย/ครั้ง</th><th>ใครไป</th><th>ไปล่าสุด</th></tr></thead><tbody>
        ${shown.map((c) => `<tr class="click" data-cust="${esc(c.key)}">
          <td><div class="row-title">${esc(c.name)}${c.type ? ` <span class="badge b-neutral">${esc(c.type)}</span>` : ''}</div>
            <div class="meter mt-4" style="height:6px"><i style="width:${Math.max(2, (c.total / max) * 100)}%;background:var(--brand)"></i></div></td>
          <td class="r amount">${money(c.total, 0)}</td><td class="r">${money(c.visits, 0)}</td><td class="r">${money(c.visits ? c.total / c.visits : 0, 0)}</td>
          <td class="text-sm">${esc((c.staff || []).slice(0, 3).join(', '))}${(c.staff || []).length > 3 ? ` +${c.staff.length - 3}` : ''}</td>
          <td class="text-sm nowrap">${esc(fmtDate(c.last))}</td></tr>`).join('')}</tbody></table></div>` : `<p class="pad muted">ไม่พบลูกค้า</p>`}
      ${!term && list.length > TOP ? `<div class="pad text-center"><button class="btn btn-ghost btn-sm" data-act="all">${st.all ? 'แสดงเฉพาะ ' + TOP + ' อันดับแรก' : `แสดงทั้งหมด ${list.length} ราย`}</button></div>` : ''}
    </div>`;
  }

  function purposeCard(d) {
    const list = d.purposes || []; const max = Math.max(1, ...list.map((p) => p.total));
    const items = list.map((p) => `<div><div class="flex between gap-8 text-sm"><span>${esc(p.name)}</span>
        <span><span class="amount">${money(p.total, 0)}</span> <span class="muted">· ${money(p.visits, 0)} ครั้ง</span></span></div>
      <div class="meter mt-4"><i style="width:${Math.max(2, (p.total / max) * 100)}%;background:var(--brand)"></i></div></div>`).join('');
    return `<div class="card"><div class="card-head"><h3>${icon('flag')} ไปเพื่ออะไร (Purpose)</h3></div><div class="pad stack-sm">${items}
      <p class="hint mt-12">จัดกลุ่มอัตโนมัติจากข้อความ Purpose of visiting เช่น "เสนอราคา" "Bidding" "ติดตั้ง"</p></div></div>`;
  }

  function categoryCard(d) {
    const cats = d.categories || [];
    const items = cats.map((c, i) => ({ label: catName(c.code), value: c.total, color: PALETTE[i % PALETTE.length] }));
    return `<div class="card"><div class="card-head"><h3>${icon('pie')} แยกตามหมวด</h3></div><div class="pad flex gap-16 wrap" style="align-items:center">
      ${donut(items, 130)}<div class="grow stack-sm" style="min-width:160px">${items.map((x, i) => `<div class="flex between gap-8 text-sm">
        <span class="flex gap-8"><i style="width:10px;height:10px;border-radius:3px;background:${x.color};display:inline-block;flex:none"></i>${esc(x.label)}</span>
        <span class="amount">${money(x.value, 0)} <span class="muted">· ${money(cats[i].bills, 0)} บิล</span></span></div>`).join('')}</div></div></div>`;
  }

  function staffCard(d) {
    const list = d.staff || [];
    if (list.length < 2 && !st.staff) return '';
    return `<div class="card"><div class="card-head"><h3>${icon('users')} แยกตามพนักงาน</h3><span class="text-sm muted">แตะชื่อเพื่อกรองเฉพาะคนนั้น</span></div>
      <div class="table-wrap" style="border:0;border-radius:0;max-height:none"><table class="tbl"><thead><tr>
        <th>พนักงาน</th><th class="r">ยอด</th><th class="r">ไปพบ</th><th class="r">ลูกค้า</th><th class="r">เฉลี่ย/ครั้ง</th><th class="r">รับรอง</th></tr></thead><tbody>
        ${list.map((s) => `<tr class="click" data-staff="${esc(s.email)}"><td><div class="row-title">${esc(s.name)}</div><div class="text-xs muted">${esc(s.dept)}</div></td>
          <td class="r amount">${money(s.total, 0)}</td><td class="r">${money(s.visits, 0)}</td><td class="r">${money(s.customers, 0)}</td>
          <td class="r">${money(s.visits ? s.total / s.visits : 0, 0)}</td><td class="r">${s.ent ? money(s.ent, 0) : '-'}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function deptCard(d) {
    const items = (d.depts || []).map((x) => ({ label: `${x.name} · ${money(x.staff, 0)} คน`, value: x.total }));
    return `<div class="card"><div class="card-head"><h3>${icon('layers')} แยกตามแผนก</h3></div><div class="pad">${bars(items)}</div></div>`;
  }

  function trendCard(d) {
    const rows = d.trend || [];
    if (!rows.length) return '';
    const months = [];
    const end = new Date(d.to); for (let i = 11; i >= 0; i--) { const x = new Date(end.getFullYear(), end.getMonth() - i, 1); months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
    const byCat = {}; rows.forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + Number(r.total); });
    const top = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).slice(0, 5);
    const keyOf = (c) => (top.includes(c) ? c : 'OTHER*');
    const series = [...top, ...(Object.keys(byCat).length > top.length ? ['OTHER*'] : [])];
    const color = (c) => (c === 'OTHER*' ? '#94A3B8' : PALETTE[top.indexOf(c) % PALETTE.length]);
    const val = {}; rows.forEach((r) => { const k = r.ym + '|' + keyOf(r.cat); val[k] = (val[k] || 0) + Number(r.total); });
    const tot = months.map((m) => series.reduce((s, c) => s + (val[m + '|' + c] || 0), 0));
    const max = Math.max(1, ...tot), W = 40, H = 150;
    const rects = months.map((m, i) => {
      let y = H;
      return series.map((c) => {
        const v = val[m + '|' + c] || 0; if (!v) return '';
        const h = Math.max(1, (v / max) * (H - 6)); y -= h;
        return `<rect x="${i * W + 6}" y="${y}" width="${W - 12}" height="${h}" rx="2" fill="${color(c)}"><title>${esc(ymLabel(m))} · ${esc(c === 'OTHER*' ? 'อื่นๆ' : catName(c))} ${money(v, 0)} บาท</title></rect>`;
      }).join('');
    }).join('');
    return `<div class="card"><div class="card-head"><h3>${icon('trending')} แนวโน้ม 12 เดือน</h3><span class="text-sm muted">ไม่ขึ้นกับช่วงวันที่ด้านบน</span></div><div class="pad">
      <svg viewBox="0 0 ${months.length * W} ${H}" preserveAspectRatio="none" width="100%" height="170" role="img" aria-label="กราฟค่าใช้จ่ายรายเดือน">
        <line x1="0" y1="${H - 0.5}" x2="${months.length * W}" y2="${H - 0.5}" stroke="#E7E9EE"/>${rects}</svg>
      <div class="flex between text-xs muted mt-4">${months.map((m, i) => `<span style="width:${100 / 12}%;text-align:center">${i % 2 === 1 || months.length < 7 ? esc(ymLabel(m)) : ''}</span>`).join('')}</div>
      <div class="flex wrap gap-12 mt-12 text-sm">${series.map((c) => `<span class="flex gap-4"><i style="width:10px;height:10px;border-radius:3px;background:${color(c)};display:inline-block"></i>${esc(c === 'OTHER*' ? 'อื่นๆ' : catName(c))}</span>`).join('')}</div>
      <p class="hint mt-8">ยอดสูงสุด ${esc(ymLabel(months[tot.indexOf(Math.max(...tot))]))} · ${money(Math.max(...tot), 0)} บาท</p></div></div>`;
  }

  function budgetCard(d) {
    const list = d.budgets || [];
    if (!list.length) return '';
    const billed = list.filter((b) => b.state === 'billed');
    const sb = billed.reduce((s, b) => s + Number(b.budget || 0), 0), sa = billed.reduce((s, b) => s + Number(b.actual || 0), 0);
    const open = list.filter((b) => b.state === 'unbilled').reduce((s, b) => s + Number(b.budget || 0), 0);
    return `<div class="card"><div class="card-head"><h3>${icon('utensils')} ค่ารับรอง / กอล์ฟ: งบ vs ยอดจริง</h3>
        <span class="text-sm muted">ส่งบิลแล้ว: งบ ${money(sb, 0)} · จริง ${money(sa, 0)}${open ? ` · งบที่ยังไม่ใช้ ${money(open, 0)}` : ''}</span></div>
      <div class="table-wrap" style="border:0;border-radius:0;max-height:none"><table class="tbl"><thead><tr>
        <th>วันที่</th><th>พนักงาน</th><th>ลูกค้า / Purpose</th><th class="r">งบ</th><th class="r">จริง</th><th class="r">ส่วนต่าง</th></tr></thead><tbody>
        ${list.map((b) => {
          const a = b.state === 'billed' ? Number(b.actual || 0) : null; const df = a == null ? null : a - Number(b.budget);
          return `<tr><td class="nowrap text-sm">${esc(fmtDate(b.d))}</td><td class="text-sm">${esc(b.staff)}</td>
            <td><div class="row-title">${esc(b.cust || '-')} <span class="badge b-neutral">${esc(catName(b.cat))}</span></div><div class="text-xs muted">${esc(b.purpose || '')}</div></td>
            <td class="r">${money(b.budget, 0)}</td><td class="r">${a == null ? '<span class="badge b-info">ยังไม่ส่งบิล</span>' : money(a, 0)}</td>
            <td class="r">${df == null ? '-' : `<span class="badge ${df > 0 ? 'b-rejected' : 'b-approved'}">${df > 0 ? '+' : ''}${money(df, 0)}</span>`}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
  }

  function qualityCard(d) {
    const q = d.quality || {};
    if (!q.bills) return '';
    const row = (l, n) => `<div class="flex between text-sm"><span>${esc(l)}</span><span class="${n ? 'warn-text' : 'muted'}">${money(n, 0)} บิล (${pct(n, q.bills)}%)</span></div>`;
    return `<div class="card"><div class="card-head"><h3>${icon('shield')} คุณภาพข้อมูล</h3><span class="text-sm muted">${money(q.bills, 0)} บิลในช่วงนี้</span></div>
      <div class="pad stack-sm">${row('ไม่มี Purpose of visiting', q.noPurpose)}${row('ไม่มีชื่อลูกค้า', q.noCustomer)}${row('ไม่มี Contact name', q.noContact)}${row('ไม่มีใบเสร็จ (ไม่นับค่าน้ำมัน)', q.noReceipt)}
      <p class="hint">บิลเก่าก่อนมีกติกาบังคับกรอกมักไม่มีข้อมูลเหล่านี้ · ชื่อลูกค้าที่สะกดต่างกันมาก (เช่น ไทย/อังกฤษ) จะนับแยกกัน</p></div></div>`;
  }

  // ─────────────── รายละเอียดลูกค้า ───────────────
  function openCustomer(key) {
    const d = st.data; const c = (d.customers || []).find((x) => x.key === key); if (!c) return;
    const rows = (d.rows || []).filter((r) => r.ck === key);
    const visits = {}; rows.forEach((r) => { const k = r.d + '|' + r.em; (visits[k] = visits[k] || { d: r.d, staff: r.staff, items: [] }).items.push(r); });
    const vlist = Object.values(visits).sort((a, b) => (a.d < b.d ? 1 : -1));
    const cats = Object.entries(c.cats || {}).sort((a, b) => b[1] - a[1]);
    const pur = Object.entries(c.purposes || {}).sort((a, b) => b[1] - a[1]);
    sheet({
      title: c.name, wide: true,
      body: `<div class="grid-4 mb-12">
          ${stat('wallet', 'ยอดรวม', money(c.total, 0), `${money(c.bills, 0)} บิล`, 'brand')}${stat('map', 'ไปพบ', `${money(c.visits, 0)} ครั้ง`, `เฉลี่ย ${money(c.visits ? c.total / c.visits : 0, 0)} บาท`)}
          ${stat('users', 'พนักงาน', `${money(c.nstaff, 0)} คน`, (c.staff || []).join(', '))}${stat('calendar', 'ไปล่าสุด', fmtDate(c.last), `ครั้งแรก ${fmtDate(c.first)}`)}</div>
        <div class="flex wrap gap-8 mb-8">${cats.map(([k, v]) => `<span class="chip">${catIcon(k)} ${esc(catName(k))} · ${money(v, 0)}</span>`).join('')}</div>
        <div class="flex wrap gap-8 mb-12">${pur.map(([k, v]) => `<span class="chip">${esc(k)} · ${money(v, 0)} ครั้ง</span>`).join('')}</div>
        ${(c.contacts || []).length ? `<p class="text-sm mb-12"><b>Contact:</b> ${esc(c.contacts.join(', '))}</p>` : ''}
        <div class="label mb-8">${icon('list', 'sm')} ทุกครั้งที่ไป (${vlist.length})</div>
        <div class="list">${vlist.map((v) => {
          const sum = v.items.reduce((s, r) => s + Number(r.amt), 0);
          const p = v.items.find((r) => r.purpose)?.purpose; const ct = v.items.find((r) => r.contact)?.contact;
          return `<div class="row"><div class="row-main"><div class="row-title">${esc(fmtDate(v.d))} · ${esc(v.staff)}${ct ? ` <span class="muted text-sm">→ ${esc(ct)}</span>` : ''}</div>
            <div class="row-sub">${p ? esc(p) : '<span class="warn-text">ไม่ระบุ Purpose</span>'}</div>
            <div class="row-sub">${v.items.map((r) => `${esc(catName(r.cat))} ${money(r.amt, 0)}${r.st === 'Pending' ? ' (รออนุมัติ)' : ''}`).join(' · ')}</div></div>
            <div class="row-end"><span class="amount">${money(sum, 0)}</span></div></div>`;
        }).join('')}</div>
        ${d.nrows > (d.rows || []).length ? '<p class="hint mt-8">ช่วงเวลายาวมาก แสดงเฉพาะ 5,000 บิลล่าสุด — เลือกช่วงสั้นลงเพื่อดูครบ</p>' : ''}`,
    });
  }

  // ─────────────── ปุ่ม ───────────────
  const searchCust = debounce((v) => {
    st.q = v;
    const card = $('in-body').querySelector('#in-q')?.closest('.card');
    if (card) { card.outerHTML = customersCard(st.data); const inp = $('in-body').querySelector('#in-q'); inp.focus(); inp.setSelectionRange(v.length, v.length); }
  }, 200);
  const offs = [
    on(el, 'click', '[data-preset]', (e, t) => {
      st.preset = t.dataset.preset;
      if (st.preset !== 'custom') { [st.from, st.to] = range(st.preset); load(); } else paintTop();
    }),
    on(el, 'change', '#in-from, #in-to', () => {
      const f = $('in-from')?.value, t = $('in-to')?.value;
      if (f && t && f <= t) { st.from = f; st.to = t; load(); } else toast('เลือกช่วงวันที่ให้ถูกต้อง', 'bad');
    }),
    on(el, 'change', '#in-dept', (e, t) => { st.dept = t.value; st.staff = ''; load(); }),
    on(el, 'change', '#in-staff', (e, t) => { st.staff = t.value; load(); }),
    on(el, 'input', '#in-q', (e, t) => searchCust(t.value)),
    on(el, 'click', '[data-cust]', (e, t) => openCustomer(t.dataset.cust)),
    on(el, 'click', '[data-staff]', (e, t) => { st.staff = t.dataset.staff; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); }),
    on(el, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'all') { st.all = !st.all; paintBody(); }
      else if (a === 'clear') { st.dept = ''; st.staff = ''; load(); }
      else if (a === 'xls') {
        try {
          const meta = await withBtn(t, () => api.excel({ type: 'customer_dashboard', from: st.from, to: st.to, dept: st.dept || null, staff: st.staff || null }));
          if (meta) toast(`ดาวน์โหลดแล้ว · ${meta.filename}`);
        } catch (err) { toastError(err); }
      }
    }),
  ];
  load();
  return () => offs.forEach((f) => f());
}
