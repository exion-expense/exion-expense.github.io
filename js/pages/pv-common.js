// ใช้ร่วมหน้าใบสำคัญจ่าย (ใบฟ้า): ป้ายสถานะ / แถวรายการ / ใบฟ้าสำหรับพิมพ์
import { api, money, fmtDate, esc } from '../core.js?v=10.1.1';
import { icon, catIcon } from '../ui.js?v=10.1.1';

export const KIND = { PCJ: 'มี Job', PCN: 'ทั่วไป', ADV: 'Advance' };
export const DOCS = [['costSheet', 'Cost sheet'], ['po', 'PO'], ['invoice', 'Invoice'], ['receipt', 'ใบเสร็จ']];
export const STAGES = [
  ['', 'ทั้งหมด'], ['dept', 'รออนุมัติ'], ['fin1', 'บัญชี 1'], ['fin2', 'บัญชี 2'], ['fin3', 'บัญชี 3'],
  ['pay', 'รอจ่าย'], ['adv_open', 'Advance ค้าง'], ['adv_check', 'รอตรวจเคลียร์'], ['returned', 'ตีกลับ'], ['paid', 'จ่ายแล้ว'], ['cancelled', 'ยกเลิก'],
];

const daysSince = (t) => Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400e3));

/** ป้ายสถานะตามขั้น · รออยู่ที่ใคร */
export function stageBadge(x) {
  const s = x.stage;
  if (s === 'dept') return `<span class="badge b-pending">รอ ${esc(x.waiting || x.stepLabel)}</span>`;
  if (s === 'fin1' || s === 'fin2' || s === 'fin3') return `<span class="badge b-info">รอบัญชี ${s.slice(3)}</span>`;
  if (s === 'pay') return '<span class="badge b-violet">รอจ่ายเงิน</span>';
  if (s === 'paid') return '<span class="badge b-paid">จ่ายแล้ว</span>';
  if (s === 'adv_open') return x.advOverdue ? '<span class="badge b-rejected">เลยกำหนดเคลียร์</span>' : '<span class="badge b-pending">รอเคลียร์ advance</span>';
  if (s === 'adv_check') return '<span class="badge b-info">รอบัญชีตรวจเคลียร์</span>';
  if (s === 'returned') return '<span class="badge b-rejected">ตีกลับให้แก้</span>';
  if (s === 'cancelled') return '<span class="badge b-neutral">ยกเลิก</span>';
  return `<span class="badge b-neutral">${esc(x.status)}</span>`;
}
export function kindBadge(k) {
  return `<span class="badge ${k === 'PCJ' ? 'b-brand' : k === 'ADV' ? 'b-violet' : 'b-neutral'} plain">${esc(KIND[k] || k)}</span>`;
}
/** แถวในรายการ · select = มีช่องติ๊กสำหรับอนุมัติหลายใบ */
export function pvRow(x, { select = false, checked = false } = {}) {
  const open = ['dept', 'fin1', 'fin2', 'fin3', 'pay', 'returned', 'adv_open', 'adv_check'].includes(x.stage);
  const wait = open && x.waiting ? `รอ ${esc(x.waiting)} · ${daysSince(x.stepAt)} วัน` : fmtDate(x.paidAt || x.createdAt);
  return `<a class="row ${checked ? 'selected' : ''}" href="#/pv/view?id=${encodeURIComponent(x.id)}">
    ${select ? `<label class="check"><input type="checkbox" data-sel="${esc(x.id)}" ${checked ? 'checked' : ''} aria-label="เลือก ${esc(x.id)}"></label>` : ''}
    ${catIcon(x.category)}
    <div class="row-main"><div class="row-title"><span class="mono">${esc(x.id)}</span> · ${esc(x.payee)}</div>
      <div class="row-sub">${esc(x.requesterName)}${x.department ? ' · ' + esc(x.department) : ''}${x.jobNo ? ' · Job ' + esc(x.jobNo) : ''}${x.onBehalfBy ? ' · กรอกโดย ' + esc(x.onBehalfBy) : ''}</div></div>
    <div class="row-end"><span class="amount">${money(x.amount)}</span>${stageBadge(x)}<span class="text-xs muted">${wait}</span></div>
  </a>`;
}

/** เลขไทยในใบ: 22/10/2569 */
const thd = (d) => { if (!d) return ''; const t = new Date(d); return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear() + 543}`; };

/**
 * ลายเซ็น 5 ช่องตามใบฟ้าเดิม
 *   ผู้จัดทำ = คนเบิก · ผู้ตรวจสอบ = ผู้อนุมัติแผนกรองสุดท้าย (ถ้ามีคนเดียว = คนเดียวกับผู้อนุมัติ)
 *   ผู้อนุมัติ = ผู้อนุมัติแผนกคนสุดท้าย · ผู้รับเอกสาร = บัญชี 1 · ผู้รับเงิน = เว้นว่าง
 *   แผนกที่ไม่มีผู้อนุมัติแผนก → ผู้ตรวจสอบ = บัญชี 2, ผู้อนุมัติ = บัญชี 3
 */
export function signers(v) {
  const steps = v.steps || [];
  const dept = steps.filter((s) => s.k === 'dept');
  const by = (s) => (s && s.state === 'done' ? { name: s.byName, sig: s.signature, at: s.at } : null);
  const f = (k) => steps.find((s) => s.k === k);
  const checked = dept.length ? by(dept.length > 1 ? dept[dept.length - 2] : dept[0]) : by(f('fin2'));
  const auth = dept.length ? by(dept[dept.length - 1]) : by(f('fin3'));
  return [
    ['ผู้จัดทำ', 'PREPARED BY', { name: v.requesterName, sig: v.requesterSignature, at: v.createdAt }],
    ['ผู้ตรวจสอบ', 'CHECKED BY', checked],
    ['ผู้อนุมัติ', 'AUTHORIZED BY', auth],
    ['ผู้รับเอกสาร', 'RECEIVER BILL BY', by(f('fin1'))],
    ['ผู้รับเงิน', 'RECEIVED BY', null],
  ];
}

/** HTML ใบฟ้า (ใช้ทั้งดูตัวอย่างและพิมพ์) */
export function voucherHtml(v) {
  const lines = v.lines || [];
  const pad = Math.max(0, 6 - lines.length);
  const others = (v.steps || []).filter((s) => s.k === 'fin2' || s.k === 'fin3').filter((s) => s.state === 'done')
    .map((s) => `${s.label}: ${esc(s.byName)} ${thd(s.at)}`);
  if (v.paidAt) others.push(`จ่ายแล้ว ${thd(v.paidAt)}`);
  return `<div class="pv-sheet">
    <div class="pv-hd">
      <img src="brand/logo.png" alt="EXION Thailand">
      <div class="pv-co"><b>บริษัท เอ็กซิออน (ประเทศไทย) จำกัด</b>EXION (THAILAND) CO., LTD.</div>
      <div><div class="pv-ttl">ใบสำคัญจ่าย<br>PAYMENT VOUCHER</div>
        <div class="pv-meta"><span>เลขที่ / No.</span><b>${esc(v.id)}</b><span>วันที่ / Date</span><b>${thd(v.createdAt)}</b></div></div>
    </div>
    <div class="pv-payto">
      <div><small>จ่ายให้ / PAY TO</small><span class="pen">${esc(v.payee)}</span></div>
      <div><small>ธนาคาร / BANK</small><span class="pen">${esc(v.payBank || '')}</span></div>
      <div><small>เลขบัญชี / ACCOUNT NO.</small><span class="pen">${esc(v.payAccount || '')}</span></div>
    </div>
    <table class="pv-tbl">
      <thead><tr><th style="width:52px">ลำดับ<br>ITEM</th><th>รายการ<br>DESCRIPTION</th><th style="width:150px">จำนวนเงิน<br>AMOUNT</th></tr></thead>
      <tbody>
        ${lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td class="pen">${esc(l.description)}</td><td class="r pen">${money(l.amount)}</td></tr>`).join('')}
        ${'<tr><td>&nbsp;</td><td></td><td></td></tr>'.repeat(pad)}
        ${Number(v.vatAmount) ? `<tr><td></td><td class="r">VAT ${Number(v.vatRate)}%</td><td class="r pen">${money(v.vatAmount)}</td></tr>` : ''}
        ${Number(v.whtAmount) ? `<tr><td></td><td class="r">หัก ณ ที่จ่าย ${Number(v.whtRate)}% / WHT</td><td class="r pen">(${money(v.whtAmount)})</td></tr>` : ''}
        <tr class="tot"><td></td><td class="r">รวมทั้งสิ้น / TOTAL</td><td class="r">${money(v.amount)}</td></tr>
      </tbody>
    </table>
    <div class="pv-foot">
      <div><small>แผนก / DEPARTMENT</small><span class="pen">${esc(v.department || '')}</span></div>
      <div><small>ใบสั่งซื้อ / PO NO.</small><span class="pen">${esc(v.poNo || '')}</span></div>
      <div><small>โครงการ / JOB NO.</small><span class="pen">${esc(v.jobNo || '')}</span></div>
      <div><small>ใบประมาณต้นทุน / COST SHEET NO.</small><span class="pen">${esc(v.costSheetNo || '')}</span></div>
      <div><small>วันที่จัดส่งสินค้า / DELIVERY DATE</small><span class="pen">${thd(v.deliveryDate)}</span></div>
      <div class="w3"><small>หมายเหตุ / REMARK</small><span class="pen">${esc([v.kind === 'ADV' ? 'Advance entertain' : '', v.isOffice ? 'Office expenses' : '', v.note].filter(Boolean).join(' · '))}</span></div>
    </div>
    <div class="pv-sigs">${signers(v).map(([th, en, s]) => `<div class="pv-sig"><div class="lab">${th}<br>${en}</div>
      <div class="ink">${s ? (s.sig ? `<img data-sig="${esc(s.sig)}" alt=""><span class="nm-ink hidden">${esc(s.name)}</span>` : `<span class="nm-ink">${esc(s.name)}</span>`) : ''}</div>
      <div class="nm">${s ? `(${esc(s.name)})` : '(&nbsp;'.padEnd(40, '.') + ')'}</div><div class="dt">${s ? thd(s.at) : '&nbsp;'}</div></div>`).join('')}</div>
    ${others.length ? `<div class="pv-trail">${others.join(' · ')}</div>` : ''}
  </div>`;
}
/** โหลดรูปลายเซ็นจริงในใบ (ไม่มีสิทธิ์/ไม่มีรูป → ใช้ชื่อแทน) */
export function hydrateSigs(root) {
  root.querySelectorAll('img[data-sig]').forEach(async (img) => {
    const fallback = () => { img.remove(); img.parentElement?.querySelector('.nm-ink')?.classList.remove('hidden'); };
    const nm = img.parentElement?.querySelector('.nm-ink');
    try {
      img.onerror = () => { img.remove(); nm?.classList.remove('hidden'); };
      img.src = await api.fileUrl(img.dataset.sig);
    } catch { fallback(); }
  });
}
/** พิมพ์ใบฟ้า: วางใบลงชั้นพิมพ์ แล้วเรียกหน้าพิมพ์ของเบราว์เซอร์ */
export function printVoucher(v) {
  document.querySelector('.pv-print-root')?.remove();
  const root = document.createElement('div');
  root.className = 'pv-print-root';
  root.innerHTML = voucherHtml(v);
  document.body.appendChild(root);
  hydrateSigs(root);
  document.body.classList.add('printing-pv');
  const done = () => { document.body.classList.remove('printing-pv'); root.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // รอรูปลายเซ็นโหลดสักครู่ก่อนเปิดหน้าพิมพ์
  setTimeout(() => window.print(), 700);
}
