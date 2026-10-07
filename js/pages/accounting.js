// บัญชี · โอนเงิน — บอร์ดรายคนต่อเดือน: ยังไม่ขอ → รออนุมัติ → รอโอน → โอนแล้ว + ส่งสรุปให้ CEO
import { api, money, compact, fmtDate, fmtDateTime, esc, initials, monthLabel, catName, statusBadge } from '../core.js?v=10.0.13';
import { icon, catIcon, requestRow, toast, toastError, confirmBox, sheet, withBtn, monthNav, shiftMonth, empty, errorBox, lightbox, on, debounce } from '../ui.js?v=10.0.13';

const STAGE = {
  ready: ['รอโอน', 'b-approved'], export: ['รออนุมัติ', 'b-pending'], bills: ['บิลรออนุมัติ', 'b-violet'],
  unrequested: ['ยังไม่ขอเบิก', 'b-info'], none: ['ไม่มีรายการ', 'b-neutral'], paid: ['โอนแล้ว', 'b-paid'],
};
// ชิปกรอง (ยังไม่ขอ = มีบิลอนุมัติแล้วแต่ยังไม่ส่ง + บิลยังรออนุมัติ)
const FILTERS = [['all', 'ทั้งหมด', null], ['ready', 'รอโอน', ['ready']], ['export', 'รออนุมัติ', ['export']],
  ['todo', 'ยังไม่ขอ', ['unrequested', 'bills']], ['paid', 'โอนแล้ว', ['paid']], ['none', 'ไม่มีรายการ', ['none']]];
const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const deptLabel = (d) => (!d || d === '*' ? 'ทุกแผนก' : d);
const SUM_ST = { Pending: ['รอ CEO อนุมัติ', 'b-pending'], Approved: ['CEO อนุมัติแล้ว', 'b-approved'], Rejected: ['CEO ไม่อนุมัติ', 'b-rejected'] };

export async function render(ctx) {
  const { el } = ctx;
  const now = new Date();
  const st = { y: now.getFullYear(), m: now.getMonth() + 1, board: null, unpaid: [], filter: null, dept: '*', q: '' };
  // ค่าเริ่มต้น: เดือนก่อน ถ้าวันนี้ยังต้นเดือน (บัญชีมักโอนของรอบที่แล้ว)
  if (now.getDate() <= 10) [st.y, st.m] = shiftMonth(st.y, st.m, -1);

  el.innerHTML = `<div class="stack"><div id="ac-hero"></div><div id="ac-ceo"></div><div id="ac-list"></div><div id="ac-old"></div></div>`;
  const $ = (id) => el.querySelector('#' + id);

  async function load() {
    const y = st.y, m = st.m;
    api.rpc('get_unpaid_exports').then((u) => { st.unpaid = u || []; if (ctx.alive() && st.board) paintOld(); }).catch(() => {});
    try {
      await api.load('get_accounting_board', { p_ym: ymOf(y, m) }, (b) => {
        if (!ctx.alive() || y !== st.y || m !== st.m) return;
        st.board = b;
        if (!st.filter) st.filter = b.counts?.ready ? 'ready' : 'all';
        paint();
      });
    } catch (e) { if (ctx.alive()) errorBox($('ac-list'), e, load); }
  }

  function paint() { paintHero(); paintCeo(); paintList(); paintOld(); }

  function paintHero() {
    const b = st.board, c = b.counts || {};
    $('ac-hero').innerHTML = `<div class="page-head compact"><div><h1>บัญชี · โอนเงิน</h1><div class="sub">สถานะการเบิกรายคน เดือน${esc(monthLabel(b.year, b.month, true))}</div></div>
      <div class="actions">${monthNav(st.y, st.m)}</div></div>
    <section class="hero green">
      <div style="position:relative;z-index:1"><div class="eyebrow">ยอดรอโอน · ${esc(monthLabel(b.year, b.month, true))}</div><div class="big">${money(b.readyTotal)}</div></div>
      <div class="hero-stats">
        <div class="hs"><div class="v">${money(c.ready || 0, 0)} คน</div><div class="l">รอโอน</div></div>
        <div class="hs"><div class="v">${compact(b.paidTotal)}</div><div class="l">โอนแล้ว ${money(c.paid || 0, 0)} คน</div></div>
        <div class="hs"><div class="v">${money(c.export || 0, 0)} คน</div><div class="l">รออนุมัติ Export</div></div>
      </div>
      <div class="flex wrap mt-16">
        <button class="btn btn-white" data-act="sum" data-mode="print">${icon('sheet')} พิมพ์สรุป (เลือกแผนก)</button>
        <button class="btn btn-glass" data-act="sum" data-mode="ceo">${icon('crown')} ส่งสรุปให้ CEO</button>
      </div>
    </section>`;
  }

  function paintCeo() {
    const b = st.board, list = b.summaries || [];
    $('ac-ceo').innerHTML = `<div class="card"><div class="card-head"><h3>${icon('crown')} สรุปให้ CEO · ${esc(monthLabel(b.year, b.month))}</h3>
        ${list.length ? '' : '<span class="muted text-sm">ยังไม่ได้ส่ง</span>'}</div>
      ${!b.ceoConfigured ? `<div class="pad"><div class="alert warn">${icon('alert')}<div>ยังไม่ได้ตั้งค่าอีเมล CEO (CEO_EMAIL) — ส่งสรุปไม่ได้</div></div></div>` : ''}
      ${list.length ? `<div class="list">${list.map((s) => {
        const [t, c] = SUM_ST[s.status] || [s.status, 'b-neutral'];
        return `<div class="row"><span class="row-icon ${s.status === 'Approved' ? 'c-green' : s.status === 'Rejected' ? 'c-red' : 'c-amber'}">${icon(s.status === 'Approved' ? 'check' : s.status === 'Rejected' ? 'x' : 'clock')}</span>
          <div class="row-main"><div class="row-title">${esc(deptLabel(s.department))} · ${money(s.staff_count, 0)} คน</div>
            <div class="row-sub">ส่งเมื่อ ${fmtDateTime(s.requested_at)}${s.ceo_at ? ` · ตัดสิน ${fmtDateTime(s.ceo_at)}` : ''}${s.ceo_remark ? ` · ${esc(s.ceo_remark)}` : ''}</div></div>
          <div class="row-end"><span class="amount">${money(s.total)}</span><span class="badge ${c}">${esc(t)}</span></div></div>`;
      }).join('')}</div>` : b.ceoConfigured ? `<div class="pad"><p class="hint">เมื่อโอนครบหรือพร้อมแล้ว กด “ส่งสรุปให้ CEO” (เลือกแผนกได้) เพื่อให้ CEO อนุมัติยอดรวมของเดือน</p></div>` : ''}
    </div>`;
  }

  function visibleCards() {
    const f = FILTERS.find((x) => x[0] === st.filter)?.[2];
    const q = st.q.trim().toLowerCase();
    return (st.board.cards || []).filter((c) => (!f || f.includes(c.stage)) && (st.dept === '*' || c.department === st.dept)
      && (!q || [c.name, c.fullName, c.staffEmail, c.team].some((x) => String(x || '').toLowerCase().includes(q))));
  }

  function paintList() {
    const b = st.board;
    const cards = (b.cards || []).filter((c) => st.dept === '*' || c.department === st.dept);
    const cnt = (k) => { const f = FILTERS.find((x) => x[0] === k)[2]; return f ? cards.filter((c) => f.includes(c.stage)).length : cards.length; };
    const rows = visibleCards();
    $('ac-list').innerHTML = `<div class="stack-sm">
      <div class="chips">${FILTERS.map(([k, l]) => `<button class="chip ${st.filter === k ? 'on' : ''}" data-filter="${k}">${l} <span class="n">${cnt(k)}</span></button>`).join('')}</div>
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="ac-q" placeholder="ค้นหาชื่อ / ทีม" value="${esc(st.q)}" aria-label="ค้นหา"></div>
        ${(b.departments || []).length > 1 ? `<select class="input" id="ac-dept" aria-label="แผนก" style="width:auto;min-width:150px"><option value="*">ทุกแผนก</option>
          ${b.departments.map((d) => `<option value="${esc(d)}" ${st.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="card">${rows.length ? `<div class="list">${rows.map(cardRow).join('')}</div>`
        : empty({ ic: st.filter === 'ready' ? 'check-circle' : 'users', title: st.filter === 'ready' ? 'ไม่มีรายการรอโอน' : 'ไม่มีพนักงานในกลุ่มนี้', sub: 'ลองเลือกชิปอื่นหรือเดือนอื่น' })}</div>
    </div>`;
  }

  function paintOld() {
    const box = $('ac-old'); if (!box || !st.board) return;
    const older = (st.unpaid || []).filter((e) => !(e.year === st.y && e.month === st.m));
    if (!older.length) { box.innerHTML = ''; return; }
    const sum = older.reduce((s, e) => s + (Number(e.total_amount) || 0), 0);
    box.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('alert')} ค้างโอนจากเดือนอื่น <span class="badge b-pending plain">${older.length}</span></h3><span class="amount">${money(sum)}</span></div>
      <div class="list">${older.map((e) => `<div class="row click" data-act="items" data-email="${esc(e.staff_email)}" data-ym="${ymOf(e.year, e.month)}" data-name="${esc(e.staff_name)}">
        <span class="avatar sm">${esc(initials(e.staff_name))}</span>
        <div class="row-main"><div class="row-title">${esc(e.staff_name)}</div>
          <div class="row-sub">รอบ ${esc(monthLabel(e.year, e.month))} · ${money(e.item_count, 0)} รายการ · อนุมัติ ${fmtDate(e.decided_at)}</div></div>
        <div class="row-end"><span class="amount">${money(e.total_amount)}</span>
          <div class="flex gap-4"><button class="btn btn-secondary btn-sm" data-act="xls" data-id="${esc(e.id)}" aria-label="ดาวน์โหลดฟอร์ม">${icon('download', 'sm')}</button>
          <button class="btn btn-success btn-sm" data-act="paid" data-id="${esc(e.id)}" data-name="${esc(e.staff_name)}" data-amt="${e.total_amount}" data-dept="">${icon('check', 'sm')} โอนแล้ว</button></div></div></div>`).join('')}</div></div>`;
  }

  // ─────────── หน้าต่าง ───────────
  async function openItems(email, ym, name) {
    const s = sheet({ title: `รายการเบิก · ${name || email}`, wide: true, body: '<div class="flex"><span class="spin"></span><span class="muted">กำลังโหลด…</span></div>' });
    try {
      const d = await api.rpc('get_staff_claim_items', { p_staff_email: email, p_ym: ym });
      if (!s.el.isConnected) return;
      const items = d.items || [], autos = d.autoAllowance || [];
      const [y, m] = ym.split('-').map(Number);
      s.el.querySelector('.sheet-body').innerHTML = `<div class="stack-sm">
        <dl class="kv tight">
          <dt>รอบ</dt><dd>${esc(monthLabel(y, m, true))} · ${fmtDate(d.periodStart)} – ${fmtDate(d.periodEnd)}</dd>
          <dt>ที่มา</dt><dd>${d.source === 'export' ? `ตามใบขอเบิก ${d.exportStatus === 'Approved' ? statusBadge('Approved') : statusBadge(d.exportStatus || 'Pending')}` : 'บิลในเดือน (ยังไม่มีใบขอเบิก)'}</dd>
          <dt>ยอดอนุมัติ</dt><dd class="amount">${money(d.approvedTotal)} บาท</dd>
          ${Number(d.pendingTotal) > 0 ? `<dt>ยอดรออนุมัติ</dt><dd class="amount warn-text">${money(d.pendingTotal)} บาท</dd>` : ''}
          ${d.exportTotal != null ? `<dt>ยอดในใบขอเบิก</dt><dd class="amount">${money(d.exportTotal)} บาท</dd>` : ''}
        </dl>
        ${items.some((r) => (r.receipt_paths || []).length) ? '<p class="hint">แตะรายการที่มีไฟล์แนบเพื่อดูใบเสร็จ</p>' : ''}
        <div class="card">${items.length || autos.length ? `<div class="list">
          ${items.map((r, i) => requestRow(r, { attrs: `data-ri="${i}"` })).join('')}
          ${autos.map((a) => `<div class="row">${catIcon(a.category)}<div class="row-main"><div class="row-title">${esc(catName(a.category))}</div><div class="row-sub">ค่าเหมาจ่ายรายเดือน (อัตโนมัติ)</div></div>
            <div class="row-end"><span class="amount">${money(a.amount)}</span><span class="badge b-info plain">อัตโนมัติ</span></div></div>`).join('')}
        </div>` : empty({ ic: 'receipt', title: 'ไม่มีรายการ' })}</div>
        ${d.exportId && d.exportStatus === 'Approved' ? `<button class="btn btn-secondary btn-block" data-xls="${esc(d.exportId)}" data-busy="กำลังสร้างไฟล์…">${icon('download')} ดาวน์โหลดฟอร์มขอเบิกตัวจริง</button>` : ''}
      </div>`;
      s.el.addEventListener('click', async (e) => {
        const x = e.target.closest('[data-xls]');
        if (x) { try { const meta = await withBtn(x, () => api.excel({ type: 'staff_form', kind: 'final', exportId: x.dataset.xls })); if (meta) toast(`ดาวน์โหลดแล้ว · ${meta.filename}`); } catch (err) { toastError(err); } return; }
        const r = e.target.closest('[data-ri]');
        if (r) { const paths = items[+r.dataset.ri].receipt_paths || []; if (paths.length) lightbox(paths, 0); else toast('รายการนี้ไม่มีไฟล์แนบ', 'info'); }
      });
    } catch (e) {
      if (s.el.isConnected) s.el.querySelector('.sheet-body').innerHTML = `<div class="alert bad">${icon('alert')}<div>${esc(e.message)}</div></div>`;
    }
  }

  // ── สรุปตามแผนก: เลือกแผนกก่อน → ดาวน์โหลด Excel / ส่งให้ CEO ตรวจเฉพาะแผนกนั้น ──
  function deptRows(b) {
    const by = {};
    for (const c of b.cards || []) {
      const d = c.department || '-';
      const o = by[d] || (by[d] = { n: 0, total: 0, waiting: 0 });
      if (c.stage === 'ready' || c.stage === 'paid') { o.n++; o.total += Number(c.export?.total_amount || 0); }
      if (c.stage === 'export') o.waiting++;
    }
    const all = Object.values(by).reduce((a, o) => ({ n: a.n + o.n, total: a.total + o.total, waiting: a.waiting + o.waiting }), { n: 0, total: 0, waiting: 0 });
    return [{ d: '*', ...all }, ...(b.departments || []).slice().sort().map((d) => ({ d, ...(by[d] || { n: 0, total: 0, waiting: 0 }) }))];
  }
  function ceoState(b, d) {
    const live = (b.summaries || []).filter((x) => x.status === 'Pending' || x.status === 'Approved');
    const mine = live.find((x) => x.department === d);
    if (mine) return { tag: mine.status === 'Approved' ? 'CEO อนุมัติแล้ว' : 'รอ CEO', cls: mine.status === 'Approved' ? 'b-green' : 'b-amber', block: mine.status === 'Pending' ? 'ส่งแล้ว กำลังรอ CEO' : '' };
    if (d === '*' && live.some((x) => x.department !== '*')) return { tag: '', cls: '', block: 'เดือนนี้ส่งแยกแผนกไปแล้ว — ส่งต่อทีละแผนก' };
    if (d !== '*' && live.some((x) => x.department === '*')) return { tag: 'รวมในใบทุกแผนก', cls: 'b-neutral', block: 'เดือนนี้ส่งแบบรวมทุกแผนกไปแล้ว' };
    return { tag: '', cls: '', block: '' };
  }
  function openSummarySheet(mode) {
    const b = st.board, ym = ymOf(b.year, b.month), rows = deptRows(b);
    let pick = rows.some((r) => r.d === st.dept) ? st.dept : '*';
    const rowHtml = (r) => {
      const cs = ceoState(b, r.d);
      return `<label class="opt-row ${r.d === pick ? 'on' : ''}"><input type="radio" name="sum-dept" value="${esc(r.d)}" ${r.d === pick ? 'checked' : ''}>
        <div class="grow"><div class="bold">${r.d === '*' ? 'ทุกแผนก (รวมเป็นใบเดียว)' : esc(r.d)}</div>
          <div class="text-sm muted">${money(r.n, 0)} คน · ${money(r.total)} บาท${r.waiting ? ` · <span class="amber-text">รออนุมัติ Export ${money(r.waiting, 0)} คน</span>` : ''}</div></div>
        ${cs.tag ? `<span class="badge ${cs.cls}">${esc(cs.tag)}</span>` : ''}</label>`;
    };
    sheet({
      title: `สรุปยอด ${monthLabel(b.year, b.month, true)}`,
      body: `<div class="stack-sm">
        <p class="muted text-sm">เลือกแผนกก่อน แล้ว <b>ดาวน์โหลด Excel</b> เพื่อพิมพ์ หรือ <b>ส่งให้ CEO ตรวจ</b> เฉพาะแผนกนั้น — ยอดมาจากใบขอเบิกที่อนุมัติแล้ว (รวมที่โอนแล้ว)</p>
        <div class="opt-list">${rows.map(rowHtml).join('')}</div>
        <div class="alert neutral hidden" data-why>${icon('info')}<div data-whyt></div></div>
        ${!b.ceoConfigured ? `<div class="alert warn">${icon('alert')}<div>ยังไม่ได้ตั้งค่าอีเมล CEO (CEO_EMAIL) — ส่งให้ CEO ไม่ได้</div></div>` : ''}
      </div>`,
      foot: `<button class="btn ${mode === 'print' ? 'btn-primary' : 'btn-secondary'}" data-xls data-busy="กำลังสร้างไฟล์…">${icon('download')} ดาวน์โหลด Excel</button>
        <button class="btn ${mode === 'ceo' ? 'btn-primary' : 'btn-secondary'}" data-ceo data-busy="กำลังส่ง…">${icon('crown')} ส่งให้ CEO ตรวจ</button>`,
      onMount: (box, close) => {
        const sync = () => {
          box.querySelectorAll('.opt-row').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
          const r = rows.find((x) => x.d === pick), cs = ceoState(b, pick);
          const why = !b.ceoConfigured ? 'ยังไม่ได้ตั้งค่าอีเมล CEO' : cs.block || (r && r.n === 0 ? 'แผนกนี้ยังไม่มีใบขอเบิกที่อนุมัติแล้วในเดือนนี้' : '');
          box.querySelector('[data-ceo]').disabled = !!why;
          box.querySelector('[data-ceo]').innerHTML = `${icon('crown')} ส่ง${pick === '*' ? 'ทุกแผนก' : esc(pick)}ให้ CEO ตรวจ`;
          box.querySelector('[data-xls]').innerHTML = `${icon('download')} Excel ${pick === '*' ? 'ทุกแผนก' : esc(pick)}`;
          box.querySelector('[data-xls]').disabled = !!(r && r.n === 0);
          box.querySelector('[data-why]').classList.toggle('hidden', !why || why === 'ยังไม่ได้ตั้งค่าอีเมล CEO');
          box.querySelector('[data-whyt]').textContent = why;
        };
        box.addEventListener('change', (e) => { if (e.target.name === 'sum-dept') { pick = e.target.value; sync(); } });
        sync();
        box.querySelector('[data-xls]').onclick = async (e) => {
          const btn = e.currentTarget;
          try { const meta = await withBtn(btn, () => api.excel({ type: 'staff_summary', ym, dept: pick })); if (meta) toast(`ดาวน์โหลดแล้ว · ${meta.filename}`); }
          catch (err) { toastError(err); }
        };
        box.querySelector('[data-ceo]').onclick = async (e) => {
          const btn = e.currentTarget, label = pick === '*' ? 'ทุกแผนก' : `แผนก ${pick}`;
          try {
            const r = await withBtn(btn, () => api.rpc('submit_summary_for_ceo', { p_ym: ym, p_dept: pick }));
            close(true);
            toast(`ส่งให้ CEO แล้ว · ${label} · ${r.count} คน · ${money(r.total)} บาท`);
            ctx.refreshBadges(); load();
          } catch (err) { toastError(err); }
        };
      },
    });
  }

  async function act(t) {
    const a = t.dataset.act;
    try {
      if (a === 'items') return openItems(t.dataset.email, t.dataset.ym || ymOf(st.y, st.m), t.dataset.name);
      if (a === 'sum') { if (!st.board.ceoConfigured && t.dataset.mode === 'ceo') { toast('ยังไม่ได้ตั้งค่าอีเมล CEO (CEO_EMAIL)', 'bad'); return; } return openSummarySheet(t.dataset.mode); }
      if (a === 'xls') {
        const meta = await withBtn(t, () => api.excel({ type: 'staff_form', kind: 'final', exportId: t.dataset.id }));
        if (meta) toast(`ดาวน์โหลดแล้ว · ${meta.filename}`);
        return;
      }
      if (a === 'paid') {
        // เตือนถ้า CEO ยังไม่อนุมัติสรุปของเดือนนี้ (ไม่บล็อก)
        const sums = st.board?.summaries || [];
        const dept = t.dataset.dept;
        const ceoOk = dept === '' || sums.some((s) => s.status === 'Approved' && (s.department === '*' || s.department === dept));
        const msg = `${t.dataset.name} · ${money(t.dataset.amt)} บาท\nระบบจะแจ้งพนักงานทันที และย้อนกลับไม่ได้${ceoOk ? '' : '\n\n⚠️ CEO ยังไม่อนุมัติสรุปของเดือนนี้'}`;
        if (!(await confirmBox({ title: 'ยืนยันโอนเงินแล้ว', message: msg, ok: 'ยืนยันโอนแล้ว' }))) return;
        await api.rpc('mark_export_paid', { p_id: t.dataset.id });
        toast('บันทึกการโอนแล้ว');
        ctx.refreshBadges();
        load();
      }
    } catch (e) { toastError(e); }
  }

  await load();

  const search = debounce((v) => { st.q = v; const pos = el.querySelector('#ac-q')?.selectionStart; paintList(); const q = el.querySelector('#ac-q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 200);
  const offs = [
    on(el, 'click', '[data-act]', (e, t) => act(t)),
    on(el, 'click', '[data-filter]', (e, t) => { st.filter = t.dataset.filter; paintList(); }),
    on(el, 'click', '[data-mprev],[data-mnext]', (e, t) => {
      [st.y, st.m] = shiftMonth(st.y, st.m, t.hasAttribute('data-mprev') ? -1 : 1);
      st.filter = null;
      $('ac-list').innerHTML = '<div class="card"><div class="skel-row"><div class="skel a"></div><div class="skel b"></div><div class="skel c"></div></div><div class="skel-row"><div class="skel a"></div><div class="skel b"></div><div class="skel c"></div></div></div>';
      load();
    }),
    on(el, 'input', '#ac-q', (e, t) => search(t.value)),
    on(el, 'change', '#ac-dept', (e, t) => { st.dept = t.value; paintList(); }),
  ];
  return () => offs.forEach((f) => f());
}

// แถวพนักงาน 1 คน
function cardRow(c) {
  const e = c.export || {};
  const [stl, stc] = STAGE[c.stage] || [c.stage, 'b-neutral'];
  let detail = '', amt = null, actions = '';
  if (c.stage === 'ready') {
    detail = `อนุมัติโดย ${e.approver_name || '-'} · ${c.days ? `รอโอน ${c.days} วัน` : 'อนุมัติวันนี้'} · ${money(e.item_count, 0)} รายการ`;
    amt = e.total_amount;
    actions = `<button class="btn btn-secondary btn-sm" data-act="xls" data-id="${esc(e.id)}" aria-label="ดาวน์โหลดฟอร์ม">${icon('download', 'sm')}</button>
      <button class="btn btn-success btn-sm" data-act="paid" data-id="${esc(e.id)}" data-name="${esc(c.fullName || c.name)}" data-amt="${e.total_amount}" data-dept="${esc(c.department || '')}">${icon('check', 'sm')} ยืนยันโอนแล้ว</button>`;
  } else if (c.stage === 'export') {
    detail = `รอ ${e.approver_name || 'ผู้อนุมัติ'} อนุมัติ${c.days ? ` · ${c.days} วันแล้ว` : ''} · ${money(e.item_count, 0)} รายการ`;
    amt = e.total_amount;
  } else if (c.stage === 'paid') {
    detail = `โอนเมื่อ ${fmtDate(e.paid_at)}${e.paid_by_name ? ' โดย ' + e.paid_by_name : ''}`;
    amt = e.total_amount;
    actions = `<button class="btn btn-secondary btn-sm" data-act="xls" data-id="${esc(e.id)}" aria-label="ดาวน์โหลดฟอร์ม">${icon('download', 'sm')}</button>`;
  } else if (c.stage === 'bills') {
    detail = `บิลรออนุมัติ ${c.pendingCount} รายการ (${money(c.pendingAmount, 0)}) · รอ ${c.pendingWith || 'หัวหน้า'}`;
    amt = c.unclaimedAmount + c.pendingAmount;
  } else if (c.stage === 'unrequested') {
    detail = `อนุมัติแล้ว ${c.unclaimedCount} รายการ · ยังไม่ส่งขอเบิกรายเดือน`;
    amt = c.unclaimedAmount;
  } else detail = 'ไม่มีบิลในเดือนนี้';
  const extra = [];
  if (c.stage !== 'bills' && c.pendingCount > 0 && c.stage !== 'none') extra.push(`มีบิลรออนุมัติอีก ${c.pendingCount} รายการ`);
  if (c.olderCount > 0) extra.push(`บิลเก่าค้าง ${c.olderCount} รายการ (${money(c.olderAmount, 0)})`);
  return `<div class="row click" data-act="items" data-email="${esc(c.staffEmail)}" data-name="${esc(c.fullName || c.name)}">
    <span class="avatar sm">${esc(initials(c.name))}</span>
    <div class="row-main"><div class="row-title">${esc(c.fullName || c.name)} <span class="muted text-sm">· ${esc(c.department || '-')}</span></div>
      <div class="row-sub">${esc(detail)}</div>
      ${extra.length ? `<div class="row-sub warn-text">${esc(extra.join(' · '))}</div>` : ''}</div>
    <div class="row-end">${amt != null ? `<span class="amount">${money(amt)}</span>` : ''}<span class="badge ${stc}">${esc(stl)}</span>
      ${actions ? `<div class="flex gap-4">${actions}</div>` : ''}</div>
  </div>`;
}
