// คำขอของฉัน — กรองตามสถานะ / ค้นหา / จัดกลุ่มรายเดือน · แตะดูรายละเอียด แก้ไข ลบ
import { api, state, money, esc, fmtDate, fmtDateTime, catName, catInfo, monthLabel, requestBadge, loadCategories } from '../core.js?v=10.0.13';
import { icon, catIcon, requestRow, toast, toastError, confirmBox, sheet, busy, empty, skeleton, thumbs, hydrateThumbs, receiptPicker, on, debounce, $, $$ } from '../ui.js?v=10.0.13';
import { catPickerHtml, fieldsHtml, applyCat, validateItem, showErrors, clearError, catFlags, fuelBox, pickFields, loadVisitRules, entWarn } from './submit.js?v=10.0.13';

const FILTERS = [['all', 'ทั้งหมด'], ['pending', 'รออนุมัติ'], ['approved', 'อนุมัติแล้ว'], ['rejected', 'ไม่อนุมัติ'], ['pre', 'งบล่วงหน้า']];

const isFinalBill = (r) => String(r.batch_id || '').startsWith('FINALIZE-');
/** แถว "ขออนุมัติงบ" (ยังไม่ใช่บิลจริง) */
const isBudget = (r) => r.status === 'PreApprove' || r.status === 'Finalized' || (!!r.preapprove_status && !isFinalBill(r));
const cleanRemark = (s) => String(s || '').split(' sig:')[0].trim();
const reqDate = (r) => r.expense_date || String(r.created_at || '').slice(0, 10);
function matches(r, f) {
  if (f === 'pre') return isBudget(r);
  if (f === 'rejected') return r.status === 'Rejected';
  if (f === 'pending') return !isBudget(r) && r.status === 'Pending';
  if (f === 'approved') return !isBudget(r) && r.status === 'Approved';
  return true;
}
/** "[Customer] SCG" → ป้าย + ชื่อ */
function custHtml(c) {
  const m = /^\[(.+?)\]\s*(.*)$/.exec(String(c || ''));
  return m ? `<span class="badge b-neutral plain">${esc(m[1])}</span> ${esc(m[2])}` : esc(c);
}

export async function render(ctx) {
  const { el } = ctx;
  const S = { rows: [], filter: FILTERS.some(([k]) => k === ctx.query.f) ? ctx.query.f : 'all', q: '', settled: null, names: null, sheet: null };
  loadCategories().catch(() => {});
  loadVisitRules();
  // วันที่ปิดรอบล่าสุด (ส่งบัญชีแล้ว) → รายการก่อนหน้านั้นแก้/ลบไม่ได้
  const now = new Date();
  const periodP = api.rpc('get_period_info', { p_year: now.getFullYear(), p_month: now.getMonth() + 1 }, { ttl: 300 })
    .then((p) => { S.settled = p?.lastSettled || null; }).catch(() => {});

  el.innerHTML = `<div class="page-head"><div><h1>คำขอของฉัน</h1><div class="sub" data-sub>&nbsp;</div></div>
      <div class="actions"><a class="btn btn-primary" href="#/submit">${icon('plus')} ขอเบิก</a></div></div>
    <div class="toolbar"><div class="search">${icon('search')}<input class="input" type="search" placeholder="ค้นหา ลูกค้า / สถานที่ / รหัส / ยอด" aria-label="ค้นหา" data-q></div></div>
    <div class="chips mb-12" data-chips></div>
    <div data-list>${skeleton(6)}</div>`;

  function paint() {
    if (!ctx.alive()) return;
    // ใบงบแบบเก่า (Finalized) ที่มีบิลลูกแล้ว → ซ่อน ให้เห็นแค่บิลจริง
    const hasChild = new Set(S.rows.filter((r) => isFinalBill(r) && r.batch_id.slice(9) !== r.id).map((r) => r.batch_id.slice(9)));
    const rows = S.rows.filter((r) => !(r.status === 'Finalized' && hasChild.has(r.id)));
    const money_ = rows.filter((r) => !isBudget(r));
    const pend = money_.filter((r) => r.status === 'Pending');
    $('[data-sub]', el).textContent = rows.length
      ? `${rows.length} รายการ${pend.length ? ` · รออนุมัติ ${pend.length} รายการ ฿${money(pend.reduce((s, r) => s + Number(r.amount || 0), 0))}` : ''}`
      : 'ยังไม่มีคำขอ';
    $('[data-chips]', el).innerHTML = FILTERS.map(([k, l]) => {
      const n = rows.filter((r) => matches(r, k)).length;
      return `<button type="button" class="chip ${S.filter === k ? 'on' : ''}" data-filter="${k}" aria-pressed="${S.filter === k}">${l}<span class="n">${n}</span></button>`;
    }).join('');

    const q = S.q.trim().toLowerCase();
    const list = rows.filter((r) => matches(r, S.filter)).filter((r) => !q || [r.id, r.customer, r.venue, r.occasion, r.attendees, r.origin, r.destination,
      r.customer_contact, r.job_no, catName(r.category), r.amount, r.preapprove_budget].join(' ').toLowerCase().includes(q))
      .sort((a, b) => reqDate(b).localeCompare(reqDate(a)) || String(b.created_at).localeCompare(String(a.created_at)));
    const box = $('[data-list]', el);
    if (!rows.length) {
      box.innerHTML = `<div class="card">${empty({ ic: 'receipt', title: 'ยังไม่มีคำขอเบิก', sub: 'ส่งบิลแรกของคุณได้เลย — กรอกได้หลายรายการในครั้งเดียว',
        action: `<a class="btn btn-primary" href="#/submit">${icon('plus')} ขอเบิกค่าใช้จ่าย</a>` })}</div>`;
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="card">${empty({ ic: 'search', title: 'ไม่พบรายการ', sub: q ? `ไม่มีรายการที่ตรงกับ "${S.q.trim()}"` : 'ไม่มีรายการในสถานะนี้' })}</div>`;
      return;
    }
    // จัดกลุ่มตามเดือนที่ใช้จ่าย
    const groups = [];
    for (const r of list) {
      const k = reqDate(r).slice(0, 7);
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, rows: [] });
      groups[groups.length - 1].rows.push(r);
    }
    box.innerHTML = `<div class="card"><div class="list">${groups.map((g) => {
      const [y, m] = g.k.split('-').map(Number);
      const total = g.rows.filter((r) => !isBudget(r) && r.status !== 'Rejected').reduce((s, r) => s + Number(r.amount || 0), 0);
      return `<div class="group-label"><span>${y && m ? monthLabel(y, m, true) : 'ไม่ระบุวันที่'} · ${g.rows.length} รายการ</span><span class="amount">฿${money(total)}</span></div>
        ${g.rows.map((r) => requestRow(r.status === 'Rejected' && isBudget(r) ? { ...r, amount: r.preapprove_budget } : r)).join('')}`;
    }).join('')}</div></div>`;
  }

  async function reload() {
    await api.load('get_my_requests', {}, (rows) => { S.rows = rows || []; paint(); });
  }

  // ── รายละเอียด ──
  async function staffNames() {
    if (S.names) return S.names;
    try {
      const list = await api.rpc('get_staff_list', {}, { ttl: 3600 });
      S.names = Object.fromEntries((list || []).map((s) => [String(s.email).toLowerCase(), s.fullName || s.name]));
    } catch { S.names = {}; }
    return S.names;
  }
  const locked = (r) => !!S.settled && reqDate(r) <= S.settled;

  async function openDetail(id) {
    S.sheet?.close();
    const s = sheet({ title: 'รายละเอียดคำขอ', body: skeleton(4), foot: '<span></span>' });
    S.sheet = s;
    const foot = $('.sheet-foot', s.el); foot.classList.add('hidden');
    let r, nm;
    try { [r, nm] = await Promise.all([api.rpc('get_request', { p_id: id }), staffNames(), periodP]); }
    catch (e) { $('.sheet-body', s.el).innerHTML = empty({ ic: 'alert', title: 'เปิดรายการไม่ได้', sub: e.message }); return; }
    if (!s.el.isConnected) return;
    $('.sheet-body', s.el).innerHTML = detailHtml(r, nm);
    hydrateThumbs($('.sheet-body', s.el));
    const acts = actionsOf(r);
    if (acts) { foot.innerHTML = acts; foot.classList.remove('hidden'); }
    s.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dact]'); if (!b) return;
      detailAct(b.dataset.dact, r, s, b);
    });
  }

  function detailHtml(r, nm) {
    const who = (e) => (e === 'auto' ? 'ระบบ' : nm[String(e || '').toLowerCase()] || String(e || '').split('@')[0] || '-');
    const budget = isBudget(r);
    // บิลจริงจากงบ: หางบต้นทาง + รวมยอดทุกบิลของงบเดียวกัน
    const fromPre = isFinalBill(r);
    const preId = fromPre ? r.batch_id.slice(9) : '';
    const root = fromPre ? (r.id === preId ? r : S.rows.find((x) => x.id === preId)) : null;
    const preBudget = root?.preapprove_budget ?? r.preapprove_budget ?? null;
    const sibs = fromPre ? S.rows.filter((x) => x.batch_id === r.batch_id) : [];
    const billTotal = sibs.length ? sibs.reduce((s_, x) => s_ + Number(x.id === r.id ? r.amount : x.amount || 0), 0) : Number(r.amount || 0);
    const f = catFlags(catInfo(r.category) || { code: r.category });
    const amt = budget ? r.preapprove_budget : r.amount;
    const reason = cleanRemark(r.manager_remark) || cleanRemark(r.remark);
    const over = fromPre && preBudget != null && billTotal > Number(preBudget);
    const kv = [
      ['วันที่ใช้จ่าย', fmtDate(r.expense_date, { full: true })],
      r.mileage_km ? ['ระยะทาง', `${money(r.mileage_km, 1)} กม.`] : null,
      r.origin || r.destination ? ['เส้นทาง', esc([r.origin, r.destination].filter(Boolean).join(' → '))] : null,
      r.venue ? [f.ent ? 'สถานที่' : 'รายละเอียด', esc(r.venue)] : null,
      r.customer ? ['ลูกค้า', custHtml(r.customer)] : null,
      r.customer_contact ? ['Contact name', esc(r.customer_contact)] : null,
      r.occasion ? [(/^(ENT|GOLF)$/i.test(r.category) ? 'Purpose of entertainment' : 'Purpose of visiting'), esc(r.occasion)] : null,
      r.attendees ? ['ผู้ร่วม', esc(r.attendees)] : null,
      r.job_no ? ['เลข Job', esc(r.job_no)] : null,
      fromPre && preBudget != null ? ['งบที่อนุมัติ', `฿${money(preBudget)}${sibs.length > 1 ? ` · ยอดจริงรวม ${sibs.length} บิล ฿${money(billTotal)}` : ''}${over ? ` <span class="badge b-bad">เกินงบ ฿${money(billTotal - preBudget)}</span>` : ''}`] : null,
      ['ส่งเมื่อ', fmtDateTime(r.created_at)],
      ['รหัส', `<span class="text-sm">${esc(r.id)}</span>`],
    ].filter(Boolean);
    const paths = r.receipt_paths || [];
    return `<div class="flex gap-12">${catIcon(r.category)}<div class="grow"><div class="bold">${budget ? 'ขออนุมัติงบ · ' : ''}${esc(catName(r.category))}</div>
        <div class="text-sm muted">${fmtDate(r.expense_date)}</div></div>${requestBadge(r)}</div>
      <div class="callout-amount mt-12"><span class="v">${money(amt)}</span><span class="muted">บาท${budget ? ' (งบที่ขอ)' : ''}</span></div>
      <div class="stack-sm mt-12">
        ${r.status === 'Rejected' ? `<div class="alert bad">${icon('x-circle')}<div><b>${budget ? 'ไม่อนุมัติงบ' : 'ไม่อนุมัติ'}</b><div>${reason ? 'เหตุผล: ' + esc(reason) : 'ไม่ได้ระบุเหตุผล'}</div></div></div>` : ''}
        ${r.status === 'PreApprove' && r.preapprove_status === 'Approved' ? `<div class="alert ok">${icon('check-circle')}<span>อนุมัติงบแล้ว — ใช้จ่ายแล้วกด <b>ส่งบิลจริง</b> พร้อมแนบใบเสร็จ</span></div>` : ''}
        ${fromPre ? `<div class="alert neutral">${icon('shield')}<span>บิลจริงจากงบล่วงหน้า${preBudget != null ? ` (งบ ฿${money(preBudget)})` : ''}${sibs.length > 1 ? ` · ส่ง ${sibs.length} บิล รวม ฿${money(billTotal)}` : ''}${over ? ' — <b>ยอดรวมเกินงบ</b> หัวหน้าจะเห็นตอนอนุมัติ' : ''}</span></div>` : ''}
        ${locked(r) ? `<div class="alert neutral">${icon('lock')}<span>อยู่ในรอบที่ส่งบัญชีแล้ว (ปิดถึง ${fmtDate(S.settled)}) — แก้ไข/ลบไม่ได้</span></div>` : ''}
      </div>
      <div class="divider"></div>
      <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <h4 class="mt-16 mb-8">ใบเสร็จ${paths.length ? ` (${paths.length})` : ''}</h4>
      ${paths.length ? thumbs(paths) : '<p class="text-sm muted">ไม่มีใบเสร็จแนบ</p>'}
      <h4 class="mt-16 mb-8">สถานะ</h4>
      <div class="card"><div class="list">${timeline(r, who).map((t) => `<div class="row"><span class="row-icon ${t.cls}">${icon(t.ic)}</span>
        <div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${esc(t.sub || '')}</div>
        ${t.note ? `<div class="text-sm mt-4">“${esc(t.note)}”</div>` : ''}</div></div>`).join('')}</div></div>`;
  }

  /** ขั้นตอนตั้งแต่ส่ง → การตัดสินของหัวหน้า/ผู้บริหาร */
  function timeline(r, who) {
    const T = [];
    const fromPre = isFinalBill(r);
    const hasPre = !!r.preapprove_status || r.status === 'PreApprove';
    T.push({ ic: 'send', cls: 'c-blue', title: hasPre ? 'ส่งขออนุมัติงบ' : 'ส่งคำขอเบิก', sub: fmtDateTime(r.created_at) });
    if (hasPre) {
      const ps = r.preapprove_status || 'Pending';
      if (ps === 'Pending') T.push({ ic: 'clock', cls: 'c-amber', title: `รอ ${who(r.manager_email)} อนุมัติงบ`, sub: `งบ ฿${money(r.preapprove_budget)}` });
      else T.push({ ic: ps === 'Approved' ? 'check' : 'x', cls: ps === 'Approved' ? 'c-green' : 'c-red',
        title: `${ps === 'Approved' ? 'อนุมัติงบ' : 'ไม่อนุมัติงบ'} · ${who(r.preapprove_by || r.manager_email)}`, sub: fmtDateTime(r.preapprove_at),
        note: ps === 'Rejected' ? cleanRemark(r.manager_remark) || cleanRemark(r.remark) : '' });
      if (ps === 'Approved' && r.status === 'PreApprove') T.push({ ic: 'receipt', cls: '', title: 'รอส่งบิลจริง', sub: 'ส่งบิลพร้อมใบเสร็จหลังใช้จ่าย' });
      if (fromPre) T.push({ ic: 'receipt', cls: 'c-blue', title: 'ส่งบิลจริงแล้ว', sub: `ยอดจริง ฿${money(r.amount)}` });
      if (!fromPre) return T;
    }
    const ms = r.manager_status || '';
    const auto = r.status === 'Approved' && (r.approved_by === 'auto' || !ms);
    if (auto) T.push({ ic: 'check', cls: 'c-green', title: 'อนุมัติอัตโนมัติ', sub: `หมวดนี้ไม่ต้องรออนุมัติ${r.approved_at ? ' · ' + fmtDateTime(r.approved_at) : ''}` });
    else if (ms === 'Pending' || (!ms && r.status === 'Pending')) T.push({ ic: 'clock', cls: 'c-amber', title: `รอ ${who(r.manager_email)} อนุมัติ`, sub: 'แจ้งผู้อนุมัติแล้ว' });
    else if (ms === 'Approved' || ms === 'Rejected') T.push({ ic: ms === 'Approved' ? 'check' : 'x', cls: ms === 'Approved' ? 'c-green' : 'c-red',
      title: `${ms === 'Approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'} · ${who(r.manager_email)}`, sub: fmtDateTime(r.manager_at), note: cleanRemark(r.manager_remark) });
    else if (ms === 'Bypassed') T.push({ ic: 'chevron-right', cls: '', title: 'ข้ามขั้นหัวหน้า', sub: 'ส่งต่อผู้อนุมัติขั้นสุดท้าย' });
    // ขั้นสุดท้าย (GM / ผู้บริหาร) — เมื่อผู้ตัดสินไม่ใช่หัวหน้าคนเดิม
    const finalBy = String(r.approved_by || '').toLowerCase();
    if (!auto && finalBy && finalBy !== String(r.manager_email || '').toLowerCase() && (r.status === 'Approved' || r.status === 'Rejected')) {
      T.push({ ic: r.status === 'Approved' ? 'check' : 'x', cls: r.status === 'Approved' ? 'c-green' : 'c-red',
        title: `${r.status === 'Approved' ? 'อนุมัติขั้นสุดท้าย' : 'ไม่อนุมัติ'} · ${who(finalBy)}`, sub: fmtDateTime(r.approved_at), note: cleanRemark(r.remark) });
    } else if (r.status === 'Pending' && (ms === 'Approved' || ms === 'Bypassed')) {
      T.push({ ic: 'clock', cls: 'c-amber', title: 'รออนุมัติขั้นสุดท้าย', sub: 'ผู้บริหารกำลังพิจารณา' });
    }
    return T;
  }

  function actionsOf(r) {
    const b = [];
    const lock = locked(r);
    const budget = isBudget(r);
    if (r.status === 'PreApprove' && r.preapprove_status === 'Approved') b.push(`<button type="button" class="btn btn-primary" data-dact="finalize">${icon('receipt')} ส่งบิลจริง</button>`);
    if (!lock && !budget && r.status !== 'Rejected' && r.status !== 'Finalized') b.push(`<button type="button" class="btn btn-secondary" data-dact="edit">${icon('edit')} แก้ไข</button>`);
    if (!budget && r.status === 'Rejected') b.push(`<button type="button" class="btn btn-secondary" data-dact="resubmit">${icon('copy')} ส่งใหม่</button>`);
    if (!lock) {
      const lbl = budget ? 'ยกเลิกงบ' : r.batch_id === 'FINALIZE-' + r.id ? 'ถอนบิล' : 'ลบ';
      b.push(`<button type="button" class="btn btn-danger" data-dact="delete" ${b.length ? 'style="flex:0 0 auto"' : ''}>${icon('trash')} ${lbl}</button>`);
    }
    return b.join('');
  }

  async function detailAct(a, r, s, btn) {
    if (a === 'finalize') { s.close(); ctx.go(`/preapprovals/${encodeURIComponent(r.id)}/finalize`); return; }
    if (a === 'edit') { s.close(); openEdit(r); return; }
    if (a === 'resubmit') {
      const src = { category: r.category, expenseDate: r.expense_date, mileageKm: r.mileage_km ?? '', amount: r.amount || '', venue: r.venue, occasion: r.occasion,
        attendees: r.attendees, origin: r.origin, destination: r.destination, customer: r.customer, customerContact: r.customer_contact, jobNo: r.job_no };
      try { sessionStorage.setItem('exion_prefill', JSON.stringify(pickFields(src))); } catch {}
      s.close(); ctx.go('/submit'); return;
    }
    if (a === 'delete') {
      const budget = isBudget(r);
      const root = r.batch_id === 'FINALIZE-' + r.id;
      const what = `${catName(r.category)} ฿${money(budget ? r.preapprove_budget : r.amount)} (${fmtDate(r.expense_date)})`;
      const ok = await confirmBox({
        title: budget ? 'ยกเลิกงบนี้?' : root ? 'ถอนบิลจริงนี้?' : 'ลบรายการนี้?', danger: true, ok: budget ? 'ยกเลิกงบ' : root ? 'ถอนบิล' : 'ลบ',
        message: root ? `${what}\n\nบิลนี้ส่งจากงบล่วงหน้า — ถ้าถอน งบจะกลับไปเป็น "รอส่งบิล" และต้องส่งบิลใหม่`
          : budget ? `${what}\n\nยกเลิกแล้วกู้คืนไม่ได้ ถ้ายังต้องใช้ให้ขออนุมัติใหม่`
          : isFinalBill(r) ? `${what}\n\nนี่คือบิลจริงที่ส่งจากงบล่วงหน้า ไม่ใช่รายการซ้ำ — ถ้าลบ ยอดนี้จะหายจากการเบิก` : `${what}\n\nลบแล้วกู้คืนไม่ได้`,
      });
      if (!ok) return;
      try {
        const res = await busy('กำลังลบ…', () => api.rpc('delete_request', { p_id: r.id }));
        s.close();
        toast(res?.reset ? 'ถอนบิลแล้ว — งบกลับเป็น "รอส่งบิล"' : budget ? 'ยกเลิกงบแล้ว' : 'ลบแล้ว');
        ctx.refreshBadges?.();
        await reload();
      } catch (e) { toastError(e); }
    }
  }

  // ── แก้ไข (ช่องเหมือนหน้าขอเบิก) ──
  function openEdit(r) {
    const it = { category: String(r.category || '').toUpperCase(), expenseDate: r.expense_date || '', mileageKm: r.mileage_km ?? '', amount: r.amount || '',
      venue: r.venue || '', occasion: r.occasion || '', attendees: r.attendees || '', origin: r.origin || '', destination: r.destination || '',
      customer: r.customer || '', customerContact: r.customer_contact || '', jobNo: r.job_no || '' };
    const cats = (state.cats || []).filter((c) => (c.active !== false && !['ENT', 'GOLF'].includes(c.code)) || c.code === it.category);
    let fuel = null, rp = null;
    const s = sheet({
      title: 'แก้ไขรายการ', wide: true,
      body: `<div class="alert neutral">${icon('info')}<span>แก้แล้วสถานะคงเดิม ไม่ต้องรออนุมัติใหม่${r.status === 'Approved' ? ' — หัวหน้าจะได้รับแจ้งว่ามีการแก้ไข' : ''}</span></div>
        <div class="field mt-16"><label class="req">หมวดค่าใช้จ่าย</label>${catPickerHtml(cats, it.category)}<div class="err-text hidden" data-err="category"></div></div>
        <div class="mt-16">${fieldsHtml(it, { listId: 'exCustListEdit' })}</div><datalist id="exCustListEdit"></datalist>`,
      foot: `<button type="button" class="btn btn-secondary" data-x>ยกเลิก</button><button type="button" class="btn btn-primary" data-save>${icon('check')} บันทึก</button>`,
    });
    S.sheet = s;
    const root = s.el;
    rp = receiptPicker($('[data-rslot]', root), { max: 10, existing: r.receipt_paths || [], onChange: (n) => { if (n) clearError(root, 'receipts'); } });
    applyCat(root, it, fuel);
    api.rpc('get_fuel_rate', {}, { ttl: 600 }).then((x) => { fuel = x; }).catch(() => { fuel = { error: true }; })
      .finally(() => { if (root.isConnected) applyCat(root, it, fuel); });
    api.rpc('get_customers', {}, { ttl: 600 }).then((list) => {
      const dl = $('#exCustListEdit', root); if (dl) dl.innerHTML = (list || []).map((c) => `<option value="${esc(c)}"></option>`).join('');
    }).catch(() => {});

    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-act="cat"]');
      if (c) {
        it.category = c.dataset.code;
        $$('[data-act="cat"]', root).forEach((b) => { b.classList.toggle('on', b === c); b.setAttribute('aria-pressed', String(b === c)); });
        clearError(root, 'category');
        applyCat(root, it, fuel);
        return;
      }
      if (e.target.closest('[data-save]')) save(e.target.closest('[data-save]'));
    });
    root.addEventListener('input', (e) => {
      const t = e.target.closest('[data-f]'); if (!t) return;
      it[t.dataset.f] = t.value; clearError(root, t.dataset.f);
      if (['occasion', 'venue', 'customer'].includes(t.dataset.f)) entWarn(root, it);
      if (t.dataset.f === 'mileageKm') { const fc = $('[data-g="fuelcalc"]', root); if (fc) fc.innerHTML = fuelBox(it, fuel); }
    });

    async function save(btn) {
      $$('[data-f]', root).forEach((x) => { it[x.dataset.f] = x.value; });
      const bad = showErrors(root, validateItem(it, rp.count()));
      if (bad) { bad.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('กรอกข้อมูลไม่ครบ — ดูช่องสีแดง', 'bad'); return; }
      const f = catFlags(catInfo(it.category));
      const t = (k) => String(it[k] ?? '').trim();
      // ส่งเฉพาะช่องที่หมวดนี้ใช้ (ชื่อคีย์ตาม update_request)
      const u = { category: f.code, expense_date: it.expenseDate };
      if (f.fuel) u.mileage_km = String(Number(it.mileageKm) || 0);
      else { u.amount = String(Number(it.amount) || 0); u.mileage_km = ''; u.venue = t('venue'); }
      if (f.travel) { u.origin = t('origin'); u.destination = t('destination'); }
      if (f.travel || f.ent || f.visit) u.customer = t('customer');
      if ((f.travel && !f.fuel) || f.ent || f.visit) u.customer_contact = t('customerContact');
      if (f.ent || f.visit) u.occasion = t('occasion');
      if (f.ent) u.attendees = t('attendees');
      if (f.job) u.job_no = t('jobNo');
      btn.disabled = true;
      try {
        const removed = rp.kept().length < (r.receipt_paths || []).length;
        const res = await busy('กำลังบันทึก…', async (set) => {
          const prog = (k, n) => set(`อัปโหลดใบเสร็จ (${k}/${n})`);
          let paths = [];
          if (removed) paths = await rp.uploadAll(prog);          // ลบบางไฟล์ → แทนที่ทั้งชุด (ที่เหลือ + ใหม่)
          else if (rp.hasNew()) paths = await rp.uploadNew(prog); // เพิ่มอย่างเดียว
          set('กำลังบันทึก…');
          return api.rpc('update_request', { p_id: r.id, p_updates: u, p_new_receipts: paths, p_replace_receipts: removed });
        });
        s.close();
        toast('บันทึกการแก้ไขแล้ว');
        await reload();
        if (ctx.alive()) openDetail(res?.id || r.id);
      } catch (e) { toastError(e); }
      finally { btn.disabled = false; }
    }
  }

  // ── เหตุการณ์ ──
  const offs = [
    on(el, 'click', '[data-filter]', (e, t) => { S.filter = t.dataset.filter; paint(); }),
    on(el, 'click', '.row[data-id]', (e, t) => openDetail(t.dataset.id)),
    on(el, 'input', '[data-q]', debounce((e, t) => { S.q = t.value; paint(); }, 200)),
  ];

  await reload();
  if (ctx.query.id && ctx.alive()) openDetail(ctx.query.id);
  return () => { offs.forEach((f) => f()); S.sheet?.close(); };
}
