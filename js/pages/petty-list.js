// รายการเงินสดย่อย (สมุดบัญชีกล่อง) — กรองตามขอบเขต/สถานะ/ประเภท/คำค้น · ดูรายละเอียด + ยกเลิกคำขอของตัวเอง
import { api, money, fmtDate, fmtDateTime, monthLabel, esc, catName, statusBadge, loadPettyCategories } from '../core.js?v=10.0.13';
import { icon, catIcon, toast, toastError, confirmBox, withBtn, sheet, thumbs, hydrateThumbs, empty, errorBox, skeleton, on, debounce, $ } from '../ui.js?v=10.0.13';

const FUND_KEY = 'exion_petty_fund';
function fundId() { try { return localStorage.getItem(FUND_KEY) || null; } catch { return null; } }

const TYPE_TH = { OUT: 'จ่ายออก', IN: 'รับเข้ากล่อง', ADJUST: 'ปรับยอด' };
const STATUS = [['all', 'ทั้งหมด'], ['Pending', 'รออนุมัติ'], ['Approved', 'อนุมัติแล้ว'], ['Paid', 'จ่าย/รับแล้ว'], ['Rejected', 'ไม่อนุมัติ'], ['Cancelled', 'ยกเลิก']];

export async function render(ctx) {
  const { el, profile, query } = ctx;
  const me = String(profile.email || '').toLowerCase();
  const st = { scope: query.scope === 'mine' ? 'mine' : 'all', status: query.status || 'all', type: 'all', q: '', data: null, openId: query.id || '' };
  await loadPettyCategories().catch(() => {});

  async function load() {
    try {
      await api.load('get_petty_ledger', { p_fund_id: fundId(), p_scope: st.scope }, (d) => {
        st.data = d;
        if (!ctx.alive()) return;
        frame();
        // เปิดจากลิงก์ ?id=
        if (st.openId) { const x = (d.items || []).find((i) => i.id === st.openId); st.openId = ''; if (x) openDetail(x); }
      });
    } catch (e) { if (ctx.alive()) errorBox(el, e, load); }
  }

  // โครงหน้า (แถบกรอง) — วาดใหม่เมื่อข้อมูลมา · พิมพ์ค้นหาวาดเฉพาะรายการ
  function frame() {
    const d = st.data || {}, all = d.items || [];
    const hasTypes = all.some((x) => x.type !== 'OUT');
    if (!hasTypes) st.type = 'all';
    el.innerHTML = `
    <div class="stack">
      <div class="grid-4" data-kpi></div>
      <div>
        <div class="toolbar">
          ${d.canSeeAll ? `<div class="seg" role="tablist" aria-label="ขอบเขต">
            <button type="button" data-scope="all" class="${st.scope === 'all' ? 'on' : ''}">ทั้งกล่อง</button>
            <button type="button" data-scope="mine" class="${st.scope === 'mine' ? 'on' : ''}">ของฉัน</button></div>` : ''}
          ${hasTypes ? `<div class="seg" aria-label="ประเภท">${[['all', 'ทุกประเภท'], ['OUT', 'จ่ายออก'], ['IN', 'รับเข้า'], ['ADJUST', 'ปรับยอด']]
            .map(([k, l]) => `<button type="button" data-type="${k}" class="${st.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
          <label class="search">${icon('search')}<input class="input" type="search" data-q value="${esc(st.q)}" placeholder="ค้นหา วัตถุประสงค์ / ร้าน / ชื่อ / เลขที่" aria-label="ค้นหา"></label>
        </div>
        <div class="chips" data-chips></div>
      </div>
      <div data-list></div>
    </div>`;
    paintKpi();
    paintList();
  }

  function paintKpi() {
    const d = st.data || {}, all = d.items || [], bal = d.balance || {};
    const sum = (f) => all.filter(f).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const stat = (l, v, cls = '') => `<div class="stat ${cls}"><div class="l">${l}</div><div class="v">${v}</div></div>`;
    $('[data-kpi]', el).innerHTML = d.canSeeAll && st.scope === 'all'
      ? stat('เงินในกล่อง', money(bal.cash, 0), bal.lowCash ? 'warn' : 'ok') + stat('จ่ายออกแล้ว', money(sum((x) => x.type === 'OUT' && x.status === 'Paid'), 0))
        + stat('เติมเข้ากล่อง', money(sum((x) => x.type === 'IN' && x.status === 'Paid'), 0)) + stat('รออนุมัติ / รอจ่าย', money(sum((x) => x.type === 'OUT' && (x.status === 'Pending' || x.status === 'Approved')), 0), 'warn')
      : stat('รายการทั้งหมด', money(all.length, 0)) + stat('รออนุมัติ', money(sum((x) => x.status === 'Pending'), 0), 'warn')
        + stat('อนุมัติ · รอรับเงิน', money(sum((x) => x.status === 'Approved'), 0)) + stat('ได้รับเงินแล้ว', money(sum((x) => x.type === 'OUT' && x.status === 'Paid'), 0), 'ok');
  }

  function filtered(ignoreStatus = false) {
    const q = st.q.toLowerCase();
    return (st.data?.items || []).filter((x) =>
      (ignoreStatus || st.status === 'all' || x.status === st.status) &&
      (st.type === 'all' || x.type === st.type) &&
      (!q || [x.id, x.purpose, x.payee, x.requester_name, x.note, catName(x.category)].some((v) => String(v || '').toLowerCase().includes(q))));
  }

  function paintList() {
    const d = st.data || {};
    // นับตามสถานะ (หลังกรองประเภท/คำค้น)
    const base = filtered(true);
    const cnt = (k) => (k === 'all' ? base.length : base.filter((x) => x.status === k).length);
    $('[data-chips]', el).innerHTML = STATUS.filter(([k]) => k === 'all' || k === st.status || cnt(k))
      .map(([k, l]) => `<button type="button" class="chip ${st.status === k ? 'on' : ''}" data-status="${k}">${l} <span class="n">${cnt(k)}</span></button>`).join('');

    const rows = filtered();
    const list = $('[data-list]', el);
    if (!rows.length) {
      const none = !(d.items || []).length;
      list.innerHTML = `<div class="card">${empty({ ic: none ? 'wallet' : 'search', title: none ? 'ยังไม่มีรายการ' : 'ไม่พบรายการที่ตรงเงื่อนไข',
        sub: none ? 'เมื่อขอเบิกเงินสดย่อย รายการจะแสดงที่นี่' : 'ลองเปลี่ยนตัวกรองหรือคำค้น',
        action: none ? `<a class="btn btn-primary" href="#/petty/request">${icon('plus')} ขอเบิกเงินสดย่อย</a>` : '' })}</div>`;
      return;
    }
    const run = d.canSeeAll && st.scope === 'all' ? runningBalance(d.items || []) : null;
    // จัดกลุ่มตามเดือนที่ส่ง
    const groups = [];
    rows.forEach((x) => {
      const t = new Date(x.created_at), key = t.getFullYear() * 100 + t.getMonth() + 1;
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) { g = { key, y: t.getFullYear(), m: t.getMonth() + 1, items: [] }; groups.push(g); }
      g.items.push(x);
    });
    list.innerHTML = `<div class="card"><div class="list">${groups.map((g) => {
      const out = g.items.filter((x) => x.type === 'OUT' && x.status !== 'Rejected' && x.status !== 'Cancelled').reduce((s, x) => s + Number(x.amount || 0), 0);
      return `<div class="group-label"><span>${monthLabel(g.y, g.m, true)} · ${g.items.length} รายการ</span>${out ? `<span class="amount">จ่ายออก ${money(out)}</span>` : ''}</div>`
        + g.items.map((x) => row(x, { who: (d.canSeeAll && st.scope === 'all') || String(x.requester_email || '').toLowerCase() !== me, after: run?.get(x.id) })).join('');
    }).join('')}</div></div>`;
  }

  function openDetail(x) {
    const mine = String(x.requester_email || '').toLowerCase() === me;
    const canCancel = (mine || profile.role?.isGM) && (x.status === 'Pending' || x.status === 'Approved');
    const s = sheet({
      title: x.type === 'OUT' ? 'รายละเอียดคำขอเบิก' : TYPE_TH[x.type] || 'รายละเอียด',
      body: detailBody(x),
      foot: `<button class="btn btn-secondary" data-x>ปิด</button>${canCancel ? `<button class="btn btn-danger" data-cancel>${icon('x-circle')} ยกเลิกคำขอ</button>` : ''}`,
      onMount: (sh, close) => {
        hydrateThumbs(sh);
        const cbtn = sh.querySelector('[data-cancel]');
        cbtn?.addEventListener('click', async () => {
          const ok = await confirmBox({ title: 'ยกเลิกคำขอนี้?', message: `${x.purpose || catName(x.category)}\n${money(x.amount)} บาท${x.status === 'Approved' ? '\nรายการนี้อนุมัติแล้ว — ยกเลิกแล้วจะไม่ได้รับเงินสด' : ''}`, ok: 'ยกเลิกคำขอ', cancel: 'ไม่ยกเลิก', danger: true });
          if (!ok) return;
          try {
            await withBtn(cbtn, () => api.rpc('cancel_petty', { p_id: x.id }));
            toast('ยกเลิกคำขอแล้ว');
            close(true);
            ctx.refreshBadges();
            load();
          } catch (err) { toastError(err); }
        });
      },
    });
    return s;
  }

  el.innerHTML = skeleton(5);
  await load();

  const reSearch = debounce(() => { if (ctx.alive()) paintList(); }, 200);
  const offs = [
    on(el, 'click', '[data-scope]', (e, t) => { if (st.scope === t.dataset.scope) return; st.scope = t.dataset.scope; st.status = 'all'; el.innerHTML = skeleton(5); load(); }),
    on(el, 'click', '[data-type]', (e, t) => { st.type = t.dataset.type; el.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('on', b === t)); paintList(); }),
    on(el, 'click', '[data-status]', (e, t) => { st.status = t.dataset.status; paintList(); }),
    on(el, 'input', '[data-q]', (e, t) => { st.q = t.value.trim(); reSearch(); }),
    on(el, 'click', '[data-open]', (e, t) => { const x = (st.data?.items || []).find((i) => i.id === t.dataset.open); if (x) openDetail(x); }),
    on(el, 'keydown', '[data-open]', (e, t) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); } }),
  ];
  return () => offs.forEach((f) => f());
}

// ยอดคงเหลือหลังแต่ละรายการที่จ่าย/รับแล้ว (เรียงตามเวลาที่จ่ายจริง)
function runningBalance(items) {
  const paid = items.filter((x) => x.status === 'Paid').sort((a, b) => new Date(a.paid_at || a.created_at) - new Date(b.paid_at || b.created_at));
  const m = new Map(); let bal = 0;
  paid.forEach((x) => { const a = Number(x.amount) || 0; bal += x.type === 'OUT' ? -a : a; m.set(x.id, bal); });
  return m;
}

// ─────────────── แถว / รายละเอียด ───────────────
function row(x, { who = false, after } = {}) {
  const title = x.type === 'OUT' ? (x.purpose || catName(x.category)) : catName(x.category);
  const sub = [fmtDate(x.expense_date || x.created_at), x.type === 'OUT' ? catName(x.category) : x.purpose, x.type === 'OUT' ? x.payee : '']
    .filter(Boolean).map(esc).join(' · ');
  const files = (x.receipt_paths || []).length ? ` · ${icon('paperclip', 'sm')}${x.receipt_paths.length}` : '';
  return `<div class="row click" role="button" tabindex="0" data-open="${esc(x.id)}">${catIcon(x.category)}
    <div class="row-main"><div class="row-title">${who ? esc(x.requester_name) + ' · ' : ''}${esc(title)}</div><div class="row-sub">${sub}${files}</div></div>
    <div class="row-end">${signed(x)}${badge(x)}${after != null ? `<span class="text-xs muted">คงเหลือ ${money(after)}</span>` : ''}</div></div>`;
}
function signed(x) {
  const a = Number(x.amount) || 0;
  const v = x.type === 'OUT' ? -a : a;      // IN = บวก · ADJUST ตามเครื่องหมายของยอด
  const dead = x.status === 'Rejected' || x.status === 'Cancelled';   // ไม่มีผลกับยอดกล่อง
  return `<span class="amount ${dead ? 'faint' : v > 0 ? 'ok-text' : ''}">${v > 0 ? '+' : '−'}${money(Math.abs(v))}</span>`;
}
function badge(x) {
  if (x.type === 'ADJUST') return statusBadge('Paid', 'ปรับยอดแล้ว');
  if (x.type === 'IN' && x.status === 'Paid') return statusBadge('Paid', 'เข้ากล่องแล้ว');
  if (x.type === 'IN' && x.status === 'Approved') return statusBadge('Approved', 'อนุมัติ · รอรับเงิน');
  if (x.type === 'OUT' && x.status === 'Approved') return statusBadge('Approved', 'อนุมัติ · รอรับเงินสด');
  return statusBadge(x.status);
}
function detailBody(x) {
  const kv = [
    ['เลขที่', x.id],
    ['ประเภท', TYPE_TH[x.type] || x.type],
    ['หมวด', catName(x.category)],
    ['วันที่ใช้จ่าย', x.expense_date ? fmtDate(x.expense_date) : ''],
    ['ผู้รับเงิน / ร้าน', x.payee],
    ['วัตถุประสงค์', x.purpose],
    ['ผู้ขอ', (x.requester_name || x.requester_email) + (x.on_behalf_by ? ` (เบิกแทนโดย ${x.on_behalf_by})` : '')],
    ['ส่งเมื่อ', fmtDateTime(x.created_at)],
    ['ผู้อนุมัติ', x.decided_by || (x.status === 'Pending' ? x.approver_email : '')],
    ['อนุมัติเมื่อ', x.approved_at ? fmtDateTime(x.approved_at) : ''],
    ['จ่าย/รับเมื่อ', x.paid_at ? fmtDateTime(x.paid_at) + (x.paid_by ? ' · ' + x.paid_by : '') : ''],
    ['หมายเหตุ', x.note],
  ].filter(([, v]) => v);
  const files = x.receipt_paths || [];
  return `<div class="stack-sm">
    <div class="flex between wrap"><div class="callout-amount">${signed(x).replace('class="amount', 'class="v amount')}<span class="muted">บาท</span></div>${badge(x)}</div>
    ${x.status === 'Rejected' && x.approver_remark ? `<div class="alert bad">${icon('x-circle')}<div><b>ไม่อนุมัติ</b> · ${esc(x.approver_remark)}</div></div>`
      : x.approver_remark ? `<div class="alert neutral">${icon('info')}<div>${esc(x.approver_remark)}</div></div>` : ''}
    <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="divider"></div>
    <div class="label">${icon('paperclip', 'sm')} ใบเสร็จ ${files.length ? `(${files.length})` : ''}</div>
    ${files.length ? thumbs(files) : '<p class="muted text-sm">ไม่มีใบเสร็จแนบ</p>'}
  </div>`;
}
