// ตาราง MSBC (บัญชี) — บิลเงินสดย่อยตามช่วงวันที่ เรียงคอลัมน์ตรงไฟล์ MSBC · ก๊อปไปวาง หรือโหลด Excel
import { api, money, fmtDate, esc, ymd, todayYMD } from '../core.js?v=10.0.14';
import { icon, toast, toastError, withBtn, errorBox, empty, skeleton, on, $ } from '../ui.js?v=10.0.14';

const FUND_KEY = 'exion_petty_fund';
function fundId() { try { return localStorage.getItem(FUND_KEY) || null; } catch { return null; } }

// ลำดับคอลัมน์ต้องตรงกับไฟล์ MSBC ของบัญชี (MSBC_COLS เดิม) ไม่งั้นวางแล้วเลื่อน
const COLS = [
  ['supplier', 'Suppliers'], ['description', 'Description'], ['amount', 'Amount'], ['department', 'Department'], ['preparedBy', 'Prepared By'],
  ['status', 'Status'], ['paymentDate', 'Payment date'], ['processingDate', 'Processing Date'], ['dueDate', 'Payment due date'], ['remark', 'Remark'],
];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// กันช่องแตกตอนวางใน Excel + กันข้อความที่ขึ้นต้นด้วย = + - @ กลายเป็นสูตร (แทรก ' นำหน้า)
const flat = (s) => { const v = String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim(); return /^[=+\-@]/.test(v) ? "'" + v : v; };

export async function render(ctx) {
  const { el } = ctx;
  const now = new Date();
  const st = {
    from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayYMD(), inc: true,
    title: '', titleEdited: false, data: null, removed: new Set(), withHead: false,
  };

  el.innerHTML = `
  <div class="stack">
    <div class="card pad stack-sm">
      <div class="form-grid two">
        <div class="field"><label for="ms-from">ตั้งแต่วันที่</label><input type="date" class="input" id="ms-from" data-from value="${st.from}"></div>
        <div class="field"><label for="ms-to">ถึงวันที่</label><input type="date" class="input" id="ms-to" data-to value="${st.to}"></div>
      </div>
      <div class="chips" data-quick></div>
      <label class="check"><input type="checkbox" data-inc checked> รวมรายการที่ยังไม่จ่ายเงิน (Pending)</label>
      <div class="field"><label for="ms-title">หัวรายงาน <span class="opt">แก้ได้</span></label><input class="input" id="ms-title" data-title maxlength="120"></div>
    </div>
    <div data-body>${skeleton(5)}</div>
  </div>`;
  const body = $('[data-body]', el);

  async function load() {
    if (st.from && st.to && st.from > st.to) { body.innerHTML = `<div class="alert warn">${icon('alert')}<div>วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด</div></div>`; return; }
    try {
      await api.load('get_petty_msbc', { p_fund_id: fundId(), p_from: st.from || null, p_to: st.to || null, p_include_pending: st.inc }, (d) => {
        st.data = d;
        st.removed = new Set([...st.removed].filter((id) => (d.items || []).some((x) => x.id === id)));
        if (!st.titleEdited) { st.title = d.titleSuggest || ''; $('[data-title]', el).value = st.title; }
        if (ctx.alive()) { paintQuick(); paint(); }
      });
    } catch (e) { if (ctx.alive()) errorBox(body, e, load); }
  }

  // ทางลัดช่วงวันที่
  function ranges() {
    const y = now.getFullYear(), m = now.getMonth();
    const out = [['month', 'เดือนนี้', ymd(new Date(y, m, 1)), todayYMD()], ['prev', 'เดือนก่อน', ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))]];
    const since = st.data?.live?.lastTopUpAt;
    if (since) out.push(['since', `ตั้งแต่เติมเงินล่าสุด (${fmtDate(since)})`, since, todayYMD()]);
    out.push(['all', 'ทั้งหมด', '', '']);
    return out;
  }
  function paintQuick() {
    $('[data-quick]', el).innerHTML = ranges().map(([k, l, f, t]) => `<button type="button" class="chip ${st.from === f && st.to === t ? 'on' : ''}" data-range="${k}">${esc(l)}</button>`).join('');
  }

  const visible = () => (st.data?.items || []).filter((x) => !st.removed.has(x.id));

  function paint() {
    const d = st.data || {}, rows = visible();
    const all = d.items || [];
    if (!all.length) {
      body.innerHTML = `<div class="card">${empty({ ic: 'sheet', title: 'ไม่มีบิลในช่วงที่เลือก', sub: st.inc ? 'ลองเปลี่ยนช่วงวันที่' : 'ลองเลือก “รวมรายการที่ยังไม่จ่ายเงิน” หรือเปลี่ยนช่วงวันที่' })}</div>`;
      return;
    }
    const total = r2(rows.reduce((s, x) => s + Number(x.amount || 0), 0));
    const byDept = {}, bySt = { Paid: 0, Pending: 0 };
    rows.forEach((x) => {
      const k = String(x.department || '').trim() || '(ไม่ระบุ)';
      byDept[k] = r2((byDept[k] || 0) + Number(x.amount || 0));
      bySt[x.status === 'Paid' ? 'Paid' : 'Pending'] += Number(x.amount || 0);
    });
    const unmapped = [...new Set(all.filter((x) => x.deptUnmapped && x.department).map((x) => x.department))];
    const topUp = Number(d.topUp) || 0;
    const mini = (title, pairs, foot) => `<div class="card"><div class="card-head"><h3>${title}</h3></div><div class="pad"><dl class="kv tight">
      ${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="text-right amount">${money(v)}</dd>`).join('')}
      <dt class="bold">${foot[0]}</dt><dd class="text-right amount">${money(foot[1])}</dd></dl></div></div>`;

    body.innerHTML = `<div class="stack">
      ${unmapped.length ? `<div class="alert warn">${icon('alert')}<div><b>แผนกที่ยังไม่มีรหัส MSBC:</b> ${unmapped.map(esc).join(' · ')}
        <div class="text-sm mt-4">ตอนนี้ใส่ชื่อแผนกเดิมไปก่อน — ให้แอดมินเพิ่มในตาราง settings คีย์ <b>PETTY_DEPT_MAP</b> เช่น Sales=VS, Service=CS</div></div></div>` : ''}

      <div class="toolbar between">
        <div><b>${rows.length}</b> รายการ · รวม <b class="amount">${money(total)}</b> บาท
          ${st.removed.size ? `<span class="text-sm muted"> · ตัดออก ${st.removed.size} แถว</span> <button type="button" class="btn btn-ghost btn-sm" data-act="restore">${icon('rotate-ccw', 'sm')} คืนทั้งหมด</button>` : ''}</div>
        <div class="flex wrap">
          <label class="check text-sm"><input type="checkbox" data-head ${st.withHead ? 'checked' : ''}> ก๊อปหัวคอลัมน์ด้วย</label>
          <button type="button" class="btn btn-secondary btn-sm" data-act="copy">${icon('copy', 'sm')} ก๊อปตาราง</button>
          <button type="button" class="btn btn-primary btn-sm" data-act="excel" data-busy="กำลังสร้างไฟล์…">${icon('download', 'sm')} ดาวน์โหลด Excel</button>
        </div>
      </div>

      <div class="table-wrap"><table class="tbl">
        <thead><tr><th class="r">No.</th>${COLS.map(([k, h]) => `<th class="${k === 'amount' ? 'r' : ''}">${h}</th>`).join('')}<th aria-label="ตัดออก"></th></tr></thead>
        <tbody>${rows.map((x, i) => `<tr>
          <td class="r muted">${i + 1}</td>
          <td>${esc(x.supplier || '-')}</td>
          <td style="min-width:220px">${esc(x.description)}</td>
          <td class="r">${money(x.amount)}</td>
          <td>${x.deptUnmapped ? `<span class="badge b-pending plain" title="ยังไม่มีรหัส MSBC">${esc(x.department || '(ไม่ระบุ)')}</span>` : esc(x.department)}</td>
          <td class="nowrap">${esc(x.preparedBy)}</td>
          <td>${x.status === 'Paid' ? '<span class="badge b-paid plain">Paid</span>' : '<span class="badge b-pending plain">Pending</span>'}</td>
          <td class="nowrap">${esc(x.paymentDate)}</td>
          <td class="nowrap">${esc(x.processingDate)}</td>
          <td class="nowrap">${esc(x.dueDate)}</td>
          <td>${esc(x.remark)}</td>
          <td><button type="button" class="btn-icon sm" data-rm="${esc(x.id)}" aria-label="ตัดแถวที่ ${i + 1} ออก" title="ตัดแถวนี้ออก (ไม่ลบข้อมูลจริง)">${icon('x')}</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td></td><td class="text-right">TOTAL</td><td class="r">${money(total)}</td><td colspan="8"></td></tr></tfoot>
      </table></div>
      <p class="hint">ตัดแถวออกเฉพาะในตารางนี้ (ก๊อป/Excel ไม่รวมแถวที่ตัด) — ข้อมูลในระบบไม่เปลี่ยน</p>

      <div class="grid-3 collapse">
        ${mini('ตามแผนก', Object.keys(byDept).sort().map((k) => [k, byDept[k]]), ['TOTAL', total])}
        ${mini('ตามสถานะ', [['Paid', bySt.Paid], ['Pending', bySt.Pending]], ['TOTAL', total])}
        ${mini('ยอดกล่อง', [['Petty Cash Account - Top Up to meet', topUp], ['Operation Expense', total]], ['Balance', topUp - total])}
      </div>
    </div>`;
  }

  // แปลงแถวเป็นรูปแบบที่ Excel (buildMsbc) ใช้
  const exportRows = () => visible().map((x) => Object.fromEntries(COLS.map(([k]) => [k, k === 'amount' ? r2(x.amount) : flat(x[k])])));

  async function copy() {
    const rows = exportRows();
    if (!rows.length) return toast('ไม่มีรายการให้ก๊อป', 'bad');
    const lines = rows.map((r, i) => [i + 1, ...COLS.map(([k]) => (k === 'amount' ? Number(r.amount).toFixed(2) : r[k]))].join('\t'));
    if (st.withHead) lines.unshift(['No.', ...COLS.map(([, h]) => h)].join('\t'));
    const tsv = lines.join('\n');
    let ok = false;
    try { await navigator.clipboard.writeText(tsv); ok = true; }
    catch {
      // เบราว์เซอร์บางตัว/หน้าที่ไม่ใช่ https ใช้ clipboard API ไม่ได้
      const ta = document.createElement('textarea');
      ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    toast(ok ? `ก๊อป ${rows.length} แถวแล้ว — ไปวางในไฟล์ MSBC ได้เลย` : 'ก๊อปไม่สำเร็จ — ใช้ปุ่มดาวน์โหลด Excel แทน', ok ? 'ok' : 'bad');
  }

  async function excel(btn) {
    const rows = exportRows();
    if (!rows.length) return toast('ไม่มีรายการให้ดาวน์โหลด', 'bad');
    try {
      await withBtn(btn, async () => {
        const meta = await api.excel({ type: 'msbc', fundId: st.data?.fund?.fundId || fundId() || '', title: st.title || st.data?.titleSuggest || '', rows });
        toast(`ดาวน์โหลดแล้ว · ${meta.count ?? rows.length} รายการ · ${money(meta.total ?? 0)} บาท`);
      });
    } catch (e) { toastError(e); }
  }

  await load();

  const reload = () => { body.innerHTML = skeleton(5); load(); };
  const offs = [
    on(el, 'change', '[data-from],[data-to]', () => {
      st.from = $('[data-from]', el).value; st.to = $('[data-to]', el).value;
      paintQuick(); reload();
    }),
    on(el, 'click', '[data-range]', (e, t) => {
      const r = ranges().find((x) => x[0] === t.dataset.range); if (!r) return;
      st.from = r[2]; st.to = r[3];
      $('[data-from]', el).value = st.from; $('[data-to]', el).value = st.to;
      paintQuick(); reload();
    }),
    on(el, 'change', '[data-inc]', (e, t) => { st.inc = t.checked; reload(); }),
    on(el, 'input', '[data-title]', (e, t) => { st.title = t.value; st.titleEdited = !!t.value.trim(); }),
    on(el, 'change', '[data-head]', (e, t) => { st.withHead = t.checked; }),
    on(el, 'click', '[data-rm]', (e, t) => { st.removed.add(t.dataset.rm); paint(); }),
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'restore') { st.removed.clear(); paint(); }
      else if (a === 'copy') copy();
      else if (a === 'excel') excel(t);
    }),
  ];
  return () => offs.forEach((f) => f());
}
