// ขออนุมัติงบล่วงหน้า (ค่ารับรอง / กอล์ฟ) ของฉัน — ดูสถานะงบ แล้วส่งบิลจริงเมื่ออนุมัติแล้ว
import { api, money, esc, fmtDate, catName, statusBadge } from '../core.js?v=10.0.13';
import { icon, catIcon, toast, toastError, confirmBox, busy, empty, on } from '../ui.js?v=10.0.13';

const isFinalBill = (r) => String(r.batch_id || '').startsWith('FINALIZE-');
const cleanRemark = (s) => String(s || '').split(' sig:')[0].trim();
const FILTERS = [['all', 'ทั้งหมด'], ['pending', 'รออนุมัติงบ'], ['ready', 'รอส่งบิล'], ['done', 'ส่งบิลแล้ว'], ['rejected', 'ไม่อนุมัติ']];

/** สถานะของงบ: pending | ready | done | rejected */
function stateOf(p) {
  if (p.preapprove_status === 'Rejected' || (p.status === 'Rejected' && !isFinalBill(p))) return 'rejected';
  if (p.preapprove_status === 'Approved') return p.status === 'PreApprove' ? 'ready' : 'done';
  if (p.status === 'Finalized') return 'done';
  return 'pending';
}
const CHIP = {
  pending: ['รออนุมัติงบ', 'b-pending'], ready: ['อนุมัติแล้ว · รอส่งบิล', 'b-approved'],
  done: ['ส่งบิลแล้ว', 'b-info'], rejected: ['ไม่อนุมัติ', 'b-rejected'],
};
function custHtml(c) {
  const m = /^\[(.+?)\]\s*(.*)$/.exec(String(c || ''));
  return m ? `<span class="badge b-neutral plain">${esc(m[1])}</span> ${esc(m[2])}` : esc(c);
}

/** แยกแถวงบ + รวมยอดบิลจริงที่ส่งจากงบนั้น */
function budgetsOf(rows) {
  const bills = {};
  rows.filter(isFinalBill).forEach((r) => { (bills[r.batch_id.slice(9)] ||= []).push(r); });
  return rows
    .filter((r) => (r.preapprove_status || r.status === 'PreApprove' || r.status === 'Finalized') && (!isFinalBill(r) || r.batch_id === 'FINALIZE-' + r.id))
    .map((p) => {
      const b = bills[p.id] || [];
      return { ...p, st: stateOf(p), bills: b, actual: b.reduce((s, x) => s + Number(x.amount || 0), 0) };
    })
    .sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || '')) || String(b.created_at).localeCompare(String(a.created_at)));
}

export async function render(ctx) {
  const { el } = ctx;
  const S = { list: [], filter: 'all' };
  await api.load('get_my_requests', {}, (rows) => { S.list = budgetsOf(rows || []); paint(); });

  function paint() {
    if (!ctx.alive()) return;
    const L = S.list;
    const cnt = (k) => L.filter((p) => p.st === k).length;
    const outstanding = L.filter((p) => p.st === 'ready').reduce((s, p) => s + Number(p.preapprove_budget || 0), 0);
    const shown = L.filter((p) => S.filter === 'all' || p.st === S.filter);
    el.innerHTML = `<div class="page-head"><div><h1>ขออนุมัติงบล่วงหน้า</h1><div class="sub">ค่ารับรองลูกค้า / ค่ากอล์ฟ</div></div>
        <div class="actions"><a class="btn btn-primary" href="#/preapprovals/new">${icon('plus')} ขออนุมัติงบ</a></div></div>
      <div class="split">
        <div class="stack">
          ${L.length ? `<div class="chips">${FILTERS.map(([k, l]) => `<button type="button" class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-k="${k}" aria-pressed="${S.filter === k}">
            ${l}<span class="n">${k === 'all' ? L.length : cnt(k)}</span></button>`).join('')}</div>` : ''}
          ${!L.length ? `<div class="card">${empty({ ic: 'shield', title: 'ยังไม่มีคำขออนุมัติงบ', sub: 'ก่อนเลี้ยงรับรองหรือตีกอล์ฟกับลูกค้า ขออนุมัติงบไว้ก่อน แล้วค่อยส่งบิลจริง',
              action: `<a class="btn btn-primary" href="#/preapprovals/new">${icon('plus')} ขออนุมัติงบ</a>` })}</div>`
            : shown.length ? shown.map(card).join('')
            : `<div class="card">${empty({ ic: 'search', title: 'ไม่มีรายการในสถานะนี้' })}</div>`}
        </div>
        <div class="stack">
          <div class="grid-2">
            <div class="stat warn"><div class="l">${icon('clock', 'sm')} รออนุมัติงบ</div><div class="v">${cnt('pending')}</div></div>
            <div class="stat ok"><div class="l">${icon('receipt', 'sm')} รอส่งบิล</div><div class="v">${cnt('ready')}</div><div class="d">งบรวม ฿${money(outstanding, 0)}</div></div>
          </div>
          <div class="alert">${icon('info')}<div><b>ขั้นตอน</b>
            <div class="text-sm mt-4">1. ขออนุมัติงบก่อนใช้จ่าย — หัวหน้าได้รับแจ้งทันที<br>2. เมื่ออนุมัติแล้ว ใช้จ่ายตามแผน<br>
            3. กด <b>ส่งบิลจริง</b> ใส่ยอดจริงพร้อมแนบใบเสร็จ (แยกได้หลายบิล)<br>4. หัวหน้าอนุมัติบิลจริงอีกครั้ง — ถ้ายอดเกินงบ หัวหน้าจะเห็นว่าเกิน</div></div></div>
        </div>
      </div>`;
  }

  function card(p) {
    const [t, cls] = CHIP[p.st];
    const reason = cleanRemark(p.manager_remark) || cleanRemark(p.remark);
    const over = p.st === 'done' && p.actual > Number(p.preapprove_budget || 0);
    const billSt = p.bills.length ? [...new Set(p.bills.map((b) => b.status))] : [];
    return `<div class="card">
      <div class="pad stack-sm">
        <div class="flex gap-12">${catIcon(p.category)}
          <div class="grow"><div class="bold">${esc(catName(p.category))}</div><div class="text-sm muted">${fmtDate(p.expense_date, { full: true })}</div></div>
          <div class="text-right"><div class="amount text-lg">฿${money(p.preapprove_budget, 0)}</div><span class="badge ${cls}">${t}</span></div></div>
        ${p.venue || p.customer ? `<div class="text-sm">${p.venue ? `${icon('map', 'sm')} ${esc(p.venue)}` : ''}${p.venue && p.customer ? ' · ' : ''}${p.customer ? custHtml(p.customer) : ''}</div>` : ''}
        ${p.occasion ? `<div class="text-sm muted">${esc(p.occasion)}${p.attendees ? ` · ผู้ร่วม ${esc(p.attendees)}` : ''}</div>` : ''}
        ${p.st === 'rejected' ? `<div class="alert bad">${icon('x-circle')}<span>${reason ? 'เหตุผล: ' + esc(reason) : 'ไม่อนุมัติงบนี้'}</span></div>` : ''}
        ${p.st === 'done' ? `<div class="flex between wrap text-sm"><span>ยอดจริง <b class="amount ${over ? 'bad-text' : ''}">฿${money(p.actual)}</b> จากงบ ฿${money(p.preapprove_budget, 0)}
            ${over ? ' · <b class="bad-text">เกินงบ</b>' : ''} · ${p.bills.length} บิล</span><span>${billSt.map((s) => statusBadge(s)).join(' ')}</span></div>` : ''}
      </div>
      ${p.st === 'ready' ? `<div class="card-foot flex"><a class="btn btn-primary grow" href="#/preapprovals/${encodeURIComponent(p.id)}/finalize">${icon('receipt')} ส่งบิลจริง</a>
          <button type="button" class="btn btn-ghost" data-act="cancel" data-id="${esc(p.id)}">ยกเลิกงบ</button></div>`
        : p.st === 'pending' ? `<div class="card-foot flex between"><span class="text-sm muted">${icon('clock', 'sm')} รอหัวหน้าพิจารณา</span>
          <button type="button" class="btn btn-ghost" data-act="cancel" data-id="${esc(p.id)}">ยกเลิกคำขอ</button></div>`
        : p.st === 'done' ? `<div class="card-foot"><a class="btn btn-secondary btn-block" href="#/requests?id=${encodeURIComponent(p.bills[0]?.id || p.id)}">${icon('eye')} ดูบิลจริง</a></div>` : ''}
    </div>`;
  }

  return on(el, 'click', '[data-act]', async (e, t) => {
    if (t.dataset.act === 'filter') { S.filter = t.dataset.k; paint(); return; }
    if (t.dataset.act === 'cancel') {
      const p = S.list.find((x) => x.id === t.dataset.id); if (!p) return;
      const ok = await confirmBox({ title: 'ยกเลิกงบนี้?', danger: true, ok: 'ยกเลิกงบ',
        message: `${catName(p.category)} งบ ฿${money(p.preapprove_budget, 0)} (${fmtDate(p.expense_date)})\n\nยกเลิกแล้วกู้คืนไม่ได้ ถ้ายังต้องใช้ให้ขออนุมัติใหม่` });
      if (!ok) return;
      try {
        await busy('กำลังยกเลิก…', () => api.rpc('delete_request', { p_id: p.id }));
        toast('ยกเลิกงบแล้ว');
        ctx.refreshBadges?.();
        await api.load('get_my_requests', {}, (rows) => { S.list = budgetsOf(rows || []); paint(); });
      } catch (err) { toastError(err); }
    }
  });
}
