// ════════════════════════════════════════════════════════════════════
//  ui.js — ชิ้นส่วนหน้าจอที่ใช้ร่วมกัน (dialog / toast / รูปใบเสร็จ / ลายเซ็น / ช่องว่าง)
// ════════════════════════════════════════════════════════════════════
import { icon, catIcon } from './icons.js?v=10.0.14';
import { api, esc, money, fmtDate, catName, requestBadge } from './core.js?v=10.0.14';
export { icon, catIcon, esc };

/** html`...` — ค่าที่แทรกถูก escape อัตโนมัติ · array ต่อกันให้ · raw(x) = ไม่ escape */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += fmtVal(vals[i]);
  });
  return new Raw(out);
}
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
function fmtVal(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmtVal).join('');
  return esc(v);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
/** ผูก event แบบ delegation: on(el, 'click', '[data-act=save]', (e, target) => ...) */
export function on(root, type, sel, fn) {
  const h = (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); };
  root.addEventListener(type, h);
  return () => root.removeEventListener(type, h);
}

// ─────────────── Toast ───────────────
export function toast(msg, type = 'ok') {
  let wrap = $('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = icon(type === 'ok' ? 'check-circle' : type === 'bad' ? 'alert' : 'info') + `<span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, type === 'bad' ? 5000 : 3000);
}
export const toastError = (e) => toast(e?.message || String(e), 'bad');

// ─────────────── Busy overlay (สำหรับงานที่ต้องรอ เช่น ส่งคำขอ) ───────────────
export async function busy(text, fn) {
  const el = document.createElement('div');
  el.className = 'busy';
  el.innerHTML = `<div class="box"><span class="spin"></span><div class="bold">${esc(text || 'กำลังทำงาน…')}</div></div>`;
  document.body.appendChild(el);
  try { return await fn((t) => { el.querySelector('.bold').textContent = t; }); }
  finally { el.remove(); }
}
/** ปุ่มหมุนระหว่างทำงาน: await withBtn(btn, async () => {...}) */
export async function withBtn(btn, fn) {
  if (!btn || btn.disabled) return;
  const old = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>' + (btn.dataset.busy ? esc(btn.dataset.busy) : '');
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

// ─────────────── Sheet / Dialog ───────────────
/**
 * เปิดหน้าต่าง (มือถือ = เลื่อนขึ้นจากล่าง, จอใหญ่ = กลางจอ)
 * sheet({title, body: html, foot: html, wide, onMount(el, close)}) → {el, close, done: Promise}
 */
export function sheet({ title = '', body = '', foot = '', wide = false, onMount, dismissable = true } = {}) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="btn-icon sm" data-x aria-label="ปิด">${icon('x')}</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</div>`;
  let resolve; const done = new Promise((r) => (resolve = r));
  const close = (v) => { bd.remove(); document.removeEventListener('keydown', esc_); document.body.style.overflow = ''; resolve(v); };
  const esc_ = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
  bd.addEventListener('click', (e) => { if (e.target === bd && dismissable) close(null); if (e.target.closest('[data-x]')) close(null); });
  document.addEventListener('keydown', esc_);
  document.body.appendChild(bd);
  document.body.style.overflow = 'hidden';
  const el = bd.querySelector('.sheet');
  onMount?.(el, close);
  setTimeout(() => el.querySelector('[autofocus]')?.focus(), 50);
  return { el, close, done };
}
/** ยืนยัน → true/false */
export function confirmBox({ title = 'ยืนยัน', message = '', ok = 'ยืนยัน', cancel = 'ยกเลิก', danger = false } = {}) {
  const s = sheet({
    title, body: `<p class="muted" style="white-space:pre-line">${message instanceof Raw ? message.s : esc(message)}</p>`,
    foot: `<button class="btn btn-secondary" data-x>${esc(cancel)}</button><button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-ok>${esc(ok)}</button>`,
    onMount: (el, close) => el.querySelector('[data-ok]').onclick = () => close(true),
  });
  return s.done.then((v) => !!v);
}
/** ถามข้อความ → string หรือ null (ยกเลิก) */
export function promptBox({ title = '', label = '', placeholder = '', value = '', required = false, multiline = true, ok = 'ตกลง', danger = false, hint = '' } = {}) {
  const input = multiline
    ? `<textarea class="input" id="pb" placeholder="${esc(placeholder)}" autofocus>${esc(value)}</textarea>`
    : `<input class="input" id="pb" placeholder="${esc(placeholder)}" value="${esc(value)}" autofocus>`;
  const s = sheet({
    title, body: `<div class="field">${label ? `<label class="${required ? 'req' : ''}">${esc(label)}</label>` : ''}${input}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}<div class="err-text hidden" id="pbe">กรุณากรอกข้อมูล</div></div>`,
    foot: `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-ok>${esc(ok)}</button>`,
    onMount: (el, close) => {
      const go = () => {
        const v = el.querySelector('#pb').value.trim();
        if (required && !v) { el.querySelector('#pbe').classList.remove('hidden'); el.querySelector('#pb').classList.add('invalid'); return; }
        close(v);
      };
      el.querySelector('[data-ok]').onclick = go;
      if (!multiline) el.querySelector('#pb').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    },
  });
  return s.done.then((v) => (v === undefined ? null : v));
}

// ─────────────── สถานะว่าง / ผิดพลาด / โหลด ───────────────
export function empty({ ic = 'inbox', title = 'ยังไม่มีข้อมูล', sub = '', action = '' } = {}) {
  return `<div class="empty"><div class="ic">${icon(ic)}</div><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}${action}</div>`;
}
export function errorBox(el, err, retry) {
  el.innerHTML = `<div class="card">${empty({ ic: 'alert', title: 'โหลดข้อมูลไม่สำเร็จ', sub: err?.message || String(err),
    action: retry ? `<button class="btn btn-secondary" data-retry>${icon('refresh')} ลองใหม่</button>` : '' })}</div>`;
  if (retry) el.querySelector('[data-retry]').onclick = retry;
}
export function skeleton(rows = 5) {
  return `<div class="card">${Array.from({ length: rows }, () => '<div class="skel-row"><div class="skel a"></div><div class="skel b"></div><div class="skel c"></div></div>').join('')}</div>`;
}

// ─────────────── แถวคำขอเบิก (ใช้หลายหน้า) ───────────────
/** แถวรายการเบิก 1 รายการ · opts: {who: แสดงชื่อพนักงาน, href, select: checkbox, attrs} */
export function requestRow(r, { who = false, href = '', select = false, checked = false, attrs = '' } = {}) {
  const tag = href ? 'a' : 'div';
  const desc = r.venue || r.customer || (r.origin && r.destination ? `${r.origin} → ${r.destination}` : '') || r.occasion || '';
  const km = r.mileage_km ? ` · ${money(r.mileage_km, 0)} กม.` : '';
  const files = (r.receipt_paths || []).length ? ` · ${icon('paperclip', 'sm')}${r.receipt_paths.length}` : '';
  return `<${tag} class="row ${href ? '' : 'click'}" ${href ? `href="${esc(href)}"` : ''} data-id="${esc(r.id)}" ${attrs}>
    ${select ? `<label class="check" data-stop><input type="checkbox" data-sel="${esc(r.id)}" ${checked ? 'checked' : ''}></label>` : ''}
    ${catIcon(r.category)}
    <div class="row-main">
      <div class="row-title">${who ? `${esc(r.staff_name)} · ` : ''}${esc(catName(r.category))}</div>
      <div class="row-sub">${fmtDate(r.expense_date)}${desc ? ' · ' + esc(desc) : ''}${km}${files}</div>
    </div>
    <div class="row-end"><span class="amount">${money(r.status === 'PreApprove' && r.preapprove_budget ? r.preapprove_budget : r.amount)}</span>${requestBadge(r)}</div>
  </${tag}>`;
}

// ─────────────── รูปใบเสร็จ ───────────────
/** แสดง thumbnail ของไฟล์ (โหลด signed URL ทีหลัง) — คลิกเปิด lightbox */
export function thumbs(paths = [], { removable = false } = {}) {
  if (!paths.length) return '';
  return `<div class="thumbs">${paths.map((p, i) => {
    const pdf = /\.pdf($|\?)/i.test(p), drive = /^https?:/.test(p);
    return `<div class="thumb ${pdf || drive ? 'pdf' : ''}" data-thumb="${esc(p)}" data-i="${i}" ${drive ? 'title="ไฟล์เดิมใน Google Drive"' : ''}>${drive ? 'Drive' : pdf ? 'PDF' : icon('image')}${removable ? `<button class="x" data-rm="${i}" aria-label="ลบ">${icon('x')}</button>` : ''}</div>`;
  }).join('')}</div>`;
}
/** เรียกหลังใส่ thumbs() ลงหน้า เพื่อโหลดรูปจริง + คลิกขยาย */
export function hydrateThumbs(root) {
  const all = $$('[data-thumb]', root);
  all.forEach(async (t) => {
    const p = t.dataset.thumb;
    if (/\.pdf($|\?)/i.test(p) || /^https?:/.test(p)) return;
    try { const u = await api.fileUrl(p); t.style.backgroundImage = `url("${u}")`; t.firstChild?.nodeType === 1 && !t.firstChild.classList?.contains('x') && t.firstChild.remove(); } catch { t.innerHTML = icon('alert'); }
  });
  if (root.__thumbBound) return;
  root.__thumbBound = true;
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-rm]')) return;
    const t = e.target.closest('[data-thumb]'); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const group = $$('[data-thumb]', t.parentElement).map((x) => x.dataset.thumb);
    lightbox(group, group.indexOf(t.dataset.thumb));
  });
}
/** เปิดดูรูป/PDF เต็มจอ — ซูมด้วยล้อเมาส์/สองนิ้ว/แตะสองครั้ง */
export async function lightbox(paths, idx = 0) {
  let i = Math.max(0, idx);
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<div class="lb-top"><span class="text-sm" data-n></span><div class="flex">
    <a class="btn-icon" data-open target="_blank" rel="noopener" title="เปิดในแท็บใหม่">${icon('external')}</a>
    <button class="btn-icon" data-close aria-label="ปิด">${icon('x')}</button></div></div>
    <div class="lb-stage"></div>
    ${paths.length > 1 ? `<div class="flex" style="justify-content:center;padding:10px"><button class="btn btn-glass btn-sm" data-prev>${icon('chevron-left')}</button><button class="btn btn-glass btn-sm" data-next>${icon('chevron-right')}</button></div>` : ''}`;
  document.body.appendChild(el);
  const stage = el.querySelector('.lb-stage');
  let scale = 1, tx = 0, ty = 0, img = null;
  const apply = () => { if (img) img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  async function show() {
    el.querySelector('[data-n]').textContent = paths.length > 1 ? `${i + 1} / ${paths.length}` : '';
    stage.innerHTML = '<span class="spin"></span>';
    scale = 1; tx = ty = 0;
    try {
      const u = await api.fileUrl(paths[i]);
      el.querySelector('[data-open]').href = u;
      if (/^https?:/.test(paths[i])) { img = null; stage.innerHTML = u ? `<div style="color:#fff;text-align:center;padding:24px">ไฟล์นี้อยู่ใน Google Drive ของระบบเดิม<br><br><a class="btn btn-glass" href="${esc(u)}" target="_blank" rel="noopener noreferrer">เปิดใน Google Drive</a></div>` : '<div style="color:#fff">ลิงก์ไฟล์ไม่ถูกต้อง</div>'; return; }
      if (/\.pdf($|\?)/i.test(paths[i])) { stage.innerHTML = `<iframe src="${esc(u)}"></iframe>`; img = null; }
      else { stage.innerHTML = `<img src="${esc(u)}" alt="ใบเสร็จ">`; img = stage.querySelector('img'); }
    } catch (e) { stage.innerHTML = `<div style="color:#fff">${esc(e.message)}</div>`; }
  }
  const close = () => { el.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') nav(1); if (e.key === 'ArrowLeft') nav(-1); };
  const nav = (d) => { if (paths.length < 2) return; i = (i + d + paths.length) % paths.length; show(); };
  document.addEventListener('keydown', key);
  el.querySelector('[data-close]').onclick = close;
  el.querySelector('[data-prev]')?.addEventListener('click', () => nav(-1));
  el.querySelector('[data-next]')?.addEventListener('click', () => nav(1));
  stage.addEventListener('click', (e) => { if (e.target === stage) close(); });
  stage.addEventListener('wheel', (e) => { if (!img) return; e.preventDefault(); scale = Math.min(6, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 0.87))); if (scale === 1) tx = ty = 0; apply(); }, { passive: false });
  stage.addEventListener('dblclick', () => { scale = scale > 1 ? 1 : 2.5; tx = ty = 0; apply(); });
  const pts = new Map(); let startDist = 0, startScale = 1, last = null;
  stage.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); stage.setPointerCapture(e.pointerId); last = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); startScale = scale; } });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !img) return; pts.set(e.pointerId, e);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; scale = Math.min(6, Math.max(1, startScale * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / startDist)); apply(); }
    else if (scale > 1 && last) { tx += e.clientX - last.x; ty += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; apply(); }
  });
  const up = (e) => { pts.delete(e.pointerId); last = null; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  show();
}

/**
 * ช่องแนบใบเสร็จ: แสดงไฟล์ที่เลือก + ปุ่มถ่าย/เลือก · อัปโหลดตอนกดส่งด้วย uploadAll()
 * const rp = receiptPicker(containerEl, {max: 10, existing: [paths]})
 * rp.count() · await rp.uploadAll() → [paths ใหม่ + เดิมที่ยังเก็บไว้]
 */
export function receiptPicker(container, { max = 10, existing = [], onChange } = {}) {
  let files = [];               // {file, url}
  let keep = [...existing];     // path เดิม
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*,application/pdf'; input.multiple = true; input.hidden = true;
  container.appendChild(input);
  const box = document.createElement('div'); container.appendChild(box);
  function render() {
    const parts = keep.map((p, i) => `<div class="thumb ${/\.pdf/i.test(p) ? 'pdf' : ''}" data-thumb="${esc(p)}">${/\.pdf/i.test(p) ? 'PDF' : icon('image')}<button class="x" data-rmk="${i}" aria-label="ลบ">${icon('x')}</button></div>`)
      .concat(files.map((f, i) => f.file.type === 'application/pdf'
        ? `<div class="thumb pdf">PDF<button class="x" data-rmf="${i}" aria-label="ลบ">${icon('x')}</button></div>`
        : `<div class="thumb" style="background-image:url('${f.url}')"><button class="x" data-rmf="${i}" aria-label="ลบ">${icon('x')}</button></div>`));
    if (keep.length + files.length < max) parts.push(`<button type="button" class="thumb add" data-add>${icon('camera')}<span>แนบรูป</span></button>`);
    box.innerHTML = `<div class="thumbs">${parts.join('')}</div>`;
    hydrateThumbs(box);
    onChange?.(keep.length + files.length);
  }
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { input.click(); return; }
    const rk = e.target.closest('[data-rmk]'); if (rk) { e.stopPropagation(); keep.splice(+rk.dataset.rmk, 1); render(); return; }
    const rf = e.target.closest('[data-rmf]'); if (rf) { e.stopPropagation(); URL.revokeObjectURL(files[+rf.dataset.rmf].url); files.splice(+rf.dataset.rmf, 1); render(); }
  });
  input.onchange = () => {
    [...input.files].slice(0, max - keep.length - files.length).forEach((f) => files.push({ file: f, url: URL.createObjectURL(f) }));
    input.value = ''; render();
  };
  render();
  return {
    count: () => keep.length + files.length,
    hasNew: () => files.length > 0,
    kept: () => [...keep],
    async uploadAll(onProgress) {
      const out = [...keep];
      for (let k = 0; k < files.length; k++) { onProgress?.(k + 1, files.length); out.push(await api.upload(files[k].file, 'receipts')); }
      return out;
    },
    async uploadNew(onProgress) {
      const out = [];
      for (let k = 0; k < files.length; k++) { onProgress?.(k + 1, files.length); out.push(await api.upload(files[k].file, 'receipts')); }
      return out;
    },
    reset() { files = []; keep = []; render(); },
  };
}

// ─────────────── ลายเซ็น ───────────────
/** กล่องเซ็นชื่อ: const pad = signaturePad(el); pad.isEmpty(); await pad.toBlob(); pad.clear() */
export function signaturePad(container) {
  container.innerHTML = `<div class="sig-pad"><div class="line"></div><div class="ph">เซ็นชื่อในกรอบนี้</div><canvas></canvas></div>
    <div class="flex between mt-8"><span class="hint">ใช้นิ้วหรือเมาส์เซ็น</span><button type="button" class="btn btn-ghost btn-sm" data-clear>${icon('rotate-ccw', 'sm')} ล้าง</button></div>`;
  const wrap = container.querySelector('.sig-pad'), cv = container.querySelector('canvas'), ph = container.querySelector('.ph');
  const g = cv.getContext('2d'); let drawn = false, drawing = false, lastPt = null;
  function size() {
    const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr; g.scale(dpr, dpr);
    g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
  }
  requestAnimationFrame(size);
  const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', (e) => { drawing = true; lastPt = pt(e); cv.setPointerCapture(e.pointerId); ph.style.display = 'none'; });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return; const p = pt(e);
    g.beginPath(); g.moveTo(lastPt.x, lastPt.y); g.lineTo(p.x, p.y); g.stroke(); lastPt = p; drawn = true;
  });
  const end = () => { drawing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  container.querySelector('[data-clear]').onclick = () => { g.clearRect(0, 0, cv.width, cv.height); drawn = false; ph.style.display = ''; };
  return {
    isEmpty: () => !drawn,
    clear: () => container.querySelector('[data-clear]').click(),
    /** ตัดขอบว่างแล้วคืน PNG */
    toBlob() {
      const w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const pad = 12; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
      const out = document.createElement('canvas'); out.width = Math.max(1, x1 - x0); out.height = Math.max(1, y1 - y0);
      out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return new Promise((r) => out.toBlob((b) => r(new File([b], 'signature.png', { type: 'image/png' })), 'image/png'));
    },
  };
}

// ─────────────── อื่นๆ ───────────────
/** ช่องเลือกเดือน ‹ ต.ค. 2569 › · คืน {el html, bind(root, onChange)} */
export function monthNav(y, m) {
  return `<div class="month-nav"><button class="btn-icon sm" data-mprev aria-label="เดือนก่อน">${icon('chevron-left')}</button>
    <span class="lbl">${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1]} ${y + 543}</span>
    <button class="btn-icon sm" data-mnext aria-label="เดือนถัดไป">${icon('chevron-right')}</button></div>`;
}
export function shiftMonth(y, m, d) { const t = y * 12 + (m - 1) + d; return [Math.floor(t / 12), (t % 12) + 1]; }
/** แถบกราฟแนวนอน: [{label, value, sub}] */
export function bars(items, { fmt = (v) => money(v, 0) } = {}) {
  const max = Math.max(1, ...items.map((x) => Number(x.value) || 0));
  return `<div class="bars">${items.map((x) => `<div class="bar-row"><span class="ellipsis">${esc(x.label)}</span>
    <div class="track"><div class="fill" style="width:${Math.max(2, (Number(x.value) || 0) / max * 100)}%"></div></div>
    <span class="amount text-sm">${fmt(x.value)}</span></div>`).join('')}</div>`;
}
/** โดนัท SVG: [{label, value, color}] */
export function donut(items, size = 140) {
  const total = items.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1;
  let acc = 0; const r = 52, c = 2 * Math.PI * r;
  const segs = items.map((x) => { const len = (Number(x.value) || 0) / total * c; const s = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${x.color}" stroke-width="20" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 70 70)"/>`; acc += len; return s; });
  return `<svg class="donut" viewBox="0 0 140 140" width="${size}" height="${size}"><circle r="${r}" cx="70" cy="70" fill="none" stroke="#F0F1F4" stroke-width="20"/>${segs.join('')}</svg>`;
}
export const PALETTE = ['#B7081D', '#2459D1', '#138A4B', '#B4610B', '#6D3FD6', '#0E7C74', '#DB2777', '#64748B', '#CA8A04', '#0891B2'];
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export { fmtDate, money };
