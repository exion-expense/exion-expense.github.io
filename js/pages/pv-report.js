// รายการที่จ่ายแล้วรายเดือน (ใบสำคัญจ่าย) — คอลัมน์ตามไฟล์ของบัญชี · สรุป PAID / Pending ท้ายตาราง · พิมพ์ได้ · ก๊อปไปวาง Excel
// รวมทั้งรอบ Petty cash และรอบวันที่ 20 · แผนกเป็น EXION CODE · Description = ชื่อหมวดภาษาอังกฤษ
import { api, money, esc } from '../core.js?v=10.4.1';
import { icon, toast, empty, errorBox, skeleton, on, $ } from '../ui.js?v=10.4.1';

const COLS = ['No.', 'Suppliers', 'Description', 'Amount', 'Department', 'Prepared By', 'Status', 'Payment date'];
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const TKEY = 'exion_pv_report_title';
const loadT = () => { try { return JSON.parse(localStorage.getItem(TKEY) || '{}'); } catch { return {}; } };
const saveT = (v) => { try { localStorage.setItem(TKEY, JSON.stringify(v)); } catch { /* */ } };

export async function render(ctx) {
  const { el, query } = ctx;
  const st = { month: /^\d{4}-\d{2}$/.test(query.m || '') ? query.m : ym(new Date()), test: false, pending: false, d: null, seq: 0 };

  function titles() {
    const d = st.d, saved = loadT()[st.month] || {};
    return {
      t1: saved.t1 ?? `Other Operation Expense of ${d.monthLabel}`,
      t2: saved.t2 ?? `(F-3) Petty Cash Account - Top Up to meet ${money(d.limit || 0)} THB`,
    };
  }
  function sheetHtml(t) {
    const d = st.d;
    return `<div class="pv-rep">
      <div class="pv-rep-hd"><div><div class="pv-rep-t1">${esc(t.t1)}</div><div class="pv-rep-t2">${esc(t.t2)}</div></div><img src="brand/logo.png" alt="EXION Thailand"></div>
      <table class="pv-rep-tbl"><thead><tr>${COLS.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
        ${d.items.map((x, i) => `<tr data-id="${esc(x.id)}"><td class="c">${i + 1}</td><td>${esc(x.supplier)}</td><td>${esc(x.description)}</td><td class="r">${money(x.amount)}</td>
          <td>${esc(x.department)}</td><td>${esc(x.preparedBy)}</td><td class="c"><b>${esc(x.status)}</b></td><td class="c">${esc(x.paymentDate)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td></td><td></td><td class="r">TOTAL</td><td class="r">${money(d.total)}</td><td colspan="4"></td></tr></tfoot></table>
      <table class="pv-rep-sum"><tbody>
        <tr><td>PAID</td><td class="r">${money(d.paidTotal ?? d.total)}</td></tr>
        <tr><td>Pending</td><td class="r">${Number(d.pendingTotal) ? money(d.pendingTotal) : '-'}</td></tr>
        <tr class="tot"><td></td><td class="r">${money(d.total)}</td></tr>
      </tbody></table></div>`;
  }

  async function load() {
    const my = ++st.seq;
    history.replaceState(null, '', location.pathname + location.search + '#/pv/report?m=' + st.month);
    $('[data-body]', el).innerHTML = skeleton(4);
    try {
      const d = await api.rpc('get_pv_report', { p_month: st.month + '-01', p_test: st.test, p_pending: st.pending });
      if (!ctx.alive() || my !== st.seq) return;
      st.d = d; paint();
    } catch (e) { if (ctx.alive() && my === st.seq) errorBox($('[data-body]', el), e, load); }
  }
  function paint() {
    const d = st.d, t = titles();
    $('[data-testbox]', el).classList.toggle('hidden', !d.isFin);
    $('[data-body]', el).innerHTML = !d.items.length
      ? `<div class="card">${empty({ ic: 'receipt', title: 'ยังไม่มีรายการที่จ่ายในเดือนนี้' })}</div>`
      : `<div class="card pad stack-sm">
          <div class="form-grid two">
            <div class="field"><label for="rp-t1">หัวรายงาน บรรทัด 1</label><input class="input" id="rp-t1" data-t="t1" maxlength="150" value="${esc(t.t1)}"></div>
            <div class="field"><label for="rp-t2">หัวรายงาน บรรทัด 2</label><input class="input" id="rp-t2" data-t="t2" maxlength="150" value="${esc(t.t2)}"></div>
          </div>
          <div class="flex between wrap"><span class="text-sm muted">${d.items.length} รายการ · กดแถวเพื่อเปิดใบ</span><span class="text-sm">รวม <b class="amount">${money(d.total)}</b> บาท</span></div>
        </div>
        <div class="pv-rep-wrap" data-sheet>${sheetHtml(t)}</div>`;
  }

  function print() {
    if (!st.d?.items.length) return;
    document.querySelector('.pv-print-root')?.remove();
    const root = document.createElement('div');
    root.className = 'pv-print-root';
    root.innerHTML = sheetHtml(titles());
    document.body.appendChild(root);
    document.body.classList.add('printing-pv');
    const done = () => { document.body.classList.remove('printing-pv'); root.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 300);
  }
  async function copyExcel() {
    if (!st.d?.items.length) return;
    const t = titles(), clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
    const rows = [[t.t1], [t.t2], COLS, ...st.d.items.map((x, i) => [i + 1, x.supplier, x.description, Number(x.amount).toFixed(2), x.department, x.preparedBy, x.status, x.paymentDate]),
      ['', '', 'TOTAL', Number(st.d.total).toFixed(2)], [], ['', '', 'PAID', Number(st.d.paidTotal ?? st.d.total).toFixed(2)],
      ['', '', 'Pending', Number(st.d.pendingTotal) ? Number(st.d.pendingTotal).toFixed(2) : '-'], ['', '', '', Number(st.d.total).toFixed(2)]];
    try { await navigator.clipboard.writeText(rows.map((r) => r.map(clean).join('\t')).join('\n')); toast('ก๊อปแล้ว · ไปวางใน Excel ได้เลย'); }
    catch { toast('ก๊อปไม่ได้ — ลองกดพิมพ์ แล้วเลือกบันทึกเป็น PDF แทน', 'bad'); }
  }

  el.innerHTML = `<div class="stack">
    <div class="toolbar" style="margin-bottom:0">
      <div class="field" style="margin:0"><label for="rp-m" class="text-sm">เดือนที่จ่าย</label><input type="month" class="input" id="rp-m" data-m value="${st.month}"></div>
      <label class="check"><input type="checkbox" data-pending> รวมใบที่อนุมัติแล้วแต่ยังไม่จ่าย (Pending)</label>
      <label class="check hidden" data-testbox><input type="checkbox" data-test> รวมใบทดลอง</label>
      <button type="button" class="btn btn-secondary" data-act="copy">${icon('sheet')} ก๊อปไป Excel</button>
      <button type="button" class="btn btn-primary" data-act="print">${icon('file')} พิมพ์</button>
    </div>
    <div class="stack" data-body></div></div>`;
  await load();
  const offs = [
    on(el, 'change', '[data-m]', (e, t) => { if (t.value) { st.month = t.value; load(); } }),
    on(el, 'change', '[data-test]', (e, t) => { st.test = t.checked; load(); }),
    on(el, 'change', '[data-pending]', (e, t) => { st.pending = t.checked; load(); }),
    on(el, 'input', '[data-t]', (e, t) => {
      const all = loadT(); all[st.month] = { ...titles(), [t.dataset.t]: t.value }; saveT(all);
      const s = $('[data-sheet]', el); if (s) s.innerHTML = sheetHtml(titles());
    }),
    on(el, 'click', '.pv-rep-wrap tr[data-id]', (e, t) => ctx.go('/pv/view?id=' + encodeURIComponent(t.dataset.id))),
    on(el, 'click', '[data-act]', (e, t) => { if (t.dataset.act === 'print') print(); else if (t.dataset.act === 'copy') copyExcel(); }),
  ];
  return () => offs.forEach((f) => f());
}
