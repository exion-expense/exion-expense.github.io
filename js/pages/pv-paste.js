// วางจาก Excel → บรรทัดของตารางเคลียร์ advance (ใช้ใน pv-clear.js)
//  รับข้อความที่คัดลอกจาก Excel / Google Sheets (ช่องคั่นด้วยแท็บ) แล้วดูจากเนื้อหาว่าคอลัมน์ไหนคือ
//  วันที่ · รายการ · ยอดบาท · ยอดเงินสกุลอื่น · สกุลเงิน · ใบเสร็จ · หมายเหตุ (เลือกหัวตารางมาด้วยหรือไม่ก็ได้)
//  ฟังก์ชันล้วน ไม่แตะหน้าเว็บ / ไม่เรียกเซิร์ฟเวอร์ — ทดสอบแยกได้
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CURS = 'USD EUR JPY CNY SGD MYR HKD KRW VND IDR AUD GBP AED INR TWD CHF MMK LAK KHR PHP BND NZD CAD SAR QAR KWD BHD OMR BDT LKR PKR NPR RUB TRY ZAR SEK NOK DKK PLN CZK HUF MXN BRL THB'.split(' ');
const MONTHS = [
  ['jan', 'มค', 'มกราคม'], ['feb', 'กพ', 'กุมภาพันธ์'], ['mar', 'มีค', 'มีนาคม'], ['apr', 'เมย', 'เมษายน'], ['may', 'พค', 'พฤษภาคม'], ['jun', 'มิย', 'มิถุนายน'],
  ['jul', 'กค', 'กรกฎาคม'], ['aug', 'สค', 'สิงหาคม'], ['sep', 'กย', 'กันยายน'], ['oct', 'ตค', 'ตุลาคม'], ['nov', 'พย', 'พฤศจิกายน'], ['dec', 'ธค', 'ธันวาคม'],
];
const pad = (n) => String(n).padStart(2, '0');

// ข้อความที่คัดลอกจากตาราง → [[ช่อง, ช่อง, …], …] (ช่องที่มีขึ้นบรรทัดใหม่ Excel จะครอบด้วย "…")
export function splitCells(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n');
  const rows = []; let row = [], cell = '', i = 0, q = false;
  const endCell = () => { row.push(cell.replace(/\s+/g, ' ').trim()); cell = ''; };
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { q = true; i++; continue; }
    if (ch === '\t') { endCell(); i++; continue; }
    if (ch === '\n') { endCell(); rows.push(row); row = []; i++; continue; }
    cell += ch; i++;
  }
  endCell(); rows.push(row);
  let out = rows.filter((r) => r.some((c) => c !== ''));
  // ไม่มีแท็บเลย (คัดลอกจากที่อื่นที่ไม่ใช่ตาราง) → ลองแยกช่องด้วยเว้นวรรค 2 ช่องขึ้นไป
  if (out.length && !s.includes('\t')) out = s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s{2,}/).map((c) => c.trim()));
  const w = Math.max(0, ...out.map((r) => r.length));
  return out.map((r) => { const x = r.slice(); while (x.length < w) x.push(''); return x; });
}

// ปีที่พิมพ์มา → ค.ศ. (รับ พ.ศ. · ปี 2 หลักเลือกแบบที่ใกล้ปีนี้ที่สุด เช่น 26 = 2026, 69 = พ.ศ. 2569 = 2026)
function fixYear(y, len, nowY) {
  if (len >= 3) return y > 2400 ? y - 543 : y;
  const ce = 2000 + y, be = 1957 + y;
  return Math.abs(ce - nowY) <= Math.abs(be - nowY) ? ce : be;
}
const monthOf = (name) => {
  const k = String(name || '').toLowerCase().replace(/[.\s]/g, '');
  if (!k) return 0;
  const i = MONTHS.findIndex(([en, th, full]) => k === th || k === full || (/^[a-z]+$/.test(k) && k.length >= 3 && (k === en || (en === k.slice(0, 3) && 'january february march april may june july august september october november december'.split(' ').some((f) => f.startsWith(k))))));
  return i + 1;
};
// วันที่แบบที่ Excel แสดง → 'YYYY-MM-DD' (อ่านไม่ออก = '') · ลำดับ วัน/เดือน/ปี แบบไทย
export function parseDate(v, today) {
  const s = String(v || '').trim(); if (!s) return '';
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today || '')) || [];
  const nowY = Number(t[1]) || new Date().getFullYear();
  let d = 0, m = 0, y = null, yl = 0, x;
  if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) { y = +x[1]; yl = 4; m = +x[2]; d = +x[3]; }
  else if ((x = /^(\d{1,2})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{2,4})$/.exec(s)) || (x = /^(\d{1,2})\s*[-/]\s*(\d{1,2})$/.exec(s))) {
    d = +x[1]; m = +x[2]; if (x[3]) { y = +x[3]; yl = x[3].length; }      // ไม่มีปี รับเฉพาะ 5/11 หรือ 5-11 ("12.10" = ยอดเงิน ไม่ใช่วันที่)
    if (m > 12 && d <= 12) [d, m] = [m, d];
  } else if ((x = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([^\d\s][^\d]*?)[\s\-/.,]*(\d{2,4})?$/i.exec(s))) {
    d = +x[1]; m = monthOf(x[2]); if (x[3]) { y = +x[3]; yl = x[3].length; }
  } else if ((x = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{2,4}))?$/.exec(s))) {
    m = monthOf(x[1]); d = +x[2]; if (x[3]) { y = +x[3]; yl = x[3].length; }
  } else return '';
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  if (y == null) { y = nowY; if (today && `${y}-${pad(m)}-${pad(d)}` > today) y -= 1; }      // ไม่มีปี = ปีนี้ (ถ้ายังมาไม่ถึง = ปีที่แล้ว)
  else y = fixYear(y, yl, nowY);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}

// ตัวเลขแบบที่ Excel แสดง → { n, cur } · "90 USD" = n 90 cur USD · "(1,250.00)" = ติดลบ · อ่านไม่ออก = null
export function parseNum(v) {
  let s = String(v || '').trim(); if (!s || /^[-–—]+$/.test(s)) return null;
  let cur = '', x;
  if ((x = /^([A-Za-z]{3})\s*([\d(.\-].*)$/.exec(s))) { cur = x[1].toUpperCase(); s = x[2]; }             // "USD 90"
  else if ((x = /^(.*[\d)])\s*([A-Za-z]{3})$/.exec(s))) { cur = x[2].toUpperCase(); s = x[1]; }            // "90 USD"
  if (cur && !CURS.includes(cur)) return null;
  s = s.replace(/฿|บาท|baht/gi, '').replace(/\s/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s)) return null;
  const n = Number(s); if (!Number.isFinite(n)) return null;
  return { n: neg ? -n : n, cur };
}

const isCur = (v, known) => /^[A-Za-z]{3}$/.test(v) && known.includes(v.toUpperCase());
const RC_YES = /^(receipt|มี|มีใบเสร็จ|true|yes|y|✓|✔|☑|1)$/i, RC_NO = /^(no receipt|no|n|ไม่มี|ไม่มีใบเสร็จ|false|x|✗|✘|☐|0)$/i;
const NO_RC_TEXT = /no\s*receipt|ไม่มีใบเสร็จ|ไม่มีบิล/i;
const TOTAL_TEXT = /^(grand\s*total|total|sub\s*total|รวม|ยอดรวม|รวมทั้งสิ้น|sum|balance|คงเหลือ|advance)(\b|\s|:|$)/i;

/**
 * parsePaste(text, { items, curs, today }) →
 *   { rows: [{date, desc, amount, fx, cur, receipt, remark}], skipped, noCur, total, cols }
 *   items = รายการในตัวเลือกของหน้า (ข้อความตรงกัน = เลือกรายการนั้น) · curs = สกุลเงินของหน้า · today = 'YYYY-MM-DD'
 */
export function parsePaste(text, { items = [], curs = [], today = '' } = {}) {
  const empty = { rows: [], skipped: 0, noCur: 0, total: 0, cols: {} };
  let grid = splitCells(text);
  if (!grid.length) return empty;
  const known = [...new Set([...CURS, ...curs.map((c) => String(c).toUpperCase())])];
  const W = grid[0].length;
  const numOf = (v) => parseNum(v);
  // บรรทัดแรกเป็นหัวตาราง = ไม่มีช่องไหนเป็นวันที่ / ตัวเลข ทั้งที่บรรทัดถัดไปมี
  const hasData = (r) => r.some((c) => parseDate(c, today) || numOf(c));
  let head = null;
  const first = grid.findIndex(hasData);
  if (first < 0) return { ...empty, skipped: grid.length };
  if (first > 0) {
    const hs = grid.slice(Math.max(0, first - 2), first);
    head = Array.from({ length: W }, (_, c) => hs.map((r) => r[c]).filter(Boolean).join(' ').toLowerCase());
    grid = grid.slice(first);
  }
  const H = (c) => (head ? head[c] || '' : '');
  const col = (c) => grid.map((r) => r[c]);
  const filled = (c) => col(c).filter((v) => v !== '');
  const share = (c, test) => { const f = filled(c); return f.length ? f.filter(test).length / f.length : 0; };

  // วันที่: คอลัมน์ที่ช่องส่วนใหญ่เป็นวันที่
  let cDate = -1, best = 0;
  for (let c = 0; c < W; c++) { const n = filled(c).filter((v) => parseDate(v, today)).length; if (n > best && share(c, (v) => parseDate(v, today)) >= 0.6) { best = n; cDate = c; } }
  // คอลัมน์เลขลำดับ (1, 2, 3 …) — ไม่ใช่ยอดเงิน
  const isSeq = (c) => {
    if (/^(no\.?|#|ลำดับ|ลำดับที่|ที่|item)$/.test(H(c).trim())) return true;
    const all = filled(c), f = all.filter((v) => /^\d{1,3}\.?$/.test(v)).map((v) => parseInt(v, 10));
    return f.length >= 2 && f.length >= all.length * 0.6 && f.every((n, i) => i === 0 || n === f[i - 1] + 1);
  };
  const numCols = [];
  for (let c = 0; c < W; c++) {
    if (c === cDate || isSeq(c)) continue;
    const f = filled(c); if (!f.length) continue;
    if (share(c, (v) => !!numOf(v)) >= 0.8) numCols.push(c);
  }
  const cnt = (c) => filled(c).filter((v) => numOf(v)).length;
  const maxCnt = Math.max(0, ...numCols.map(cnt));
  const debit = (c) => /debit|รับ/.test(H(c)) && !/credit|จ่าย/.test(H(c));
  // ยอดบาท: หัวตารางบอก (THB / บาท / Credit) หรือคอลัมน์ตัวเลขแรกที่กรอกเกือบทุกบรรทัด
  let cThb = numCols.find((c) => !debit(c) && /credit|จ่าย/.test(H(c)) && !/card|บัตร/.test(H(c)));
  if (cThb == null) cThb = numCols.find((c) => !debit(c) && /thb|baht|บาท/.test(H(c)));
  if (cThb == null) cThb = numCols.find((c) => !debit(c) && cnt(c) >= maxCnt * 0.5);
  if (cThb == null) return { ...empty, skipped: grid.length };
  // ยอดเงินสกุลอื่น: คอลัมน์ตัวเลขถัดจากยอดบาท
  const cFx = numCols.find((c) => c > cThb && !debit(c));
  // สกุลเงิน: คอลัมน์ที่เป็นรหัส 3 ตัวอักษร · หรือรหัสในหัวตารางของคอลัมน์ยอดเงินสกุลอื่น เช่น "Total Price (MMK)"
  let cCur = -1;
  for (let c = 0; c < W; c++) if (c !== cDate && !numCols.includes(c) && filled(c).length && share(c, (v) => isCur(v, known)) >= 0.8) { cCur = c; break; }
  let defCur = '';
  if (cFx != null) { const m = (H(cFx).toUpperCase().match(/\b[A-Z]{3}\b/g) || []).find((k) => known.includes(k) && k !== 'THB'); if (m) defCur = m; }
  // ใบเสร็จ: คอลัมน์ที่เป็นคำว่า Receipt / No Receipt / มี / ไม่มี
  const yn = [];
  for (let c = 0; c < W; c++) if (c !== cDate && c !== cCur && !numCols.includes(c) && !isSeq(c) && filled(c).length && share(c, (v) => RC_YES.test(v) || RC_NO.test(v)) >= 0.8) yn.push(c);
  const cRc = yn.find((c) => /receipt|ใบเสร็จ|บิล/.test(H(c))) ?? (yn.length ? yn[0] : -1);
  // ที่เหลือ = ข้อความ: รายการ (คอลัมน์ข้อความแรกที่กรอกเกือบทุกบรรทัด) · หมายเหตุ (หัวตารางบอก หรือคอลัมน์ข้อความถัดไปทางขวาของยอดเงิน)
  const textCols = [];
  for (let c = 0; c < W; c++) if (c !== cDate && c !== cCur && !yn.includes(c) && !numCols.includes(c) && !isSeq(c) && filled(c).length) textCols.push(c);
  let cDesc = textCols.find((c) => /detail|desc|รายการ|รายละเอียด/.test(H(c)));
  if (cDesc == null) cDesc = textCols.find((c) => filled(c).length >= grid.length * 0.5);
  if (cDesc == null) cDesc = textCols[0];
  let cRm = textCols.find((c) => c !== cDesc && /remark|หมายเหตุ|note/.test(H(c)));
  if (cRm == null) cRm = textCols.find((c) => c !== cDesc && c > cThb);

  const rows = []; let skipped = 0;
  for (const g of grid) {
    const date = cDate >= 0 ? parseDate(g[cDate], today) : '';
    const amt = numOf(g[cThb]);
    let desc = cDesc != null ? g[cDesc] : '';
    // ไม่มียอดเงิน / ยอดเป็น 0 หรือติดลบ · มีคอลัมน์วันที่แต่บรรทัดนี้ไม่มีวันที่ (หัวตาราง / บรรทัดรวม) → ข้าม
    if (!amt || !(amt.n > 0) || (cDate >= 0 && !date) || (cDate < 0 && TOTAL_TEXT.test(desc))) { skipped++; continue; }
    let fx = null, cur = '';
    if (cFx != null) { const f = numOf(g[cFx]); if (f && f.n > 0) { fx = r2(f.n); cur = f.cur || (cCur >= 0 && isCur(g[cCur], known) ? g[cCur].toUpperCase() : '') || defCur; } }
    if (cur === 'THB') { fx = null; cur = ''; }
    let receipt = true;
    if (cRc >= 0 && RC_NO.test(g[cRc])) receipt = false;
    if (NO_RC_TEXT.test(desc)) receipt = false;
    const hit = items.find((i) => String(i).trim().toLowerCase() === desc.toLowerCase());
    desc = hit != null ? hit : desc.slice(0, 120);
    rows.push({ date, desc, amount: r2(amt.n), fx, cur, receipt, remark: (cRm != null ? g[cRm] : '').slice(0, 200) });
  }
  return { rows, skipped, noCur: rows.filter((r) => r.fx != null && !r.cur).length, total: r2(rows.reduce((s, r) => s + r.amount, 0)),
    cols: { date: cDate, desc: cDesc ?? -1, thb: cThb, fx: cFx ?? -1, cur: cCur, receipt: cRc, remark: cRm ?? -1, header: !!head } };
}
