// ════════════════════════════════════════════════════════════════════
//  core.js — เชื่อม Supabase (ล็อกอิน / RPC / ไฟล์ / Excel) + ตัวช่วยจัดรูปแบบ
//  หน้าเพจเรียกผ่าน api.* เท่านั้น ไม่เรียก supabase ตรง
// ════════════════════════════════════════════════════════════════════
export const cfg = window.EXION_CONFIG || {};
const MOCK = !!cfg.MOCK_URL;
let sb = null;
export const state = { session: null, profile: null, app: 'expense', cats: null, pettyCats: null };

// ─────────────── เริ่มระบบ ───────────────
export async function initClient() {
  // ลิงก์จากอีเมล "ตั้งรหัสผ่านใหม่" — อ่านค่าไว้ก่อน supabase-js ล้าง URL
  const linkHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const isRecovery = new URLSearchParams(location.search).get('recovery') === '1' || linkHash.get('type') === 'recovery';
  const linkError = linkHash.get('error_description') || linkHash.get('error');
  if (MOCK) {
    try { state.session = JSON.parse(localStorage.getItem('exion_mock_session') || 'null'); } catch { state.session = null; }
    return;
  }
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /XXXX/.test(cfg.SUPABASE_URL)) {
    throw new Error('ยังไม่ได้ตั้งค่า config.js (SUPABASE_URL / SUPABASE_ANON_KEY) — ดูคู่มือขั้นที่ 9');
  }
  if (isSecretKey(cfg.SUPABASE_ANON_KEY)) {
    throw new Error('อันตราย: config.js ใส่กุญแจลับ (secret / service_role) — เปลี่ยนเป็น publishable หรือ anon key ทันที แล้วลบกุญแจลับตัวนั้นทิ้งใน Supabase');
  }
  // ไลบรารี supabase-js เก็บไว้ในเว็บเอง (vendor/) + ตรวจลายนิ้วมือไฟล์ (integrity) ใน index.html
  const createClient = window.supabase?.createClient;
  if (!createClient) throw new Error('โหลดไลบรารีไม่สำเร็จ — รีเฟรชหน้า');
  // บัญชีที่ล็อกอินอยู่ก่อนเปิดลิงก์ (กันลิงก์ปลอมสลับเราไปอยู่ในบัญชีคนอื่น)
  let prevUid = null;
  try { prevUid = JSON.parse(localStorage.getItem('exion-auth') || 'null')?.user?.id || null; } catch { prevUid = null; }
  sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true, autoRefreshToken: true, storageKey: 'exion-auth', flowType: 'implicit',
      // รับ session จาก URL เฉพาะลิงก์ "ตั้งรหัสผ่านใหม่" ในอีเมลเท่านั้น
      detectSessionInUrl: (_url, p) => p?.type === 'recovery',
    },
    realtime: { params: { eventsPerSecond: 2 } },
  });
  let { data } = await sb.auth.getSession();
  if (isRecovery && prevUid && data.session && data.session.user.id !== prevUid) {
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    state.authNotice = 'ลิงก์นี้เป็นของบัญชีอื่น — ระบบออกจากระบบให้เพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่';
    history.replaceState(null, '', location.pathname + '#/login');
    data = { session: null };
  }
  state.session = data.session ? { uid: data.session.user.id, email: data.session.user.email } : null;
  sb.auth.onAuthStateChange((ev, s) => {
    if (ev === 'SIGNED_OUT' || !s) { state.session = null; }
    else state.session = { uid: s.user.id, email: s.user.email };
  });
  if ((isRecovery || linkError) && !state.authNotice) {
    if (linkError || !state.session) state.authNotice = 'ลิงก์ตั้งรหัสผ่านหมดอายุ หรือถูกใช้ไปแล้ว — กด "ลืมรหัสผ่าน" เพื่อขอลิงก์ใหม่';
    history.replaceState(null, '', location.pathname + (state.session && !linkError ? '#/set-password' : '#/login'));
  }
}
export const supabase = () => sb;
/** กันพลาด: ห้ามเอากุญแจลับมาใส่ในหน้าเว็บ */
function isSecretKey(k) {
  if (/^sb_secret_/.test(k)) return true;
  try { return JSON.parse(atob(String(k).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; } catch { return false; }
}

// ─────────────── เรียก Edge Function ───────────────
async function callFn(name, body, { raw = false, anon = false } = {}) {
  let url, headers = { 'Content-Type': 'application/json' };
  if (MOCK) {
    url = `${cfg.MOCK_URL}/fn/${name}`;
    if (state.session && !anon) headers['x-user'] = state.session.uid;
  } else {
    url = `${cfg.SUPABASE_URL}/functions/v1/${name}`;
    headers.apikey = cfg.SUPABASE_ANON_KEY;
    let token = cfg.SUPABASE_ANON_KEY;
    if (!anon) { const { data } = await sb.auth.getSession(); if (data.session) token = data.session.access_token; }
    headers.Authorization = 'Bearer ' + token;
  }
  let res;
  try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) }); }
  catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่'); }
  if (raw && res.ok && !(res.headers.get('content-type') || '').includes('json')) return res;
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) throw new Error(out.error || out.message || `เกิดข้อผิดพลาด (${res.status})`);
  return out;
}

// ─────────────── ล็อกอิน ───────────────
export const auth = {
  get user() { return state.session; },
  /** ลืมรหัส → {mode: 'email'|'code', message} (ตอบเหมือนกันทุกอีเมล) */
  requestReset: (email) => callFn('auth', { action: 'request_reset', email, redirectTo: location.origin + location.pathname + '?recovery=1' }, { anon: true }),
  /** ตั้งรหัสใหม่หลังกดลิงก์ในอีเมล (ใช้ session จากลิงก์) */
  resetWithSession: (password) => callFn('auth', { action: 'reset_with_session', password }),
  async login(email, password) { return applySession(await callFn('auth', { action: 'login', email, password }, { anon: true })); },
  async setPassword(email, code, password) { return applySession(await callFn('auth', { action: 'set_password', email, code, password }, { anon: true })); },
  async firstSetup(email, password) { return applySession(await callFn('auth', { action: 'first_setup', email, password }, { anon: true })); },
  issueCode: (targetEmail) => callFn('auth', { action: 'issue_code', targetEmail }),
  async logout() {
    clearCache();
    state.profile = null;
    if (MOCK) localStorage.removeItem('exion_mock_session');
    else await sb.auth.signOut().catch(() => {});
    state.session = null;
    // ล้างข้อมูลค้างในเครื่อง (ร่างบิล ฯลฯ) — เก็บไว้แค่อีเมลล่าสุดเพื่อความสะดวก
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('exion_') && k !== 'exion_last_email').forEach((k) => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch { /* */ }
  },
};
async function applySession(out) {
  const s = out.session;
  if (MOCK) {
    state.session = { uid: s.user.id, email: s.user.email };
    localStorage.setItem('exion_mock_session', JSON.stringify(state.session));
  } else {
    const { data, error } = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
    if (error) throw new Error(error.message);
    state.session = { uid: data.session.user.id, email: data.session.user.email };
  }
  clearCache();
  return out;
}

// ─────────────── RPC + แคช ───────────────
const mem = new Map();               // key → {t, d}
const inflight = new Map();
const ssKey = () => 'exc:' + (state.session?.uid || '');
function ssLoad() { try { return JSON.parse(sessionStorage.getItem(ssKey()) || '{}'); } catch { return {}; } }
let ss = null;
function ssGet(k) { ss = ss || ssLoad(); return ss[k]; }
function ssPut(k, v) {
  ss = ss || ssLoad(); ss[k] = v;
  try { sessionStorage.setItem(ssKey(), JSON.stringify(ss)); } catch { ss = {}; try { sessionStorage.removeItem(ssKey()); } catch {} }
}
export function clearCache() { mem.clear(); ss = {}; try { Object.keys(sessionStorage).filter((k) => k.startsWith('exc:')).forEach((k) => sessionStorage.removeItem(k)); } catch {} }
const keyOf = (fn, args) => fn + '?' + JSON.stringify(args || {});

let busyCount = 0;
function progress(delta) {
  busyCount = Math.max(0, busyCount + delta);
  let bar = document.getElementById('progress');
  if (!bar) { bar = document.createElement('div'); bar.id = 'progress'; bar.className = 'progress-bar'; bar.style.width = '0'; document.body.appendChild(bar); }
  if (busyCount > 0) { bar.style.opacity = '1'; bar.style.width = '70%'; }
  else { bar.style.width = '100%'; setTimeout(() => { if (!busyCount) { bar.style.opacity = '0'; bar.style.width = '0'; } }, 250); }
}

async function rawRpc(fn, args) {
  if (MOCK) {
    let res;
    try {
      res = await fetch(`${cfg.MOCK_URL}/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': state.session?.uid || '' }, body: JSON.stringify(args || {}) });
    } catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.message || 'เกิดข้อผิดพลาด');
    return out;
  }
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) {
    if (/JWT|jwt|401/.test(error.message || '') || error.code === 'PGRST301') { await auth.logout(); location.replace(location.pathname + '#/login'); location.reload(); throw new Error('หมดเวลาเข้าระบบ — กรุณาเข้าสู่ระบบใหม่'); }
    if (/Failed to fetch|NetworkError/i.test(error.message || '')) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่');
    throw new Error(error.message || 'เกิดข้อผิดพลาด');
  }
  return data;
}

export const api = {
  /**
   * เรียกฟังก์ชันในฐานข้อมูล  · ชื่อขึ้นต้น get_ = อ่าน (แคชได้ด้วย {ttl: วินาที})
   * ชื่ออื่น = เขียน → ล้างแคชทั้งหมดหลังสำเร็จ
   */
  async rpc(fn, args = {}, { ttl = 0, quiet = false } = {}) {
    const read = fn.startsWith('get_');
    const k = keyOf(fn, args);
    if (read && ttl > 0) {
      const hit = mem.get(k);
      if (hit && Date.now() - hit.t < ttl * 1000) return hit.d;
    }
    if (read && inflight.has(k)) return inflight.get(k);
    if (!quiet) progress(1);
    const p = rawRpc(fn, args).then((d) => {
      if (read) { mem.set(k, { t: Date.now(), d }); ssPut(k, d); }
      else clearCache();
      return d;
    }).finally(() => { inflight.delete(k); if (!quiet) progress(-1); });
    if (read) inflight.set(k, p);
    return p;
  },
  /**
   * โหลดแบบเร็ว: ถ้าเคยโหลด → แสดงของเดิมทันที แล้วดึงใหม่ตามหลัง (render ถูกเรียก 1–2 ครั้ง)
   * render(data, {stale}) · คืน Promise ของข้อมูลใหม่
   */
  async load(fn, args, render) {
    const k = keyOf(fn, args);
    const cached = mem.get(k)?.d ?? ssGet(k);
    let shown = null;
    if (cached !== undefined) { shown = JSON.stringify(cached); try { render(cached, { stale: true }); } catch (e) { console.error(e); } }
    const fresh = await api.rpc(fn, args);
    if (JSON.stringify(fresh) !== shown) render(fresh, { stale: false });
    return fresh;
  },
  peek(fn, args) { const k = keyOf(fn, args); return mem.get(k)?.d ?? ssGet(k); },
  invalidate: clearCache,
  fn: callFn,

  /** อัปโหลดไฟล์ → คืน path แบบเต็ม เช่น receipts/<uid>/2026-10/abc.jpg */
  async upload(file, bucket = 'receipts') {
    if (!state.session) throw new Error('กรุณาเข้าสู่ระบบ');
    const f = await compressImage(file, bucket === 'signatures' ? 1000 : 1600);
    if (f.size > 10 * 1024 * 1024) throw new Error(`ไฟล์ ${file.name || ''} ใหญ่เกิน 10MB`);
    const ext = extOf(f);
    if (!ext) throw new Error('รองรับเฉพาะรูปภาพ (JPG/PNG/HEIC) หรือ PDF');
    const now = new Date();
    const key = `${state.session.uid}/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${ext}`;
    progress(1);
    try {
      if (MOCK) {
        const r = await fetch(`${cfg.MOCK_URL}/storage/upload?path=${encodeURIComponent(bucket + '/' + key)}`, { method: 'POST', headers: { 'x-user': state.session.uid, 'Content-Type': f.type }, body: f });
        if (!r.ok) throw new Error('อัปโหลดไม่สำเร็จ');
      } else {
        const { error } = await sb.storage.from(bucket).upload(key, f, { contentType: f.type, upsert: false });
        if (error) throw new Error('อัปโหลดไม่สำเร็จ: ' + error.message);
      }
    } finally { progress(-1); }
    return `${bucket}/${key}`;
  },

  /** ลิงก์ดูไฟล์ (หมดอายุ 1 ชม.) · path = "receipts/..." หรือ "signatures/..." หรือ URL เดิม */
  async fileUrl(path) {
    if (!path) return '';
    if (/^https?:/.test(path)) return /^https:\/\/(drive|docs)\.google\.com\//.test(path) ? path : '';   // ลิงก์ Drive เดิมเท่านั้น
    if (/\.\.|\/\/|\\|%2e|%2f/i.test(path) || !/^(receipts|signatures)\//.test(path)) throw new Error('ไฟล์ไม่ถูกต้อง');
    const hit = urlCache.get(path);
    if (hit && Date.now() - hit.t < 50 * 60e3) return hit.u;
    let u;
    if (MOCK) u = `${cfg.MOCK_URL}/storage/file?path=${encodeURIComponent(path)}`;
    else {
      const i = path.indexOf('/');
      const { data, error } = await sb.storage.from(path.slice(0, i)).createSignedUrl(path.slice(i + 1), 3600);
      if (error) throw new Error('เปิดไฟล์ไม่ได้ (ไม่มีสิทธิ์ หรือไฟล์ถูกลบ)');
      u = data.signedUrl;
    }
    urlCache.set(path, { t: Date.now(), u });
    return u;
  },

  /** สร้าง Excel แล้วดาวน์โหลด · คืน meta จากเซิร์ฟเวอร์ */
  async excel(body) {
    progress(1);
    try {
      const res = await callFn('excel', body, { raw: true });
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-filename') || 'export.xlsx');
      let meta = {};
      try { meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(res.headers.get('x-meta') || ''), (c) => c.charCodeAt(0)))); } catch {}
      saveBlob(blob, name);
      return { ...meta, filename: name };
    } finally { progress(-1); }
  },

  /** แจ้งเตือนเด้งทันที (Realtime) · คืนฟังก์ชันยกเลิก */
  onNotification(cb) {
    if (MOCK || !sb || !state.session) return () => {};
    const ch = sb.channel('notif-' + state.session.uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (p) => cb(p.new))
      .subscribe();
    return () => { try { sb.removeChannel(ch); } catch {} };
  },
};
const urlCache = new Map();

export function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
}
function extOf(f) {
  const t = (f.type || '').toLowerCase(), n = (f.name || '').toLowerCase();
  if (t === 'image/jpeg' || /\.jpe?g$/.test(n)) return 'jpg';
  if (t === 'image/png' || n.endsWith('.png')) return 'png';
  if (t === 'image/webp' || n.endsWith('.webp')) return 'webp';
  if (t === 'image/heic' || t === 'image/heif' || /\.hei[cf]$/.test(n)) return 'heic';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  return '';
}
/** ย่อรูปใหญ่ก่อนอัปโหลด (ด้านยาวสุด maxSide, JPEG 0.82) — อัปเร็วขึ้นมากบนมือถือ */
export async function compressImage(file, maxSide = 1600) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '') || file.size < 350 * 1024 && !/hei[cf]/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

// ─────────────── โปรไฟล์ / หมวด ───────────────
export async function loadProfile(force = false) {
  if (state.profile && !force) return state.profile;
  state.profile = await api.rpc('get_my_profile', {}, { ttl: force ? 0 : 600 });
  return state.profile;
}
export async function loadCategories() {
  if (state.cats) return state.cats;
  state.cats = await api.rpc('get_categories', {}, { ttl: 3600 });
  return state.cats;
}
export async function loadPettyCategories() {
  if (state.pettyCats) return state.pettyCats;
  state.pettyCats = await api.rpc('get_petty_categories', {}, { ttl: 3600 });
  return state.pettyCats;
}
const CAT_TH = { FUEL: 'ค่าน้ำมัน', ENT: 'ค่ารับรอง', GOLF: 'ค่ากอล์ฟ', TOLL: 'ค่าทางด่วน', PARK: 'ค่าที่จอดรถ', HOTEL: 'ค่าที่พัก', EXPRESS: 'ค่าส่งเอกสาร',
  MILE: 'ค่าระยะทาง', CAR: 'ค่ารถ', MOBILE: 'ค่าโทรศัพท์', OVERSEAS: 'ค่าโทรต่างประเทศ', APT: 'ค่าเช่าที่พัก', TRAVEL: 'ค่าเดินทาง', OTHER: 'อื่นๆ',
  TOPUP: 'เติมเงินสดย่อย', CLEAR: 'เคลียร์บิล', COUNT: 'ปรับยอดจากการนับ' };
export function catName(code) {
  const c = String(code || '').toUpperCase();
  const hit = (state.cats || []).find((x) => x.code === c) || (state.pettyCats || []).find((x) => x.code === c);
  return hit?.name_th || CAT_TH[c] || c || '-';
}
export function catInfo(code) { return (state.cats || []).find((x) => x.code === String(code || '').toUpperCase()) || null; }

// ─────────────── สถานะ ───────────────
const ST = {
  Pending: ['รออนุมัติ', 'b-pending'], Approved: ['อนุมัติแล้ว', 'b-approved'], Rejected: ['ไม่อนุมัติ', 'b-rejected'],
  PreApprove: ['ขออนุมัติงบ', 'b-violet'], Finalized: ['ส่งบิลแล้ว', 'b-info'], Paid: ['จ่ายแล้ว', 'b-paid'], Cancelled: ['ยกเลิก', 'b-neutral'],
};
export function statusBadge(status, text) {
  const [t, c] = ST[status] || [status || '-', 'b-neutral'];
  return `<span class="badge ${c}">${esc(text || t)}</span>`;
}
/** สถานะคำขอเบิกแบบละเอียด (รวมขออนุมัติงบ) */
export function requestBadge(r) {
  if (r.status === 'PreApprove') {
    if (r.preapprove_status === 'Approved') return statusBadge('Approved', 'อนุมัติงบแล้ว · รอส่งบิล');
    if (r.preapprove_status === 'Rejected') return statusBadge('Rejected', 'ไม่อนุมัติงบ');
    return statusBadge('PreApprove', 'รออนุมัติงบ');
  }
  return statusBadge(r.status);
}
/** ขั้นของ Export: none | waiting | approved | paid | rejected */
export function exportStage(e) {
  if (!e) return 'none';
  if (e.stage) return e.stage;
  if (e.paid_at) return 'paid';
  if (e.overall_status === 'Approved') return 'approved';
  if (e.overall_status === 'Rejected') return 'rejected';
  return 'waiting';
}

// ─────────────── จัดรูปแบบ ───────────────
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
/** 1234.5 → "1,234.50" · money(x, 0) → "1,235" */
export function money(n, digits = 2) { const v = Number(n) || 0; return digits === 0 ? nf0.format(v) : nf2.format(v); }
/** "฿1,234.50" */
export function baht(n, digits = 2) { return '฿' + money(n, digits); }
/** ย่อเลขใหญ่: 1.2 ล้าน / 45.3K */
export function compact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + ' ล้าน';
  if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return money(v, 0);
}
export const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function toDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); }
  const x = new Date(d); return isNaN(x) ? null : x;
}
/** "29 ก.ย. 69" (ปี พ.ศ. 2 หลัก) · fmtDate(d, {year:false}) ไม่แสดงปี · {full:true} ปีเต็ม */
export function fmtDate(d, { year = true, full = false } = {}) {
  const x = toDate(d); if (!x) return '-';
  const y = x.getFullYear() + 543;
  return `${x.getDate()} ${TH_MONTHS[x.getMonth()]}${year ? ' ' + (full ? y : String(y).slice(-2)) : ''}`;
}
export function fmtDateTime(d) {
  const x = toDate(d); if (!x) return '-';
  return `${fmtDate(x)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}
/** "เมื่อสักครู่ / 5 นาทีที่แล้ว / 3 ชม. / 2 วัน / วันที่" */
export function timeAgo(d) {
  const x = toDate(d); if (!x) return '';
  const s = (Date.now() - x.getTime()) / 1000;
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
  if (s < 86400) return Math.floor(s / 3600) + ' ชม.ที่แล้ว';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' วันที่แล้ว';
  return fmtDate(x);
}
export function monthLabel(y, m, full = false) { return `${(full ? TH_MONTHS_FULL : TH_MONTHS)[m - 1]} ${Number(y) + 543}`; }
/** วันที่วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export function todayYMD() { return ymd(new Date()); }
export function ymd(d) {
  const x = toDate(d); if (!x) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function addDays(d, n) { const x = toDate(d); x.setDate(x.getDate() + n); return ymd(x); }
export function initials(name) {
  const s = String(name || '?').trim();
  // ข้ามวงเล็บ/เครื่องหมาย และสระหน้า (เ แ โ ใ ไ) เช่น "Air (Manager)" → AM · "สมชาย (เซลล์)" → สซ
  const parts = s.split(/\s+/).map((p) => p.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^[เแโใไ]/, '')).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || s).slice(0, 2)).toUpperCase();
}
export function roleLabel(role) {
  if (!role) return 'พนักงาน';
  if (role.isCEO) return 'CEO';
  if (role.isGM) return 'ผู้จัดการทั่วไป';
  if (role.isAccountant) return 'ฝ่ายบัญชี';
  if (role.isSenior) return 'ผู้บริหาร';
  if (role.isManager) return 'หัวหน้าทีม';
  if (role.isViewer) return 'ผู้ดูรายงาน';
  return 'พนักงาน';
}
export const MOCK_MODE = MOCK;

/** กติการหัสผ่านใหม่ (ตรงกับฝั่งเซิร์ฟเวอร์) → ข้อความผิด หรือ null ถ้าผ่าน */
export function passwordProblem(pw, email = '') {
  if (!pw || pw.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  if (pw.length > 72) return 'รหัสผ่านยาวเกินไป (ไม่เกิน 72 ตัว)';
  if (!/[0-9]/.test(pw) || !/[A-Za-z\u0E00-\u0E7F]/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 3 && pw.toLowerCase().includes(local)) return 'รหัสผ่านห้ามมีชื่ออีเมลของคุณอยู่ข้างใน';
  return null;
}
