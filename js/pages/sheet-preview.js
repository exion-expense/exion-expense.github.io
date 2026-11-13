// ดูตัวอย่างไฟล์ Excel บนจอ (ไม่ต้องโหลด) — ข้อมูลมาจาก Edge Function excel {preview: true}
// สร้างจาก workbook เดียวกับไฟล์ที่ดาวน์โหลด → ช่อง / ยอด / ความกว้าง ตรงกับไฟล์จริง
// ทุกช่องผ่าน esc() · สี / เส้นขอบ / รูป ต้องตรงรูปแบบที่กำหนดเท่านั้น (กันข้อมูลแปลกแทรกสไตล์)
import { esc, money } from '../core.js?v=10.4.19';
import { icon, sheet } from '../ui.js?v=10.4.19';

const COLOR = /^#[0-9A-F]{6}$/i;
const BORDER = /^[1-3]px (solid|dashed|dotted|double) #[0-9A-F]{6}$/i;
const SRC = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const GRID = '1px dotted #D7DBE2';   // เส้นตารางจาง ๆ แบบหน้าจอ Excel (เส้นขอบจริงทับได้เสมอ)
const num = (v, lo, hi, d = lo) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

function cellCss(s = {}, isNum, spill) {
  // spill = ข้อความยาวล้นไปช่องขวาที่ว่างได้ (เหมือน Excel) · ตัวเลข / ช่องตัดบรรทัด / ช่อง merge ตัดตามขอบช่อง
  const out = ['padding:0 4px', spill ? 'overflow:visible;position:relative;z-index:1' : 'overflow:hidden', 'line-height:1.25'];
  out.push(`white-space:${s.wr ? 'normal' : 'nowrap'}`);
  out.push(`text-align:${s.ha === 'c' ? 'center' : s.ha === 'r' ? 'right' : s.ha === 'l' ? 'left' : isNum ? 'right' : 'left'}`);
  out.push(`vertical-align:${s.va === 't' ? 'top' : s.va === 'm' ? 'middle' : 'bottom'}`);
  if (s.b) out.push('font-weight:700');
  if (s.i) out.push('font-style:italic');
  if (s.u) out.push('text-decoration:underline');
  if (s.sz) out.push(`font-size:${(num(s.sz, 6, 48, 11) * 4 / 3).toFixed(1)}px`);
  if (COLOR.test(s.fc || '')) out.push(`color:${s.fc}`);
  if (COLOR.test(s.bg || '')) out.push(`background:${s.bg}`);
  for (const [k, side] of [['bt', 'top'], ['bb', 'bottom'], ['bl', 'left'], ['br', 'right']]) {
    out.push(`border-${side}:${BORDER.test(s[k] || '') ? s[k] : GRID}`);
  }
  return out.join(';');
}

/** แปลงข้อมูลตัวอย่างเป็น HTML ตาราง (ทุกข้อความผ่าน esc) */
export function sheetHtml(p) {
  const cols = (p.cols || []).slice(0, 40).map((c) => (c.hide ? 0 : num(c.w, 0, 1200, 64)));
  const rows = (p.rows || []).slice(0, 300);
  const W = cols.reduce((a, b) => a + b, 0);
  // ช่องที่ถูก merge: ช่องหลักได้ rowspan/colspan · ช่องที่ถูกคลุมไม่ต้องวาด
  const span = new Map(), covered = new Set();
  for (const m of p.merges || []) {
    const [t, l, b, r] = m.map((x) => num(x, 0, 400, 0));
    if (b < t || r < l) continue;
    span.set(`${t},${l}`, [b - t + 1, r - l + 1]);
    for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) if (y !== t || x !== l) covered.add(`${y},${x}`);
  }
  const tops = []; let y = 0;
  const body = rows.map((row, ri) => {
    const h = row.hide ? 0 : num(row.h, 0, 400, 20); tops.push(y); y += h;
    const byCol = new Map((row.cells || []).map((c) => [num(c.c, 0, 40, 0), c]));
    let tds = '';
    for (let ci = 0; ci < cols.length; ci++) {
      if (covered.has(`${ri},${ci}`)) continue;
      const c = byCol.get(ci) || {}; const sp = span.get(`${ri},${ci}`);
      const attr = sp ? `${sp[0] > 1 ? ` rowspan="${sp[0]}"` : ''}${sp[1] > 1 ? ` colspan="${sp[1]}"` : ''}` : '';
      const next = byCol.get(ci + 1);
      const spill = !!c.t && !c.n && !c.s?.wr && !sp && (!c.s?.ha || c.s.ha === 'l') && ci + 1 < cols.length
        && !covered.has(`${ri},${ci + 1}`) && !(next && next.t);
      tds += `<td${attr} style="${cellCss(c.s, !!c.n, spill)}">${esc(String(c.t ?? ''))}</td>`;
    }
    return `<tr style="height:${h}px">${tds}</tr>`;
  }).join('');
  const lefts = []; let x = 0; for (const w of cols) { lefts.push(x); x += w; }
  const at = (arr, sizes, pos) => { const i = Math.floor(pos); return (arr[i] ?? x) + (pos - i) * (sizes[i] ?? 0); };
  const imgs = (p.images || []).filter((im) => SRC.test(im.src || '')).map((im) => {
    const left = at(lefts, cols, num(im.col, 0, 40)), top = at(tops, rows.map((r) => (r.hide ? 0 : num(r.h, 0, 400, 20))), num(im.row, 0, 300));
    return `<img src="${im.src}" alt="รูปในไฟล์" style="position:absolute;left:${left.toFixed(0)}px;top:${top.toFixed(0)}px;width:${num(im.w, 1, 1600)}px;height:${num(im.h, 1, 1600)}px;pointer-events:none">`;
  }).join('');
  return `<div style="position:relative;width:${W}px">
    <table style="border-collapse:collapse;table-layout:fixed;width:${W}px;background:#fff;color:#000;font-family:Calibri,'IBM Plex Sans Thai',Arial,sans-serif;font-size:14.7px">
      <colgroup>${cols.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>${body}</table>${imgs}</div>`;
}

/** เปิดหน้าดูตัวอย่าง · onDownload = ปุ่มโหลดไฟล์จริง (ไม่บังคับ) */
export function showSheetPreview(data, { title = 'ตัวอย่างไฟล์ Excel', onDownload } = {}) {
  const p = data?.sheet || {}; const m = data?.meta || {};
  let ro = null;
  const info = [m.periodLabel, m.itemCount != null ? `${m.itemCount} รายการ` : '', m.totalAmount != null ? `รวม ${money(m.totalAmount)} บาท` : ''].filter(Boolean).join(' · ');
  const s = sheet({
    title, wide: true,
    body: `<div class="stack-sm">
      <div class="text-sm muted">${esc(data?.filename || '')}${info ? ' · ' + esc(info) : ''}</div>
      <div class="alert neutral" style="margin:0">${icon('info')}<div class="text-sm">หน้าตาเหมือนไฟล์ที่โหลดได้ทุกช่อง ตรวจว่ายอดลงช่องถูกหมวดและข้อมูลครบ${m.isDraft ? ' · ร่างยังไม่มีลายเซ็น' : ''}</div></div>
      <div class="flex gap-8" style="align-items:center"><span class="text-sm muted">ขนาด</span>
        <div class="seg" role="group" aria-label="ขนาดตัวอย่าง"><button type="button" data-z="fit" aria-pressed="true">พอดีจอ</button><button type="button" data-z="1" aria-pressed="false">100%</button></div></div>
      <div data-xp style="overflow:auto;max-height:62vh;border:1px solid var(--line);border-radius:10px;background:#fff;-webkit-overflow-scrolling:touch"><div data-xpz style="display:inline-block">${sheetHtml(p)}</div></div>
      ${p.truncated ? '<div class="text-xs muted">ไฟล์ยาวเกินกว่าที่แสดงได้ทั้งหมด — โหลดไฟล์จริงเพื่อดูส่วนที่เหลือ</div>' : ''}
    </div>`,
    foot: `<button class="btn btn-secondary" data-x>ปิด</button>${onDownload ? `<button class="btn btn-primary" data-dl data-busy="กำลังสร้างไฟล์…">${icon('download')} โหลดไฟล์ Excel</button>` : ''}`,
    onMount: (el) => {
      el.style.maxWidth = 'min(1280px, 100vw)';
      const box = el.querySelector('[data-xp]'), z = el.querySelector('[data-xpz]');
      const W = (p.cols || []).reduce((a, c) => a + (c.hide ? 0 : num(c.w, 0, 1200, 64)), 0) || 1;
      let mode = 'fit';
      const apply = () => {
        const k = mode === 'fit' ? Math.min(1, (box.clientWidth - 2) / W) : 1;
        z.style.zoom = String(Math.max(0.3, k));
        el.querySelectorAll('[data-z]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.z === mode)); b.classList.toggle('on', b.dataset.z === mode); });
      };
      el.querySelectorAll('[data-z]').forEach((b) => { b.onclick = () => { mode = b.dataset.z; apply(); }; });
      requestAnimationFrame(apply);
      ro = new ResizeObserver(() => mode === 'fit' && apply()); ro.observe(box);
      const dl = el.querySelector('[data-dl]');
      if (dl && onDownload) dl.onclick = () => onDownload(dl);
    },
  });
  s.done.then(() => ro?.disconnect());
  return s;
}
