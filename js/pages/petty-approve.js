// รออนุมัติ / รอจ่าย (เงินสดย่อย) — ผู้อนุมัติอนุมัติ/ไม่อนุมัติ (ทีละรายการหรือหลายรายการ) · คนถือกล่องจ่ายเงินสด/รับเงินเติม
import { api, money, fmtDate, fmtDateTime, timeAgo, esc, catName, statusBadge, loadPettyCategories } from '../core.js?v=10.0.13';
import { icon, catIcon, toast, toastError, confirmBox, promptBox, busy, withBtn, sheet, thumbs, hydrateThumbs, empty, errorBox, skeleton, on } from '../ui.js?v=10.0.13';

const FUND_KEY = 'exion_petty_fund';
function fundId() { try { return localStorage.getItem(FUND_KEY) || null; } catch { return null; } }

const TYPE_TH = { OUT: 'จ่ายออก', IN: 'รับเข้ากล่อง', ADJUST: 'ปรับยอด' };

export async function render(ctx) {
  const { el, profile, query } = ctx;
  const role = profile.role || {};
  const boss = role.isGM || role.isAccountant;
  const st = { tab: ['approve', 'pay', 'receive'].includes(query.tab) ? query.tab : '', data: null, sel: new Set() };
  await loadPettyCategories().catch(() => {});

  async function load() {
    try {
      await api.load('get_petty_inbox', { p_fund_id: fundId() }, (d) => {
        st.data = d;
        const ids = new Set((d.toApprove || []).map((x) => x.id));
        [...st.sel].forEach((id) => { if (!ids.has(id)) st.sel.delete(id); });
        if (ctx.alive()) paint();
      });
    } catch (e) { if (ctx.alive()) errorBox(el, e, load); }
  }
  const after = () => { ctx.refreshBadges(); return load(); };
  const lists = () => ({ approve: st.data?.toApprove || [], pay: st.data?.toPay || [], receive: st.data?.toReceive || [] });
  const find = (id) => { const l = lists(); return [...l.approve, ...l.pay, ...l.receive].find((x) => x.id === id); };

  function paint() {
    const d = st.data || {}, b = d.balance || {}, L = lists();
    const canPay = d.isHolder || boss || L.pay.length > 0;
    const tabs = [['approve', 'รออนุมัติ', L.approve.length], canPay && ['pay', 'รอจ่ายเงิน', L.pay.length],
      (L.receive.length || d.isHolder) && ['receive', 'รอรับเงินเติม', L.receive.length]].filter(Boolean);
    if (!st.tab || !tabs.some((t) => t[0] === st.tab)) st.tab = (tabs.find((t) => t[2] > 0) || tabs[0])[0];

    el.innerHTML = `
    <div class="stack">
      <div class="card pad"><div class="flex between wrap">
        <div><div class="muted text-sm">${icon('wallet', 'sm')} ${esc(b.fundName || 'เงินสดย่อย')}</div><div class="text-sm">คนถือกล่อง: <b>${esc(b.holderName || '-')}</b></div></div>
        <div class="flex gap-16">
          <div class="text-right"><div class="muted text-sm">เงินในกล่อง</div><div class="amount text-lg">${money(b.cash, 0)}</div></div>
          <div class="text-right"><div class="muted text-sm">พร้อมจ่าย</div><div class="amount text-lg ${Number(b.available) <= 0 ? 'bad-text' : ''}">${money(b.available, 0)}</div></div>
        </div></div></div>
      <div>
        <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on' : ''}" data-tab="${k}">${l}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>
        ${st.tab === 'approve' ? approveTab(L.approve) : st.tab === 'pay' ? payTab(L.pay, b) : receiveTab(L.receive)}
      </div>
    </div>`;
  }

  function approveTab(items) {
    if (!items.length) return `<div class="card">${empty({ ic: 'check-circle', title: 'ไม่มีรายการรออนุมัติ', sub: 'คำขอเบิกเงินสดย่อยที่ต้องให้คุณอนุมัติจะแสดงที่นี่' })}</div>`;
    const all = items.every((x) => st.sel.has(x.id));
    const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
    const selItems = items.filter((x) => st.sel.has(x.id));
    const selTotal = selItems.reduce((s, x) => s + Number(x.amount || 0), 0);
    return `<div class="card">
      <div class="card-head"><label class="check"><input type="checkbox" data-all ${all ? 'checked' : ''}> เลือกทั้งหมด</label>
        <span class="text-sm muted">${items.length} รายการ · <span class="amount">${money(total)}</span></span></div>
      <div class="list">${items.map((x) => `<div class="row click ${st.sel.has(x.id) ? 'selected' : ''}" role="button" tabindex="0" data-open="${esc(x.id)}">
        <label class="check"><input type="checkbox" data-sel="${esc(x.id)}" ${st.sel.has(x.id) ? 'checked' : ''} aria-label="เลือกรายการ ${esc(x.id)}"></label>
        ${catIcon(x.category)}
        <div class="row-main"><div class="row-title">${esc(x.requester_name)} · ${esc(title(x))}</div>
          <div class="row-sub">${esc(subLine(x))}${files(x)} · ${esc(timeAgo(x.created_at))}</div></div>
        <div class="row-end">${signed(x)}
          <div class="flex gap-4"><button type="button" class="btn btn-danger btn-sm" data-act="reject" data-id="${esc(x.id)}" aria-label="ไม่อนุมัติ">${icon('x', 'sm')}</button>
          <button type="button" class="btn btn-success btn-sm" data-act="approve" data-id="${esc(x.id)}">${icon('check', 'sm')} อนุมัติ</button></div></div></div>`).join('')}</div>
    </div>
    ${selItems.length ? `<div class="action-bar"><div class="grow">เลือก ${selItems.length} รายการ · <b class="amount">${money(selTotal)}</b></div>
      <button type="button" class="btn-icon sm" data-act="clear" aria-label="ล้างที่เลือก" style="color:#fff">${icon('x')}</button>
      <button type="button" class="btn btn-danger btn-sm" data-act="bulk-reject">ไม่อนุมัติ</button>
      <button type="button" class="btn btn-success btn-sm" data-act="bulk-approve">${icon('check', 'sm')} อนุมัติ</button></div>` : ''}`;
  }

  function payTab(items, b) {
    if (!items.length) return `<div class="card">${empty({ ic: 'banknote', title: 'ไม่มีรายการรอจ่ายเงิน', sub: 'คำขอที่อนุมัติแล้วจะมารอให้คนถือกล่องจ่ายเงินสดที่นี่' })}</div>`;
    const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
    return `<div class="stack-sm">
      <div class="alert">${icon('info')}<div>นับเงินสดให้ผู้ขอ แล้วกด <b>“จ่ายเงินสดแล้ว”</b> — เงินในกล่องจะลดลงทันที และผู้ขอจะได้รับแจ้งเตือน</div></div>
      ${total > Number(b.cash) ? `<div class="alert warn">${icon('alert')}<div>ยอดรอจ่ายรวม ${money(total)} บาท มากกว่าเงินในกล่อง — ขอเติมเงินก่อน</div></div>` : ''}
      <div class="card"><div class="list">${items.map((x) => `<div class="row click" role="button" tabindex="0" data-open="${esc(x.id)}">${catIcon(x.category)}
        <div class="row-main"><div class="row-title">${esc(x.requester_name)} · ${esc(title(x))}</div>
          <div class="row-sub">${esc(subLine(x))}${files(x)}${x.approved_at ? ' · อนุมัติ ' + esc(timeAgo(x.approved_at)) : ''}</div></div>
        <div class="row-end">${signed(x)}<button type="button" class="btn btn-success btn-sm" data-act="pay" data-id="${esc(x.id)}">${icon('banknote', 'sm')} จ่ายเงินสดแล้ว</button></div></div>`).join('')}</div>
        <div class="card-foot flex between text-sm"><span class="muted">${items.length} รายการ</span><span>รวม <b class="amount">${money(total)}</b> บาท</span></div></div>
    </div>`;
  }

  function receiveTab(items) {
    if (!items.length) return `<div class="card">${empty({ ic: 'piggy-bank', title: 'ไม่มีเงินเติมที่รอรับ', sub: 'เมื่อคำขอเติมเงินกล่องได้รับอนุมัติ ให้กด “รับเงินเข้ากล่องแล้ว” ที่นี่หลังได้รับเงินจริง' })}</div>`;
    return `<div class="stack-sm">
      <div class="alert">${icon('info')}<div>กดเมื่อได้รับเงินเติมจากบริษัทแล้วจริงๆ — ยอดเงินในกล่องจะเพิ่มทันที</div></div>
      <div class="card"><div class="list">${items.map((x) => `<div class="row click" role="button" tabindex="0" data-open="${esc(x.id)}">${catIcon(x.category)}
        <div class="row-main"><div class="row-title">${esc(title(x))}</div><div class="row-sub">${esc(x.requester_name)} · ${fmtDate(x.expense_date || x.created_at)}${x.decided_by ? ' · อนุมัติโดย ' + esc(x.decided_by) : ''}</div></div>
        <div class="row-end">${signed(x)}<button type="button" class="btn btn-success btn-sm" data-act="receive" data-id="${esc(x.id)}">${icon('check', 'sm')} รับเงินเข้ากล่องแล้ว</button></div></div>`).join('')}</div></div>
    </div>`;
  }

  // ─────────────── การกระทำ ───────────────
  async function approve(x) {
    try {
      await api.rpc('approve_petty', { p_id: x.id, p_decision: 'Approved', p_remark: '' });
      st.sel.delete(x.id);
      toast(`อนุมัติแล้ว · ${x.requester_name} ${money(x.amount)} บาท`);
      await after();
    } catch (e) { toastError(e); }
  }
  async function reject(x) {
    const why = await promptBox({ title: 'ไม่อนุมัติรายการนี้', label: `เหตุผล (${x.requester_name} จะเห็น)`, hint: `${title(x)} · ${money(x.amount)} บาท`, required: true, ok: 'ไม่อนุมัติ', danger: true });
    if (why == null) return;
    try {
      await api.rpc('approve_petty', { p_id: x.id, p_decision: 'Rejected', p_remark: why });
      st.sel.delete(x.id);
      toast('บันทึกไม่อนุมัติแล้ว');
      await after();
    } catch (e) { toastError(e); }
  }
  async function pay(x, receive = false) {
    const b = st.data?.balance || {}, a = Number(x.amount) || 0;
    const ok = await confirmBox(receive
      ? { title: 'ยืนยันรับเงินเข้ากล่อง', message: `${title(x)} ${money(a)} บาท\nเงินในกล่องหลังรับ: ${money(Number(b.cash) + a)} บาท`, ok: 'รับเงินเข้ากล่องแล้ว' }
      : { title: 'ยืนยันจ่ายเงินสด', message: `${x.requester_name} · ${title(x)}\n${money(a)} บาท\n\nเงินในกล่องหลังจ่าย: ${money(Number(b.cash) - a)} บาท`, ok: 'จ่ายเงินสดแล้ว' });
    if (!ok) return;
    try {
      const r = await api.rpc('pay_petty', { p_id: x.id });
      toast(`${receive ? 'รับเงินเข้ากล่องแล้ว' : 'บันทึกจ่ายเงินสดแล้ว'} · เงินในกล่อง ${money(r?.balance?.cash ?? 0)} บาท`);
      if (r?.balance?.lowCash && !receive) setTimeout(() => toast('เงินสดในกล่องเหลือน้อย — ขอเติมเงินที่หน้ากล่องเงิน', 'info'), 600);
      await after();
    } catch (e) { toastError(e); }
  }
  // หลายรายการ: ทำทีละรายการตามลำดับ แล้วสรุปผล
  async function bulk(decision) {
    const items = lists().approve.filter((x) => st.sel.has(x.id));
    if (!items.length) return;
    const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
    let remark = '';
    if (decision === 'Rejected') {
      remark = await promptBox({ title: `ไม่อนุมัติ ${items.length} รายการ`, label: 'เหตุผล (ใช้กับทุกรายการที่เลือก)', required: true, ok: 'ไม่อนุมัติทั้งหมด', danger: true });
      if (remark == null) return;
    } else if (!(await confirmBox({ title: `อนุมัติ ${items.length} รายการ`, message: `รวม ${money(total)} บาท`, ok: 'อนุมัติทั้งหมด' }))) return;
    let done = 0; const fails = [];
    await busy('กำลังบันทึก…', async (set) => {
      for (let i = 0; i < items.length; i++) {
        set(`กำลังบันทึก ${i + 1}/${items.length}`);
        try { await api.rpc('approve_petty', { p_id: items[i].id, p_decision: decision, p_remark: remark }); done++; st.sel.delete(items[i].id); }
        catch (e) { fails.push(`${items[i].requester_name}: ${e.message}`); }
      }
    });
    const verb = decision === 'Approved' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (fails.length) toast(`${verb}แล้ว ${done} รายการ · ไม่สำเร็จ ${fails.length} — ${fails[0]}`, 'bad');
    else toast(`${verb}แล้ว ${done} รายการ`);
    await after();
  }

  function openDetail(x) {
    const mode = st.tab;
    const foot = mode === 'approve'
      ? `<button class="btn btn-danger" data-do="reject">${icon('x')} ไม่อนุมัติ</button><button class="btn btn-success" data-do="approve">${icon('check')} อนุมัติ</button>`
      : mode === 'pay' ? `<button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-success" data-do="pay">${icon('banknote')} จ่ายเงินสดแล้ว</button>`
      : `<button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-success" data-do="receive">${icon('check')} รับเงินเข้ากล่องแล้ว</button>`;
    sheet({
      title: x.type === 'IN' ? 'คำขอเติมเงินกล่อง' : 'รายละเอียดคำขอเบิก', body: detailBody(x), foot,
      onMount: (sh, close) => {
        hydrateThumbs(sh);
        sh.querySelectorAll('[data-do]').forEach((btn) => btn.addEventListener('click', () => {
          close(true);
          const a = btn.dataset.do;
          if (a === 'approve') approve(x); else if (a === 'reject') reject(x); else pay(x, a === 'receive');
        }));
      },
    });
  }

  el.innerHTML = skeleton(4);
  await load();

  const offs = [
    on(el, 'click', '[data-tab]', (e, t) => { st.tab = t.dataset.tab; paint(); }),
    on(el, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act, x = t.dataset.id ? find(t.dataset.id) : null;
      if (a === 'approve' && x) await withBtn(t, () => approve(x));
      else if (a === 'reject' && x) reject(x);
      else if (a === 'pay' && x) pay(x);
      else if (a === 'receive' && x) pay(x, true);
      else if (a === 'clear') { st.sel.clear(); paint(); }
      else if (a === 'bulk-approve') bulk('Approved');
      else if (a === 'bulk-reject') bulk('Rejected');
    }),
    on(el, 'change', '[data-sel]', (e, t) => { t.checked ? st.sel.add(t.dataset.sel) : st.sel.delete(t.dataset.sel); paint(); }),
    on(el, 'change', '[data-all]', (e, t) => { lists().approve.forEach((x) => (t.checked ? st.sel.add(x.id) : st.sel.delete(x.id))); paint(); }),
    on(el, 'click', '[data-open]', (e, t) => {
      if (e.target.closest('[data-act], .check')) return;
      const x = find(t.dataset.open); if (x) openDetail(x);
    }),
    on(el, 'keydown', '[data-open]', (e, t) => { if (e.target === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const x = find(t.dataset.open); if (x) openDetail(x); } }),
  ];
  return () => offs.forEach((f) => f());
}

// ─────────────── แถว / รายละเอียด ───────────────
function title(x) { return x.type === 'IN' ? 'ขอเติมเงินกล่อง' : (x.purpose || catName(x.category)); }
function subLine(x) {
  return [fmtDate(x.expense_date || x.created_at), x.type === 'OUT' ? catName(x.category) : x.purpose, x.type === 'OUT' ? x.payee : ''].filter(Boolean).join(' · ');
}
function files(x) { return (x.receipt_paths || []).length ? ` · ${icon('paperclip', 'sm')}${x.receipt_paths.length}` : ''; }
function signed(x) {
  const a = Number(x.amount) || 0;
  const v = x.type === 'OUT' ? -a : a;
  return `<span class="amount ${v > 0 ? 'ok-text' : ''}">${v > 0 ? '+' : ''}${money(Math.abs(v))}</span>`;
}
function badge(x) {
  if (x.type === 'IN' && x.status === 'Approved') return statusBadge('Approved', 'อนุมัติ · รอรับเงิน');
  if (x.type === 'OUT' && x.status === 'Approved') return statusBadge('Approved', 'อนุมัติ · รอจ่ายเงินสด');
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
    ['ผู้อนุมัติ', x.decided_by || x.approver_email],
    ['อนุมัติเมื่อ', x.approved_at ? fmtDateTime(x.approved_at) : ''],
    ['หมายเหตุ', x.note],
  ].filter(([, v]) => v);
  const f = x.receipt_paths || [];
  return `<div class="stack-sm">
    <div class="flex between wrap"><div class="callout-amount"><span class="v amount">${money(x.amount)}</span><span class="muted">บาท</span></div>${badge(x)}</div>
    ${x.approver_remark ? `<div class="alert neutral">${icon('info')}<div>${esc(x.approver_remark)}</div></div>` : ''}
    <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="divider"></div>
    <div class="label">${icon('paperclip', 'sm')} ใบเสร็จ ${f.length ? `(${f.length})` : ''}</div>
    ${f.length ? thumbs(f) : `<p class="muted text-sm">${x.type === 'OUT' ? 'ไม่มีใบเสร็จแนบ' : 'ไม่ต้องมีใบเสร็จ'}</p>`}
  </div>`;
}
