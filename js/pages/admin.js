// ผู้ดูแลระบบ (ADMIN_EMAIL) — ดูคนที่ขอรีเซ็ตรหัส · ออกรหัสชั่วคราว (ผู้ดูแลระบบเท่านั้น) · ล้างรหัส · กรอกราคาน้ำมัน (วันที่ 20 ของทุกเดือน)
import { api, esc, money, timeAgo, fmtDate, fmtDateTime, todayYMD } from '../core.js?v=10.4.3';
import { icon, toast, toastError, confirmBox, withBtn, empty, errorBox, skeleton, on, debounce } from '../ui.js?v=10.4.3';
import { issueCode } from './team.js?v=10.4.3';

export async function render(ctx) {
  const { el } = ctx;
  const st = { q: '', list: null };
  el.innerHTML = `<div class="page-head compact"><div><h1>ผู้ดูแลระบบ</h1><div class="sub">รหัสผ่านพนักงาน · ทุกการกระทำถูกบันทึกและแจ้งเจ้าของบัญชี + GM</div></div></div>
    <div class="stack"><div id="ad-gas"></div><div id="ad-recent"></div>
      <div class="card"><div class="card-head"><h3>${icon('users')} พนักงานทั้งหมด</h3></div>
        <div class="pad-x pb-8"><input class="input" id="ad-q" placeholder="ค้นหาชื่อ / อีเมล" autocomplete="off"></div>
        <div id="ad-list">${skeleton(5)}</div></div></div>`;
  const $ = (id) => el.querySelector('#' + id);

  // ── ราคาน้ำมัน (แก๊สโซฮอล 95) — ใช้ราคาวันที่ 20 ของรอบคิดค่าน้ำมันทั้งรอบ ──
  async function loadGas() {
    try { const g = await api.rpc('get_gas_prices'); if (ctx.alive()) paintGas(g); }
    catch (e) { if (ctx.alive()) $('ad-gas').innerHTML = ''; }
  }
  function paintGas(g) {
    const need = g.anchorDue && g.anchorPrice == null;
    const def = g.anchorDue ? g.anchor : todayYMD();
    $('ad-gas').innerHTML = `<div class="card pad stack-sm">
      <div class="flex between wrap"><h3>${icon('fuel')} ราคาน้ำมัน (แก๊สโซฮอล 95)</h3>
        <span class="text-sm muted">ปัจจุบัน ${g.current != null ? money(g.current) + ' บาท/ลิตร' : '-'}</span></div>
      ${need ? `<div class="alert warn">${icon('alert')}<div>ยังไม่ได้กรอกราคาของวันที่ <b>${esc(fmtDate(g.anchor, { full: true }))}</b> — ค่าน้ำมันของรอบนี้คิดจากราคาวันนี้</div></div>` : ''}
      <div class="hint">ระบบคิดค่าน้ำมันทั้งรอบจาก<b>ราคาวันที่ 20</b> · ดูราคาจากป้ายราคา ปตท. แล้วกรอกที่นี่ (ระบบไม่ดึงจากเว็บเองแล้ว) · บันทึกแล้วค่าน้ำมันที่ยังไม่ปิดรอบคำนวณใหม่ทันที</div>
      <div class="flex wrap gap-8" style="align-items:flex-start">
        <div class="field" style="margin:0"><label for="gp-d">วันที่ของราคา</label><input type="date" class="input" id="gp-d" value="${esc(def)}" max="${esc(todayYMD())}"></div>
        <div class="field" style="margin:0"><label for="gp-p">ราคา (บาท/ลิตร)</label><input type="number" class="input" id="gp-p" inputmode="decimal" step="0.01" min="25" max="50" placeholder="เช่น 32.45" style="width:160px"></div>
        <button type="button" class="btn btn-primary" data-gas style="margin-top:24px">${icon('check', 'sm')} บันทึกราคา</button></div>
      ${(g.rows || []).length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>วันที่</th><th class="r">ราคา</th><th>ที่มา</th></tr></thead><tbody>
        ${g.rows.map((r) => `<tr><td>${esc(fmtDate(r.date))}${r.date === g.anchor ? ' <span class="badge b-info plain">วันที่ 20</span>' : ''}</td><td class="r">${money(r.price)}</td><td class="text-sm muted">${esc(r.source || '')}</td></tr>`).join('')}
      </tbody></table></div>` : ''}</div>`;
  }

  async function load() {
    try { st.list = await api.rpc('admin_staff_list', { p_q: st.q }); if (ctx.alive()) paint(); }
    catch (e) { if (ctx.alive()) errorBox($('ad-list'), e, load); }
  }
  function badges(p) {
    const b = [];
    if (!p.active) b.push('<span class="badge b-neutral">ปิดใช้งาน</span>');
    if (p.activeCode) b.push('<span class="badge b-pending">มีรหัสชั่วคราวค้าง</span>');
    if (p.linked || p.hasPassword) b.push('<span class="badge b-approved plain">เข้าระบบแล้ว</span>');
    else if (p.legacy) b.push('<span class="badge b-info plain">ยังใช้รหัสเดิม</span>');
    else b.push('<span class="badge b-neutral plain">ยังไม่มีรหัส</span>');
    return b.join(' ');
  }
  function row(p) {
    return `<div class="row"><div class="row-main">
        <div class="row-title">${esc(p.name)} <span class="muted text-sm">· ${esc(p.fullName || '')}</span></div>
        <div class="row-sub">${esc(p.email)} · ${esc(p.department || '-')}${p.manager ? ' · หัวหน้า ' + esc(p.manager) : ''}</div>
        <div class="row-sub">${badges(p)}${p.reset_at ? ` <span class="warn-text">· ขอรีเซ็ต ${esc(timeAgo(p.reset_at))}</span>` : ''}</div></div>
      <div class="row-end"><div class="flex gap-4 wrap" style="justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" data-code="${esc(p.email)}" ${p.active ? '' : 'disabled'}>${icon('key', 'sm')} รหัสชั่วคราว</button>
        <button class="btn btn-danger btn-sm" data-clear="${esc(p.email)}" ${p.active ? '' : 'disabled'}>ล้างรหัส</button></div></div></div>`;
  }
  function paint() {
    const list = st.list || [];
    const recent = list.filter((p) => p.reset_at);
    $('ad-recent').innerHTML = recent.length && !st.q ? `<div class="card"><div class="card-head"><h3>${icon('bell')} ขอรีเซ็ตรหัสล่าสุด (14 วัน)</h3><span class="text-sm muted">${recent.length} คน</span></div>
      <div class="list">${recent.map(row).join('')}</div></div>` : '';
    $('ad-list').innerHTML = list.length ? `<div class="list">${list.map(row).join('')}</div>` : empty({ ic: 'users', title: 'ไม่พบพนักงาน' });
  }
  const find = (email) => (st.list || []).find((p) => p.email === email);
  const offs = [
    on(el, 'input', '#ad-q', debounce((e, t) => { st.q = t.value; load(); }, 300)),
    on(el, 'click', '[data-code]', async (e, t) => { const p = find(t.dataset.code); if (p) { await issueCode(p, t); load(); } }),
    on(el, 'click', '[data-gas]', async (e, t) => {
      const d = $('gp-d').value, p = Number($('gp-p').value);
      if (!d || !(p >= 25 && p <= 50)) { toast('ใส่วันที่ และราคา 25–50 บาท/ลิตร', 'bad'); return; }
      if (!(await confirmBox({ title: 'บันทึกราคาน้ำมัน', message: `วันที่ ${fmtDate(d, { full: true })} · ${money(p)} บาท/ลิตร\nค่าน้ำมันที่ยังไม่ปิดรอบจะคำนวณใหม่ และแจ้งพนักงานที่ยอดเปลี่ยน`, ok: 'บันทึก' }))) return;
      try { const r = await withBtn(t, () => api.rpc('admin_set_gas_price', { p_date: d, p_price: p })); toast(`บันทึกแล้ว · ปรับค่าน้ำมัน ${r.recalculated} รายการ`); loadGas(); }
      catch (err) { toastError(err); }
    }),
    on(el, 'click', '[data-clear]', async (e, t) => {
      const p = find(t.dataset.clear); if (!p) return;
      const btn = t;
      const ok = await confirmBox({ title: 'ล้างรหัสผ่าน?', danger: true, ok: 'ล้างรหัส',
        message: `${p.fullName || p.name} (${p.email})\n\nรหัสเดิมและทุกเครื่องที่ล็อกอินค้างจะใช้ไม่ได้ทันที — แจ้งเจ้าตัวให้กด "ลืมรหัสผ่าน" แล้วตั้งรหัสใหม่ทันที` });
      if (!ok) return;
      try {
        await withBtn(btn, () => api.rpc('admin_clear_password', { p_email: p.email }));
        toast(`ล้างรหัสแล้ว — กด "รหัสชั่วคราว" แล้วส่งรหัสให้ ${p.name} ตั้งรหัสใหม่`);
        load();
      } catch (err) { toastError(err); }
    }),
  ];
  load(); loadGas();
  return () => offs.forEach((f) => f());
}
