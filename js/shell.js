// ════════════════════════════════════════════════════════════════════
//  shell.js — โครงหน้าแอป (เมนูข้าง / แถบล่าง / กระดิ่ง) + ตัวเปลี่ยนหน้า (hash router)
//  เพิ่มหน้าใหม่: ใส่ใน ROUTES แล้วสร้างไฟล์ js/pages/<ชื่อ>.js ที่ export render(ctx)
// ════════════════════════════════════════════════════════════════════
import { api, auth, state, loadProfile, loadCategories, esc, initials, roleLabel, timeAgo, cfg, MOCK_MODE } from './core.js';
import { icon, sheet, toast, errorBox, skeleton, $ } from './ui.js';

const r = (p) => p || {};
const isApprover = (p) => r(p.role).isManager || r(p.role).isSenior || r(p.role).isGM;
const ROUTES = [
  // ── เบิกค่าใช้จ่าย ──
  { path: '/', page: 'home', title: 'หน้าแรก', app: 'expense', nav: 'home', icon: 'home' },
  { path: '/submit', page: 'submit', title: 'ขอเบิกค่าใช้จ่าย', app: 'expense', nav: 'submit', icon: 'plus-circle' },
  { path: '/requests', page: 'requests', title: 'คำขอของฉัน', app: 'expense', nav: 'requests', icon: 'receipt' },
  { path: '/preapprovals', page: 'preapprovals', title: 'ขออนุมัติงบล่วงหน้า', app: 'expense', nav: 'preapprovals', icon: 'shield' },
  { path: '/preapprovals/new', page: 'preapprove-new', title: 'ขออนุมัติงบ', app: 'expense', nav: 'preapprovals', back: '/preapprovals' },
  { path: '/preapprovals/:id/finalize', page: 'finalize', title: 'ส่งบิลจริง', app: 'expense', nav: 'preapprovals', back: '/preapprovals' },
  { path: '/approvals', page: 'approvals', title: 'รออนุมัติ', app: 'expense', nav: 'approvals', icon: 'inbox', show: (p, b) => isApprover(p) || b.approvals > 0 },
  { path: '/export/:id', page: 'export', title: 'ตรวจคำขอเบิกรายเดือน', app: 'expense', nav: 'approvals', back: '/approvals' },
  { path: '/team', page: 'team', title: 'ทีมของฉัน', app: 'expense', nav: 'team', icon: 'users', show: (p) => isApprover(p) },
  { path: '/all', page: 'all', title: 'คำขอทั้งบริษัท', app: 'expense', nav: 'all', icon: 'layers', show: (p) => r(p.role).canViewAll || r(p.role).isViewer || r(p.role).isAccountant },
  { path: '/summary', page: 'summary', title: 'สรุป & Excel', app: 'expense', nav: 'summary', icon: 'chart' },
  { path: '/insights', page: 'insights', title: 'แดชบอร์ดลูกค้า', app: 'expense', nav: 'insights', icon: 'trending', show: (p) => r(p.role).canViewAll || r(p.role).isManager },
  { path: '/accounting', page: 'accounting', title: 'บัญชี · โอนเงิน', app: 'expense', nav: 'accounting', icon: 'banknote', show: (p) => r(p.role).isAccountant || r(p.role).isGM },
  { path: '/ceo', page: 'ceo', title: 'อนุมัติสรุปรายเดือน', app: 'expense', nav: 'ceo', icon: 'crown', show: (p) => r(p.role).isCEO },
  { path: '/set-password', page: 'set-password', title: 'ตั้งรหัสผ่านใหม่', app: 'expense', nav: 'profile' },
  { path: '/profile', page: 'profile', title: 'โปรไฟล์ & ขอเบิกรายเดือน', app: 'expense', nav: 'profile', icon: 'user' },
  // ── เงินสดย่อย ──
  { path: '/petty', page: 'petty-home', title: 'เงินสดย่อย', app: 'petty', nav: 'p-home', icon: 'home' },
  { path: '/petty/request', page: 'petty-request', title: 'ขอเบิกเงินสดย่อย', app: 'petty', nav: 'p-request', icon: 'plus-circle' },
  { path: '/petty/list', page: 'petty-list', title: 'รายการเงินสดย่อย', app: 'petty', nav: 'p-list', icon: 'list' },
  { path: '/petty/approve', page: 'petty-approve', title: 'รออนุมัติ / รอจ่าย', app: 'petty', nav: 'p-approve', icon: 'inbox',
    show: (p, b) => p.isPettyHolder || r(p.role).isGM || r(p.role).isAccountant || r(p.role).isManager || b.petty > 0 },
  { path: '/petty/fund', page: 'petty-fund', title: 'กล่องเงินสด', app: 'petty', nav: 'p-fund', icon: 'wallet',
    show: (p) => p.isPettyHolder || r(p.role).isAccountant || r(p.role).isGM || r(p.role).canViewAll },
  { path: '/petty/msbc', page: 'petty-msbc', title: 'ตาราง MSBC', app: 'petty', nav: 'p-msbc', icon: 'sheet', show: (p) => r(p.role).isAccountant || r(p.role).isGM || p.isPettyHolder },
  { path: '/petty/profile', page: 'profile', title: 'โปรไฟล์', app: 'petty', nav: 'p-profile', icon: 'user' },
];
// ลิงก์จากระบบเดิม (*.html) → หน้าใหม่
const LEGACY = { 'index.html': '/', 'submit.html': '/submit', 'status.html': '/requests', 'inbox.html': '/approvals', 'manager-inbox.html': '/approvals',
  'senior-inbox.html': '/approvals', 'pre-approve.html': '/preapprovals/new', 'pre-approves.html': '/preapprovals', 'finalize-claim.html': '/preapprovals',
  'profile.html': '/profile', 'my-team.html': '/team', 'all-requests.html': '/all', 'summary.html': '/summary', 'accounting.html': '/accounting',
  'ceo-approve.html': '/ceo', 'pc-home.html': '/petty', 'pc-request.html': '/petty/request', 'pc-list.html': '/petty/list', 'pc-approve.html': '/petty/approve',
  'pc-fund.html': '/petty/fund', 'pc-msbc.html': '/petty/msbc', 'reset-password.html': '/login' };

const badges = { approvals: 0, petty: 0, notif: 0 };
let current = null, renderSeq = 0, stopRealtime = null;

function parseHash() {
  let h = location.hash.replace(/^#/, '') || '/';
  if (!h.startsWith('/')) h = '/' + h;
  const [path, qs] = h.split('?');
  return { path: path.replace(/\/+$/, '') || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function match(path) {
  for (const rt of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + rt.path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(re);
    if (m) {
      const dec = (x) => { try { return decodeURIComponent(x); } catch { return null; } };
      const params = Object.fromEntries(keys.map((k, i) => [k, dec(m[i + 1])]));
      if (Object.values(params).some((v) => v == null)) return null;
      return { rt, params };
    }
  }
  return null;
}
export function go(path) { if (location.hash !== '#' + path) location.hash = '#' + path; else route(); }

// ─────────────── เริ่มแอป ───────────────
export async function start() {
  // ลิงก์เก่า เช่น .../status.html หรือ ?page=export-review.html&id=..
  const legacy = new URLSearchParams(location.search).get('legacy');
  if (legacy) {
    const id = new URLSearchParams(location.search).get('id');
    const to = legacy === 'export-review.html' && id ? '/export/' + encodeURIComponent(id)
      : legacy === 'finalize-claim.html' && id ? '/preapprovals/' + encodeURIComponent(id) + '/finalize'
      : (LEGACY[legacy] || '/');
    history.replaceState(null, '', location.pathname + '#' + to);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => $('.offline-banner')?.remove());
  window.addEventListener('offline', () => { if (!$('.offline-banner')) document.body.insertAdjacentHTML('beforeend', '<div class="offline-banner">ออฟไลน์ — ตรวจอินเทอร์เน็ต</div>'); });
  await route();
}

async function route() {
  const seq = ++renderSeq;
  // ปิดหน้าต่าง/รูปที่เปิดค้างจากหน้าก่อน
  document.querySelectorAll('.backdrop, .lightbox').forEach((x) => x.remove());
  document.body.style.overflow = '';
  closeBell();
  const { path, query } = parseHash();
  const app = document.getElementById('app');
  if (!auth.user) {
    closeBell();
    const m = await import('./pages/login.js');
    if (seq !== renderSeq) return;
    document.title = 'เข้าสู่ระบบ · EXION Expense';
    return m.render({ el: app, query, go, onLoggedIn: () => { const back = sessionStorage.getItem('exion_after_login'); sessionStorage.removeItem('exion_after_login'); go(back && back !== '/login' ? back : '/'); } });
  }
  if (path === '/login') return go('/');
  const hit = match(path);
  if (!hit) return go('/');
  let profile;
  try { profile = await loadProfile(); loadCategories().catch(() => {}); }
  catch (e) {
    if (seq !== renderSeq) return;
    if (/ไม่พบพนักงาน|ไม่ได้เปิดใช้งาน|ผูก/.test(e.message)) { await auth.logout(); toast(e.message, 'bad'); return go('/login'); }
    app.innerHTML = `<div class="main">${''}</div>`; errorBox(app.firstChild, e, () => route()); return;
  }
  const { rt, params } = hit;
  if (rt.show && !rt.show(profile, badges) && !rt.path.includes(':')) {
    // ไม่มีสิทธิ์หน้านี้ → กลับหน้าแรกของแอป
    if (!(rt.nav === 'approvals' || rt.nav === 'p-approve')) return go(rt.app === 'petty' ? '/petty' : '/');
  }
  state.app = rt.app;
  try { localStorage.setItem('exion_app', rt.app); } catch {}
  renderShell(app, rt, profile);
  const main = document.getElementById('main');
  main.innerHTML = skeleton(4);
  document.title = `${rt.title} · EXION`;
  setTitle(rt.title);
  window.scrollTo(0, 0);
  if (typeof current?.cleanup === 'function') { try { current.cleanup(); } catch {} }
  current = null;
  try {
    const mod = await import(`./pages/${rt.page}.js`);
    if (seq !== renderSeq) return;
    main.innerHTML = '';
    const ctx = { el: main, params, query, profile, go, setTitle, refreshBadges, alive: () => seq === renderSeq, app: rt.app };
    const cleanup = await mod.render(ctx);
    if (seq === renderSeq) current = { cleanup };
  } catch (e) {
    console.error(e);
    if (seq === renderSeq) errorBox(main, e, () => route());
  }
}

function setTitle(t) { const el = document.getElementById('top-title'); if (el) el.textContent = t; }

// ─────────────── โครงหน้า ───────────────
let shellKey = '';
function navItems(app, profile) {
  return ROUTES.filter((x) => x.app === app && x.icon && (!x.show || x.show(profile, badges)));
}
function renderShell(root, rt, profile) {
  const key = rt.app + '|' + profile.email + '|' + JSON.stringify(badges) + '|' + navItems(rt.app, profile).map((x) => x.nav).join(',');
  if (shellKey !== key || !document.getElementById('main')) {
    shellKey = key;
    const items = navItems(rt.app, profile);
    const cnt = (x) => (x.nav === 'approvals' ? badges.approvals : x.nav === 'p-approve' ? badges.petty : 0);
    const side = items.map((x) => `<a class="side-link" data-nav="${x.nav}" href="#${x.path}">${icon(x.icon)}<span>${esc(x.title)}</span>${cnt(x) ? `<span class="cnt">${cnt(x)}</span>` : ''}</a>`).join('');
    const company = esc(profile.company || cfg.COMPANY_NAME || 'Exion Thailand');
    root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="side-brand"><div class="logo-mark is-img"><img src="brand/mark.png" alt="EXION"></div><div><div class="t1">EXION Expense</div><div class="t2">${company}</div></div></div>
        ${profile.pettyEnabled !== false ? `<div class="app-switch"><a href="#/" class="${rt.app === 'expense' ? 'on' : ''}">เบิกค่าใช้จ่าย</a><a href="#/petty" class="${rt.app === 'petty' ? 'on' : ''}">เงินสดย่อย</a></div>` : ''}
        <div class="side-section">เมนู</div>
        ${side}
        <div class="side-foot">
          <button class="user-chip" data-usermenu><span class="avatar sm brand">${esc(initials(profile.name))}</span>
            <span class="grow"><span class="bold ellipsis" style="display:block">${esc(profile.name)}</span><span class="text-xs muted">${esc(roleLabel(profile.role))}</span></span>${icon('more')}</button>
        </div>
      </aside>
      <div class="content">
        <header class="topbar">
          <button class="btn-icon back hide-desktop ${rt.back ? '' : 'hidden'}" data-back aria-label="ย้อนกลับ">${icon('chevron-left')}</button>
          <div class="brand-mini hide-desktop ${rt.back ? 'hidden' : ''}"><div class="logo-mark is-img" style="width:32px;height:32px"><img src="brand/mark.png" alt="EXION"></div></div>
          <div class="title" id="top-title"></div>
          <button class="btn-icon" data-bell aria-label="การแจ้งเตือน">${icon('bell')}<span class="bell-dot ${badges.notif ? '' : 'hidden'}" id="bell-dot">${badges.notif > 99 ? '99+' : badges.notif}</span></button>
          <button class="btn-icon hide-desktop" data-usermenu aria-label="บัญชี"><span class="avatar sm brand">${esc(initials(profile.name))}</span></button>
        </header>
        <main class="main" id="main"></main>
      </div>
      ${bottomNav(rt, profile)}
    </div>`;
    root.querySelector('[data-bell]').onclick = (e) => { e.stopPropagation(); toggleBell(); };
    root.querySelectorAll('[data-usermenu]').forEach((b) => (b.onclick = () => userMenu(profile)));
    root.querySelector('[data-back]').onclick = () => (history.length > 1 ? history.back() : go(rt.back || '/'));
    root.querySelector('[data-more]')?.addEventListener('click', () => moreMenu(rt, profile));
    startBackground(profile);
  }
  // ไฮไลต์เมนูปัจจุบัน + ปุ่มย้อนกลับ
  root.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === rt.nav));
  root.querySelector('[data-back]').classList.toggle('hidden', !rt.back);
  root.querySelector('.brand-mini').classList.toggle('hidden', !!rt.back);
  root.querySelector('[data-back]').onclick = () => (history.length > 1 ? history.back() : go(rt.back || '/'));
}
function bottomNav(rt, profile) {
  const a = (nav, href, ic, label, badge = 0) => `<a href="#${href}" data-nav="${nav}">${icon(ic)}<span>${label}</span>${badge ? `<span class="nav-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</a>`;
  const fab = (href, nav) => `<a href="#${href}" class="fab" data-nav="${nav}"><span class="fab-btn">${icon('plus')}</span></a>`;
  const more = `<button data-more>${icon('grid')}<span>เมนู</span></button>`;
  if (rt.app === 'petty') {
    const showApprove = ROUTES.find((x) => x.nav === 'p-approve').show(profile, badges);
    return `<nav class="bottom-nav">${a('p-home', '/petty', 'home', 'หน้าแรก')}${a('p-list', '/petty/list', 'list', 'รายการ')}${fab('/petty/request', 'p-request')}
      ${showApprove ? a('p-approve', '/petty/approve', 'inbox', 'รออนุมัติ', badges.petty) : a('p-profile', '/petty/profile', 'user', 'โปรไฟล์')}${more}</nav>`;
  }
  const appr = isApprover(profile) || badges.approvals > 0;
  return `<nav class="bottom-nav">${a('home', '/', 'home', 'หน้าแรก')}${a('requests', '/requests', 'receipt', 'คำขอ')}${fab('/submit', 'submit')}
    ${appr ? a('approvals', '/approvals', 'inbox', 'อนุมัติ', badges.approvals) : a('profile', '/profile', 'user', 'โปรไฟล์')}${more}</nav>`;
}
function moreMenu(rt, profile) {
  const items = navItems(rt.app, profile);
  const s = sheet({
    title: 'เมนูทั้งหมด',
    body: `${profile.pettyEnabled !== false ? `<div class="app-switch mb-16"><a href="#/" class="${rt.app === 'expense' ? 'on' : ''}">เบิกค่าใช้จ่าย</a><a href="#/petty" class="${rt.app === 'petty' ? 'on' : ''}">เงินสดย่อย</a></div>` : ''}
      <div class="tiles">${items.map((x) => `<a class="tile" href="#${x.path}"><span class="row-icon ${x.nav === rt.nav ? 'c-red' : ''}">${icon(x.icon)}</span><span>${esc(x.title)}</span></a>`).join('')}</div>
      <div class="divider"></div>
      <button class="btn btn-secondary btn-block" data-logout>${icon('logout')} ออกจากระบบ</button>`,
  });
  s.el.addEventListener('click', (e) => { if (e.target.closest('a')) s.close(); });
  s.el.querySelector('[data-logout]').onclick = async () => { s.close(); await logout(); };
}
function userMenu(profile) {
  const s = sheet({
    title: 'บัญชีของฉัน',
    body: `<div class="flex gap-12 mb-16"><span class="avatar lg brand">${esc(initials(profile.name))}</span><div class="grow">
        <div class="bold text-lg">${esc(profile.fullName || profile.name)}</div><div class="muted text-sm">${esc(profile.email)}</div>
        <div class="flex wrap mt-4"><span class="badge b-brand plain">${esc(roleLabel(profile.role))}</span>${profile.department ? `<span class="badge plain">${esc(profile.department)}</span>` : ''}</div></div></div>
      <div class="list card">
        <a class="row" href="#${state.app === 'petty' ? '/petty/profile' : '/profile'}">${icon('user')}<span class="grow">โปรไฟล์ · ลายเซ็น · ขอเบิกรายเดือน</span>${icon('chevron-right')}</a>
        <a class="row" href="#${state.app === 'petty' ? '/' : '/petty'}">${icon(state.app === 'petty' ? 'receipt' : 'wallet')}<span class="grow">สลับไป${state.app === 'petty' ? 'เบิกค่าใช้จ่าย' : 'เงินสดย่อย'}</span>${icon('chevron-right')}</a>
        <button class="row click" data-logout>${icon('logout')}<span class="grow">ออกจากระบบ</span></button>
      </div>${MOCK_MODE ? '<p class="hint mt-12">โหมดทดสอบ (ข้อมูลจำลอง)</p>' : ''}`,
  });
  s.el.addEventListener('click', (e) => { if (e.target.closest('a')) s.close(); });
  s.el.querySelector('[data-logout]').onclick = async () => { s.close(); await logout(); };
}
async function logout() {
  stopRealtime?.(); stopRealtime = null; clearInterval(pollT); shellKey = '';
  await auth.logout();
  go('/login');
}

// ─────────────── ตัวเลขบนเมนู + แจ้งเตือน ───────────────
let pollT = null, bgFor = '';
function startBackground(profile) {
  if (bgFor === profile.email) return;
  bgFor = profile.email;
  refreshBadges();
  clearInterval(pollT);
  pollT = setInterval(() => { if (!document.hidden) refreshBadges(); }, MOCK_MODE ? 60e3 : 120e3);
  stopRealtime?.();
  stopRealtime = api.onNotification((n) => {
    toast(n.title || 'มีการแจ้งเตือนใหม่', 'info');
    refreshBadges();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadges(); });
}
export async function refreshBadges() {
  const p = state.profile; if (!p) return;
  const before = JSON.stringify(badges);
  const jobs = [api.rpc('get_notifications', {}, { quiet: true }).then((n) => { badges.notif = (n.items || []).filter((x) => x.unread).length; notifCache = n; })];
  if (isApprover(p) || p.role?.isGM) {
    jobs.push(Promise.all([api.rpc('get_pending_approvals', {}, { quiet: true }), api.rpc('get_export_approval_inbox', {}, { quiet: true }).catch(() => [])])
      .then(([a, b]) => { badges.approvals = (a?.length || 0) + (b?.filter?.((x) => x.can_approve !== false).length || 0); }));
  }
  if (p.pettyEnabled !== false && (p.isPettyHolder || p.role?.isGM || p.role?.isAccountant || p.role?.isManager)) {
    jobs.push(api.rpc('get_petty_inbox', {}, { quiet: true }).then((x) => { badges.petty = (x?.toApprove?.length || 0) + (x?.toPay?.length || 0); }).catch(() => {}));
  }
  await Promise.allSettled(jobs);
  if (JSON.stringify(badges) !== before) {
    const dot = document.getElementById('bell-dot');
    if (dot) { dot.textContent = badges.notif > 99 ? '99+' : badges.notif; dot.classList.toggle('hidden', !badges.notif); }
    const cur = match(parseHash().path);
    if (cur && document.getElementById('main')) {   // อัปเดตตัวเลขบนเมนูโดยไม่วาดหน้าใหม่
      document.querySelectorAll('[data-nav="approvals"],[data-nav="p-approve"]').forEach((a) => {
        const n = a.dataset.nav === 'approvals' ? badges.approvals : badges.petty;
        let b = a.querySelector('.cnt, .nav-badge');
        if (!n) { b?.remove(); return; }
        if (!b) { b = document.createElement('span'); b.className = a.classList.contains('side-link') ? 'cnt' : 'nav-badge'; a.appendChild(b); }
        b.textContent = n > 99 ? '99+' : n;
      });
    }
  }
}
let notifCache = null, bellEl = null;
function closeBell() { bellEl?.remove(); bellEl = null; document.removeEventListener('click', outside); }
const outside = (e) => { if (bellEl && !bellEl.contains(e.target)) closeBell(); };
async function toggleBell() {
  if (bellEl) return closeBell();
  bellEl = document.createElement('div');
  bellEl.className = 'notif-panel';
  bellEl.innerHTML = `<div class="np-head"><b>การแจ้งเตือน</b><button class="btn btn-ghost btn-sm" data-readall>อ่านทั้งหมด</button></div><div class="np-list"><div class="empty"><span class="spin"></span></div></div>`;
  document.body.appendChild(bellEl);
  setTimeout(() => document.addEventListener('click', outside), 0);
  const list = bellEl.querySelector('.np-list');
  const paint = (n) => {
    const items = n.items || [];
    list.innerHTML = items.length ? items.map((x) => `<div class="np-item ${x.unread ? 'unread' : ''}" data-id="${esc(x.id)}" data-link="${esc(x.link || '')}">
      <span class="dot"></span><div class="grow"><div class="t">${esc(x.title)}</div>${x.body ? `<div class="b">${esc(x.body)}</div>` : ''}<div class="w">${esc(timeAgo(x.created_at))}</div></div></div>`).join('')
      : `<div class="empty">${icon('bell')}<p class="mt-8">ยังไม่มีการแจ้งเตือน</p></div>`;
  };
  if (notifCache) paint(notifCache);
  try { notifCache = await api.rpc('get_notifications', {}, { quiet: true }); if (bellEl) paint(notifCache); } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  bellEl?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-readall]')) {
      await api.rpc('mark_notifications_read', {}).catch(() => {});
      badges.notif = 0; notifCache?.items?.forEach((x) => (x.unread = false)); paint(notifCache || {}); refreshBadges(); return;
    }
    const it = e.target.closest('.np-item'); if (!it) return;
    api.rpc('mark_notifications_read', { p_id: it.dataset.id }).then(refreshBadges).catch(() => {});
    closeBell();
    const link = it.dataset.link;
    if (link && link.startsWith('#/')) location.hash = link;
  });
}
