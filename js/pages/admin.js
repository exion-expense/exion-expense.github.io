// ผู้ดูแลระบบ (ADMIN_EMAIL) — ดูคนที่ขอรีเซ็ตรหัส · ออกรหัสชั่วคราว · ล้างรหัสให้ตั้งเอง (ทุกครั้งบันทึกประวัติ + แจ้งเจ้าของบัญชีและ GM)
import { api, esc, timeAgo, fmtDateTime } from '../core.js?v=10.0.16';
import { icon, toast, toastError, confirmBox, withBtn, empty, errorBox, skeleton, on, debounce } from '../ui.js?v=10.0.16';
import { issueCode } from './team.js?v=10.0.16';

export async function render(ctx) {
  const { el } = ctx;
  const st = { q: '', list: null };
  el.innerHTML = `<div class="page-head compact"><div><h1>ผู้ดูแลระบบ</h1><div class="sub">รหัสผ่านพนักงาน · ทุกการกระทำถูกบันทึกและแจ้งเจ้าของบัญชี + GM</div></div></div>
    <div class="stack"><div id="ad-recent"></div>
      <div class="card"><div class="card-head"><h3>${icon('users')} พนักงานทั้งหมด</h3></div>
        <div class="pad-x pb-8"><input class="input" id="ad-q" placeholder="ค้นหาชื่อ / อีเมล" autocomplete="off"></div>
        <div id="ad-list">${skeleton(5)}</div></div></div>`;
  const $ = (id) => el.querySelector('#' + id);

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
    on(el, 'click', '[data-clear]', async (e, t) => {
      const p = find(t.dataset.clear); if (!p) return;
      const btn = t;
      const ok = await confirmBox({ title: 'ล้างรหัสผ่าน?', danger: true, ok: 'ล้างรหัส',
        message: `${p.fullName || p.name} (${p.email})\n\nรหัสเดิมและทุกเครื่องที่ล็อกอินค้างจะใช้ไม่ได้ทันที — แจ้งเจ้าตัวให้กด "ลืมรหัสผ่าน" แล้วตั้งรหัสใหม่ทันที` });
      if (!ok) return;
      try {
        await withBtn(btn, () => api.rpc('admin_clear_password', { p_email: p.email }));
        toast(`ล้างรหัสแล้ว — ให้ ${p.name} กด "ลืมรหัสผ่าน" แล้วตั้งรหัสใหม่`);
        load();
      } catch (err) { toastError(err); }
    }),
  ];
  load();
  return () => offs.forEach((f) => f());
}
