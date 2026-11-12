// รายการที่จ่ายแล้ว "ตามรอบเติมเงิน" (ใบสำคัญจ่าย) — คอลัมน์ตามไฟล์ของบัญชี · สรุป PAID / Pending ท้ายตาราง · พิมพ์ได้ (แนวตั้ง / แนวนอน) · ก๊อปไปวาง Excel
// รอบ = ตั้งแต่เติมเงินเข้ากล่องครั้งก่อน ถึงครั้งถัดไป · กด "จ่ายเงินเติมกล่อง" = ปิดรอบ (ระบบเดียวกับ "เคลียร์บิล" หน้ากล่องเงินสด)
// รวมทั้งรอบ Petty cash และรอบวันที่ 20 · แผนกเป็น EXION CODE · Description = ชื่อหมวดภาษาอังกฤษ
// Doc ID / PO / Cost sheet / Job แสดงบนจอ + ก๊อป Excel เท่านั้น (ไม่ออกตอนพิมพ์)
import { api, money, esc } from '../core.js?v=10.4.17';
import { icon, toast, toastError, empty, errorBox, skeleton, on, $, confirmBox } from '../ui.js?v=10.4.17';
import { PRINT_ORIENTS, setPrintOrient } from './pv-common.js?v=10.4.17';

const COLS = ['No.', 'Suppliers', 'Description', 'Amount', 'Department', 'Prepared By', 'Status', 'Payment date'];
const XCOLS = ['Doc ID', 'PO No.', 'Cost sheet No.', 'Job No.'];   // เฉพาะบนจอ / Excel
const TKEY = 'exion_pv_report_title', OKEY = 'exion_pv_report_orient';
const loadT = () => { try { return JSON.parse(localStorage.getItem(TKEY) || '{}'); } catch { return {}; } };
const saveT = (v) => { try { localStorage.setItem(TKEY, JSON.stringify(v)); } catch { /* */ } };
const loadO = () => { try { return localStorage.getItem(OKEY) === 'landscape' ? 'landscape' : 'portrait'; } catch { return 'portrait'; } };
const saveO = (v) => { try { localStorage.setItem(OKEY, v); } catch { /* */ } };

export async function render(ctx) {
  const { el, query } = ctx;
  const st = { round: /^[A-Za-z0-9-]{3,40}$/.test(query.r || '') ? query.r : '', test: false, pending: false, orient: loadO(), d: null, seq: 0 };
  const tkey = () => 'r:' + (st.d?.round?.key || 'start');

  function titles() {
    const d = st.d, saved = loadT()[tkey()] || {};
    return {
      t1: saved.t1 ?? `Other Operation Expense of ${d.monthLabel}`,
      t2: saved.t2 ?? `(F-3) Petty Cash Account - Top Up to meet ${money(d.limit || 0)} THB`,
    };
  }
  function sheetHtml(t) {
    const d = st.d;
    return `<div class="pv-rep">
      <div class="pv-rep-hd"><div><div class="pv-rep-t1">${esc(t.t1)}</div><div class="pv-rep-t2">${esc(t.t2)}</div></div><img src="brand/logo.png" alt="EXION Thailand"></div>
      <table class="pv-rep-tbl"><thead><tr>${COLS.map((c) => `<th>${c}</th>`).join('')}${XCOLS.map((c) => `<th class="scr-only">${c}</th>`).join('')}</tr></thead><tbody>
        ${d.items.map((x, i) => `<tr data-id="${esc(x.id)}"><td class="c">${i + 1}</td><td>${esc(x.supplier)}</td><td>${esc(x.description)}</td><td class="r">${money(x.amount)}</td>
          <td>${esc(x.department)}</td><td>${esc(x.preparedBy)}</td><td class="c"><b>${esc(x.status)}</b></td><td class="c">${esc(x.paymentDate)}</td>
          <td class="scr-only">${esc(x.id || '')}</td><td class="scr-only">${esc(x.poNo || '')}</td><td class="scr-only">${esc(x.costSheetNo || '')}</td><td class="scr-only">${esc(x.jobNo || '')}</td></tr>`).join('')}
      </tbody><tfoot><tr><td></td><td></td><td class="r">TOTAL</td><td class="r">${money(d.total)}</td><td colspan="4"></td><td class="scr-only" colspan="4"></td></tr></tfoot></table>
      <table class="pv-rep-sum"><tbody>
        <tr><td>PAID</td><td class="r">${money(d.paidTotal ?? d.total)}</td></tr>
        <tr><td>Pending</td><td class="r">${Number(d.pendingTotal) ? money(d.pendingTotal) : '-'}</td></tr>
        <tr class="tot"><td></td><td class="r">${money(d.total)}</td></tr>
      </tbody></table></div>`;
  }
  // ตัวเลือกรอบ: รอบปัจจุบัน + รอบที่ปิดแล้ว (ช่วง = เติมครั้งก่อน → เติมครั้งนั้น)
  function roundOptions() {
    const d = st.d, rs = d.rounds || [];
    const cur = `<option value="" ${!st.round ? 'selected' : ''}>รอบปัจจุบัน${rs[0] ? ' · ตั้งแต่ ' + esc(rs[0].at) : ''}</option>`;
    return cur + rs.map((r, i) => `<option value="${esc(r.id)}" ${st.round === r.id ? 'selected' : ''}>${rs[i + 1] ? esc(rs[i + 1].at) + ' → ' : 'ถึง '}${esc(r.at)} · เติม ${money(r.amount)}</option>`).join('');
  }

  async function load() {
    const my = ++st.seq;
    history.replaceState(null, '', location.pathname + location.search + '#/pv/report' + (st.round ? '?r=' + encodeURIComponent(st.round) : ''));
    $('[data-body]', el).innerHTML = skeleton(4);
    try {
      const d = await api.rpc('get_pv_round_report', { p_round: st.round || null, p_test: st.test, p_pending: st.pending });
      if (!ctx.alive() || my !== st.seq) return;
      st.d = d; paint();
    } catch (e) { if (ctx.alive() && my === st.seq) errorBox($('[data-body]', el), e, load); }
  }
  function paint() {
    const d = st.d, t = titles(), cur = d.round?.current;
    $('[data-testbox]', el).classList.toggle('hidden', !d.isFin);
    $('[data-round]', el).innerHTML = roundOptions();
    const pend = $('[data-pending]', el);
    pend.disabled = !cur; if (!cur) pend.checked = false;
    $('[data-pendbox]', el).classList.toggle('muted', !cur);
    const range = cur ? `รอบปัจจุบัน · ${d.round.from ? 'ตั้งแต่เติมเงินล่าสุด ' + esc(d.round.from) : 'ยังไม่เคยเติมเงิน'} ถึงตอนนี้`
      : `รอบที่ปิดแล้ว · ${d.round.from ? esc(d.round.from) : 'เริ่มต้น'} → ${esc(d.round.to)}`;
    const closeBtn = d.canClose && Number(d.topup) > 0
      ? `<button type="button" class="btn btn-primary" data-act="close">${icon('check')} จ่ายเงินเติมกล่อง ${money(d.topup)} บาท · ปิดรอบ</button>`
      : d.canClose ? '<span class="text-sm muted">กล่องเต็มวงเงินอยู่แล้ว</span>' : '';
    $('[data-body]', el).innerHTML = `<div class="card pad stack-sm">
        <div class="pv-round-bar"><span class="text-sm">${range}</span>${closeBtn}</div>
        ${d.items.length ? `<div class="form-grid two">
          <div class="field"><label for="rp-t1">หัวรายงาน บรรทัด 1</label><input class="input" id="rp-t1" data-t="t1" maxlength="150" value="${esc(t.t1)}"></div>
          <div class="field"><label for="rp-t2">หัวรายงาน บรรทัด 2</label><input class="input" id="rp-t2" data-t="t2" maxlength="150" value="${esc(t.t2)}"></div>
        </div>
        <div class="flex between wrap"><span class="text-sm muted">${d.items.length} รายการ · กดแถวเพื่อเปิดใบ · Doc ID / PO / Cost sheet / Job ไม่ออกตอนพิมพ์</span><span class="text-sm">รวม <b class="amount">${money(d.total)}</b> บาท</span></div>` : ''}
      </div>
      ${d.items.length ? `<div class="pv-rep-wrap" data-sheet>${sheetHtml(t)}</div>` : `<div class="card">${empty({ ic: 'receipt', title: cur ? 'รอบนี้ยังไม่มีรายการที่จ่าย' : 'รอบนี้ไม่มีรายการ' })}</div>`}`;
  }

  function print() {
    if (!st.d?.items.length) return;
    document.querySelector('.pv-print-root')?.remove();
    const root = document.createElement('div');
    root.className = 'pv-print-root' + (st.orient === 'landscape' ? ' pv-land' : '');
    root.innerHTML = sheetHtml(titles());
    document.body.appendChild(root);
    const unOrient = setPrintOrient(st.orient);
    document.body.classList.add('printing-pv');
    const done = () => { document.body.classList.remove('printing-pv'); root.remove(); unOrient(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 300);
  }
  async function copyExcel() {
    if (!st.d?.items.length) return;
    // กันช่องแตก + ข้อความขึ้นต้นด้วย = + - @ กลายเป็นสูตรใน Excel (แทรก ' นำหน้า · ตัวเลขติดลบปล่อยตามเดิม)
    const t = titles(), clean = (s) => { const v = String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim(); return /^[=+\-@]/.test(v) && !/^-?[\d,.]+$/.test(v) ? "'" + v : v; };
    const rows = [[t.t1], [t.t2], [...COLS, ...XCOLS], ...st.d.items.map((x, i) => [i + 1, x.supplier, x.description, Number(x.amount).toFixed(2), x.department, x.preparedBy, x.status, x.paymentDate,
        x.id || '', x.poNo || '', x.costSheetNo || '', x.jobNo || '']),
      ['', '', 'TOTAL', Number(st.d.total).toFixed(2)], [], ['', '', 'PAID', Number(st.d.paidTotal ?? st.d.total).toFixed(2)],
      ['', '', 'Pending', Number(st.d.pendingTotal) ? Number(st.d.pendingTotal).toFixed(2) : '-'], ['', '', '', Number(st.d.total).toFixed(2)]];
    try { await navigator.clipboard.writeText(rows.map((r) => r.map(clean).join('\t')).join('\n')); toast('ก๊อปแล้ว · ไปวางใน Excel ได้เลย'); }
    catch { toast('ก๊อปไม่ได้ — ลองกดพิมพ์ แล้วเลือกบันทึกเป็น PDF แทน', 'bad'); }
  }
  // ปิดรอบ = เติมเงินกล่องเต็มวงเงิน (เหมือน "เคลียร์บิล") · รายการที่จ่ายหลังจากนี้ขึ้นรอบใหม่
  async function closeRound(btn) {
    const d = st.d;
    const ok = await confirmBox({ title: 'จ่ายเงินเติมกล่อง · ปิดรอบ',
      message: `เติมเงินเข้ากล่อง ${money(d.topup)} บาท (ให้เต็มวงเงิน ${money(d.limit || 0)} บาท)\n\nกดยืนยันเมื่อมอบเงินให้คนถือกล่องแล้ว\nรายการที่จ่ายหลังจากนี้จะขึ้นรอบใหม่ · รอบนี้เลือกดู / พิมพ์ย้อนหลังได้`,
      ok: 'ยืนยัน จ่ายเงินแล้ว' });
    if (!ok) return;
    btn.disabled = true;
    try {
      const r = await api.rpc('clear_petty_bills', { p_fund_id: d.fundId, p_note: '' });
      toast(`ปิดรอบแล้ว · เติมเข้ากล่อง ${money(r.toppedUp)} บาท`);
      if (!ctx.alive()) return;
      st.round = r.id; st.pending = false; $('[data-pending]', el).checked = false;
      load();
    } catch (e) { toastError(e); btn.disabled = false; }
  }

  el.innerHTML = `<div class="stack">
    <div class="toolbar" style="margin-bottom:0">
      <div class="field" style="margin:0"><label for="rp-r" class="text-sm">รอบ (ตัดรอบตอนเติมเงินเข้ากล่อง)</label><select class="input" id="rp-r" data-round><option>กำลังโหลด…</option></select></div>
      <label class="check" data-pendbox><input type="checkbox" data-pending> รวมใบที่รอบัญชี 2 / บัญชี 3 และใบที่อนุมัติแล้วรอจ่าย (Pending)</label>
      <label class="check hidden" data-testbox><input type="checkbox" data-test> รวมใบทดลอง</label>
      <div class="flex gap-8" style="align-items:center"><span class="text-sm muted">แนว</span><div class="seg">${PRINT_ORIENTS.map(([k, l]) => `<button type="button" data-orient="${k}" class="${st.orient === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <button type="button" class="btn btn-secondary" data-act="copy">${icon('sheet')} ก๊อปไป Excel</button>
      <button type="button" class="btn btn-primary" data-act="print">${icon('file')} พิมพ์</button>
    </div>
    <div class="stack" data-body></div></div>`;
  await load();
  const offs = [
    on(el, 'change', '[data-round]', (e, t) => { st.round = t.value; load(); }),
    on(el, 'change', '[data-test]', (e, t) => { st.test = t.checked; load(); }),
    on(el, 'change', '[data-pending]', (e, t) => { st.pending = t.checked; load(); }),
    on(el, 'click', '[data-orient]', (e, t) => { st.orient = t.dataset.orient; saveO(st.orient); el.querySelectorAll('[data-orient]').forEach((b) => b.classList.toggle('on', b === t)); }),
    on(el, 'input', '[data-t]', (e, t) => {
      const all = loadT(); all[tkey()] = { ...titles(), [t.dataset.t]: t.value }; saveT(all);
      const s = $('[data-sheet]', el); if (s) s.innerHTML = sheetHtml(titles());
    }),
    on(el, 'click', '.pv-rep-wrap tr[data-id]', (e, t) => ctx.go('/pv/view?id=' + encodeURIComponent(t.dataset.id))),
    on(el, 'click', '[data-act]', (e, t) => {
      if (t.dataset.act === 'print') print(); else if (t.dataset.act === 'copy') copyExcel(); else if (t.dataset.act === 'close') closeRound(t);
    }),
  ];
  return () => offs.forEach((f) => f());
}
