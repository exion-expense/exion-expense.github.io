// หน้าแรก (เบิกค่าใช้จ่าย) — แดชบอร์ดตามบทบาท: พนักงาน / หัวหน้า / GM / บัญชี / CEO
import { api, money, compact, fmtDate, timeAgo, esc, initials, roleLabel, monthLabel, exportStage, catName } from '../core.js?v=10.0.14';
import { icon, catIcon, requestRow, toast, toastError, confirmBox, withBtn, bars, empty, on } from '../ui.js?v=10.0.14';

export async function render(ctx) {
  const { el } = ctx;
  await api.load('get_home_data', {}, (d) => paint(ctx, d));
  return on(el, 'click', '[data-act]', (e, t) => act(ctx, t));
}

function paint(ctx, d) {
  const { el } = ctx;
  const role = d.role || {};
  const kind = role.isCEO ? 'ceo' : role.isAccountant ? 'acct' : role.isGM ? 'gm' : role.isManager || role.isSenior ? 'mgr' : 'staff';
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'อรุณสวัสดิ์' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const my = d.my || {}, inbox = d.inbox || {}, acc = d.accounting || {}, co = d.company || {};
  const stats = {
    staff: [[money(my.pending, 0), 'รออนุมัติ'], [money(my.approved, 0), 'อนุมัติแล้ว'], [compact(my.total), 'ยอดรอบนี้ (บาท)']],
    mgr: [[money(inbox.count, 0), 'รอคุณอนุมัติ'], [compact(inbox.amount), 'ยอดรออนุมัติ'], [money(d.team?.count || 0, 0), 'ลูกทีม']],
    gm: [[money(inbox.count, 0), 'รอคุณอนุมัติ'], [compact(co.thisMonth), 'เดือนนี้ทั้งบริษัท'], [money(d.exportsToSign ?? co.exportsToSign ?? 0, 0), 'Export รอเซ็น']],
    acct: [[money(acc.unpaidCount, 0), 'รอโอน (คน)'], [compact(acc.unpaidAmount), 'ยอดรอโอน'], [money(acc.overdue || 0, 0), 'ค้างเกิน 7 วัน']],
    ceo: [[money(d.ceo?.pending || 0, 0), 'สรุปรออนุมัติ'], [compact(d.ceo?.pendingTotal || 0), 'ยอดรวม'], [esc(d.daysLeft ?? '-'), 'วันถึงตัดรอบ']],
  }[kind];

  const heroCta = {
    staff: `<a class="btn btn-white" href="#/submit">${icon('plus')} ขอเบิกค่าใช้จ่าย</a>`,
    mgr: inbox.count ? `<a class="btn btn-white" href="#/approvals">${icon('inbox')} อนุมัติ ${inbox.count} รายการ</a>` : `<a class="btn btn-white" href="#/submit">${icon('plus')} ขอเบิกค่าใช้จ่าย</a>`,
    gm: `<a class="btn btn-white" href="#/approvals">${icon('inbox')} รายการรออนุมัติ</a>`,
    acct: `<a class="btn btn-white" href="#/accounting">${icon('banknote')} ไปหน้าโอนเงิน</a>`,
    ceo: `<a class="btn btn-white" href="#/ceo">${icon('crown')} อนุมัติสรุปรายเดือน</a>`,
  }[kind];

  el.innerHTML = `
  <div class="stack">
    <section class="hero ${kind === 'ceo' ? 'dark' : kind === 'acct' ? 'green' : ''}">
      <div class="flex gap-12" style="position:relative;z-index:1">
        <span class="avatar lg" style="background:rgba(255,255,255,.18)">${esc(initials(d.name))}</span>
        <div class="grow"><div class="eyebrow">${hello}</div><div class="text-lg bold">${esc(d.fullName || d.name)}</div>
          <div class="text-sm" style="opacity:.85">${esc(roleLabel(role))}${d.department ? ' · ' + esc(d.department) : ''}</div></div>
      </div>
      <div class="hero-stats">${stats.map(([v, l]) => `<div class="hs"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <div class="flex wrap mt-16">${heroCta}${kind !== 'staff' && kind !== 'ceo' ? `<a class="btn btn-glass" href="#/submit">${icon('plus')} ขอเบิกของฉัน</a>` : ''}</div>
    </section>

    <div class="split">
      <div class="stack">
        ${inbox.count ? inboxCard(inbox) : ''}
        ${kind === 'acct' || kind === 'gm' ? unpaidCard(acc, kind) : ''}
        ${kind === 'gm' ? deptCard(co) : ''}
        ${recentCard(my, kind)}
      </div>
      <div class="stack">
        ${periodCard(d)}
        ${d.petty ? pettyCard(d.petty) : ''}
        <div class="card"><div class="card-head"><h3>${icon('grid')} เมนูลัด</h3></div>
          <div class="pad tiles">
            <a class="tile" href="#/submit"><span class="row-icon c-red">${icon('plus')}</span>ขอเบิก</a>
            <a class="tile" href="#/requests"><span class="row-icon c-blue">${icon('receipt')}</span>คำขอของฉัน</a>
            <a class="tile" href="#/preapprovals"><span class="row-icon c-violet">${icon('shield')}</span>ขออนุมัติงบ</a>
            <a class="tile" href="#/summary"><span class="row-icon c-teal">${icon('chart')}</span>สรุป & Excel</a>
            ${role.isManager || role.isGM ? `<a class="tile" href="#/team"><span class="row-icon c-amber">${icon('users')}</span>ทีมของฉัน</a>` : ''}
            <a class="tile" href="#/petty"><span class="row-icon c-green">${icon('wallet')}</span>เงินสดย่อย</a>
          </div></div>
      </div>
    </div>
  </div>`;
}

function inboxCard(inbox) {
  const top = (inbox.top || []).slice(0, 4);
  return `<div class="card">
    <div class="card-head"><h3>${icon('inbox')} รอคุณอนุมัติ <span class="badge b-pending plain">${inbox.count}</span></h3><a class="link" href="#/approvals">ดูทั้งหมด ${icon('chevron-right', 'sm')}</a></div>
    <div class="list">${top.map((r) => `<div class="row">${catIcon(r.category)}
      <div class="row-main"><div class="row-title">${esc(r.staff_name)} · ${esc(catName(r.category))}</div>
        <div class="row-sub">${fmtDate(r.expense_date)}${r.customer || r.venue ? ' · ' + esc(r.customer || r.venue) : ''}</div></div>
      <div class="row-end"><span class="amount">${money(r.status === 'PreApprove' ? r.preapprove_budget : r.amount)}</span>
        <div class="flex gap-4"><button class="btn btn-danger btn-sm" data-act="reject" data-id="${esc(r.id)}" aria-label="ไม่อนุมัติ">${icon('x', 'sm')}</button>
        <button class="btn btn-success btn-sm" data-act="approve" data-id="${esc(r.id)}">${icon('check', 'sm')} อนุมัติ</button></div></div></div>`).join('')}</div>
    ${inbox.count > top.length ? `<div class="card-foot text-sm muted">และอีก ${inbox.count - top.length} รายการ · รวม ${money(inbox.amount)} บาท</div>` : ''}
  </div>`;
}

function unpaidCard(acc, kind) {
  const top = (acc.top || []).slice(0, 5);
  if (!top.length) return kind === 'acct' ? `<div class="card">${empty({ ic: 'check-circle', title: 'ไม่มีรายการรอโอน', sub: 'ทุกคนได้รับเงินแล้ว 🎉' })}</div>` : '';
  return `<div class="card">
    <div class="card-head"><h3>${icon('banknote')} รอโอนเงิน</h3><a class="link" href="#/accounting">ทั้งหมด ${icon('chevron-right', 'sm')}</a></div>
    <div class="list">${top.map((e) => `<div class="row"><span class="avatar sm">${esc(initials(e.staff_name))}</span>
      <div class="row-main"><div class="row-title">${esc(e.staff_name)}</div><div class="row-sub">รอบ ${monthLabel(e.year, e.month)} · ${e.item_count} รายการ${e.days != null ? ` · อนุมัติ ${e.days} วันแล้ว` : ''}</div></div>
      <div class="row-end"><span class="amount">${money(e.total_amount)}</span>
        <div class="flex gap-4"><button class="btn btn-secondary btn-sm" data-act="xls" data-id="${esc(e.id)}" title="ดาวน์โหลดฟอร์ม">${icon('download', 'sm')}</button>
        ${kind === 'acct' ? `<button class="btn btn-success btn-sm" data-act="paid" data-id="${esc(e.id)}" data-name="${esc(e.staff_name)}" data-amt="${e.total_amount}">${icon('check', 'sm')} โอนแล้ว</button>` : ''}</div></div></div>`).join('')}</div></div>`;
}

function deptCard(co) {
  const diff = co.lastMonth ? ((co.thisMonth - co.lastMonth) / co.lastMonth) * 100 : null;
  return `<div class="card"><div class="card-head"><h3>${icon('chart')} ภาพรวมบริษัท</h3><a class="link" href="#/summary">รายงาน ${icon('chevron-right', 'sm')}</a></div>
    <div class="pad">
      <div class="grid-2 mb-16"><div class="stat"><div class="l">เดือนนี้</div><div class="v">${money(co.thisMonth, 0)}</div>
        ${diff != null ? `<div class="d ${diff > 0 ? 'bad-text' : 'ok-text'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(0)}% จากเดือนก่อน</div>` : ''}</div>
        <div class="stat"><div class="l">เดือนก่อน</div><div class="v">${money(co.lastMonth, 0)}</div></div></div>
      ${(co.byDept || []).length ? bars(co.byDept.map((x) => ({ label: x.name, value: x.amount }))) : '<p class="muted text-sm">ยังไม่มีรายการอนุมัติในเดือนนี้</p>'}
    </div></div>`;
}

function recentCard(my, kind) {
  const rows = my.recent || [];
  if (!rows.length && kind !== 'staff') return '';
  return `<div class="card"><div class="card-head"><h3>${icon('clock')} รายการล่าสุดของฉัน</h3><a class="link" href="#/requests">ทั้งหมด ${icon('chevron-right', 'sm')}</a></div>
    ${rows.length ? `<div class="list">${rows.slice(0, 6).map((r) => requestRow(r, { href: '#/requests?id=' + encodeURIComponent(r.id) })).join('')}</div>`
      : empty({ ic: 'receipt', title: 'ยังไม่มีรายการเบิก', sub: 'เริ่มส่งบิลแรกของคุณได้เลย', action: `<a class="btn btn-primary" href="#/submit">${icon('plus')} ขอเบิกค่าใช้จ่าย</a>` })}</div>`;
}

function periodCard(d) {
  const p = d.period || {}, e = d.latestExport;
  const stage = exportStage(e);
  const steps = [['ขอเบิก', stage !== 'none'], ['อนุมัติ', stage === 'approved' || stage === 'paid'], ['โอนแล้ว', stage === 'paid']];
  return `<div class="card"><div class="card-head"><h3>${icon('calendar')} รอบเบิกเงิน</h3><a class="link" href="#/profile">ขอเบิกรายเดือน ${icon('chevron-right', 'sm')}</a></div>
    <div class="pad stack-sm">
      <div class="flex between"><span class="muted text-sm">รอบปัจจุบัน</span><b class="text-sm">${esc(p.rangeLabel || '-')}</b></div>
      <div class="flex between"><span class="muted text-sm">ตัดรอบ</span><span class="text-sm">${esc(p.cutoffLabel || '-')}${d.daysLeft != null ? ` · <b class="${d.daysLeft <= 3 ? 'bad-text' : ''}">อีก ${d.daysLeft} วัน</b>` : ''}</span></div>
      ${e ? `<div class="divider" style="margin:8px 0"></div>
        <div class="flex between"><span class="text-sm">ขอเบิกล่าสุด · ${monthLabel(e.year, e.month)}</span><b class="amount">${money(e.total_amount)}</b></div>
        <div class="steps mt-8">${steps.map(([l, ok], i) => `<div class="st ${stage === 'rejected' && i === 1 ? 'fail' : ok ? 'done' : (i === steps.findIndex((s) => !s[1]) ? 'now' : '')}">
          <span class="dot">${stage === 'rejected' && i === 1 ? icon('x') : ok ? icon('check') : ''}</span>${l}</div>`).join('')}</div>
        ${stage === 'paid' && e.paid_at ? `<p class="hint text-center">โอนเมื่อ ${fmtDate(e.paid_at)}</p>` : ''}`
      : `<p class="hint">ยังไม่เคยขอเบิกรายเดือน — เมื่อบิลอนุมัติครบ ไปที่ “ขอเบิกรายเดือน” เพื่อส่งให้ผู้อนุมัติเซ็น</p>`}
    </div></div>`;
}

function pettyCard(p) {
  const pct = p.limit ? Math.max(0, Math.min(100, (p.cash / p.limit) * 100)) : 0;
  return `<a class="card" href="#/petty" style="display:block;color:inherit"><div class="card-head"><h3>${icon('wallet')} เงินสดย่อย</h3>${icon('chevron-right', 'sm')}</div>
    <div class="pad"><div class="flex between"><span class="muted text-sm">${esc(p.fundName || '')}</span>${p.lowCash ? '<span class="badge b-bad">เงินใกล้หมด</span>' : ''}</div>
      <div class="callout-amount mt-4"><span class="v">${money(p.cash, 0)}</span><span class="muted">/ ${money(p.limit, 0)} บาท</span></div>
      <div class="meter mt-8 ${pct < 20 ? 'bad' : pct < 40 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
      ${p.pendingOut ? `<p class="hint mt-8">รอจ่าย ${money(p.pendingOut, 0)} บาท</p>` : ''}</div></a>`;
}

async function act(ctx, t) {
  const id = t.dataset.id;
  try {
    if (t.dataset.act === 'approve') {
      await withBtn(t, () => api.rpc('decide_many', { p_ids: [id], p_decision: 'Approved', p_mode: 'auto' }));
      toast('อนุมัติแล้ว');
    } else if (t.dataset.act === 'reject') {
      const { promptBox } = await import('../ui.js?v=10.0.14');
      const why = await promptBox({ title: 'ไม่อนุมัติรายการนี้', label: 'เหตุผล (พนักงานจะเห็น)', required: true, ok: 'ไม่อนุมัติ', danger: true });
      if (why == null) return;
      await api.rpc('decide_many', { p_ids: [id], p_decision: 'Rejected', p_remark: why, p_mode: 'auto' });
      toast('บันทึกแล้ว');
    } else if (t.dataset.act === 'paid') {
      if (!(await confirmBox({ title: 'ยืนยันโอนเงินแล้ว', message: `${t.dataset.name} · ${money(t.dataset.amt)} บาท\nระบบจะแจ้งพนักงานทันที`, ok: 'ยืนยันโอนแล้ว' }))) return;
      await api.rpc('mark_export_paid', { p_id: id });
      toast('บันทึกการโอนแล้ว');
    } else if (t.dataset.act === 'xls') {
      await withBtn(t, () => api.excel({ type: 'staff_form', kind: 'final', exportId: id }));
      return;
    }
    ctx.refreshBadges();
    await api.load('get_home_data', {}, (d) => ctx.alive() && paint(ctx, d));
  } catch (e) { toastError(e); }
}
