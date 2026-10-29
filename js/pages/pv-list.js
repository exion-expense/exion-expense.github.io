// ใบสำคัญจ่าย — รอฉัน / ของฉัน / ทั้งหมด · ค้นหาเลขใบ, Job, PO, Cost sheet, ผู้รับเงิน · กรองตามขั้น · อนุมัติหลายใบพร้อมกัน (ยกเว้นบัญชี 1 ที่ต้องเลือก VAT ทีละใบ)
import { api, money, esc } from '../core.js?v=10.1.3';
import { icon, toast, confirmBox, promptBox, busy, empty, errorBox, skeleton, debounce, on, $ } from '../ui.js?v=10.1.3';
import { STAGES, pvRow } from './pv-common.js?v=10.1.3';

export async function render(ctx) {
  const { el, query } = ctx;
  const st = { scope: ['todo', 'mine', 'all'].includes(query.scope) ? query.scope : '', q: query.q || '', stage: query.stage || '', items: [], meta: null, sel: new Set() };
  const canBulk = (x) => st.scope === 'todo' && x.canAct && x.stage !== 'fin1';

  el.innerHTML = `
  <div class="stack">
    <div class="toolbar" style="margin-bottom:0">
      <div class="seg" data-scope>
        <button type="button" data-s="todo">รอฉัน <span class="n" data-todo></span></button>
        <button type="button" data-s="mine">ของฉัน</button>
        <button type="button" data-s="all">ทั้งหมด</button>
      </div>
      <div class="search">${icon('search')}<input class="input" type="search" data-q placeholder="ค้นหา เลขใบ / Job / PO / Cost sheet / ผู้รับเงิน" aria-label="ค้นหา" value="${esc(st.q)}"></div>
      <a class="btn btn-primary" href="#/petty/request">${icon('plus')} เบิกใหม่</a>
      <a class="btn btn-secondary hidden" href="#/pv/dashboard" data-dash>${icon('chart')} Dashboard</a>
    </div>
    <div class="chips" data-stages>${STAGES.map(([k, l]) => `<button type="button" class="chip ${st.stage === k ? 'on' : ''}" data-stage="${k}">${l}</button>`).join('')}</div>
    <div data-list>${skeleton(5)}</div>
  </div>`;

  async function load() {
    try {
      const [items, meta] = await Promise.all([
        api.rpc('get_pv_list', { p_scope: st.scope, p_q: st.q, p_stage: st.stage, p_limit: 300 }),
        st.meta ? st.meta : api.rpc('get_pv_form_meta', {}, { ttl: 60 }),
      ]);
      if (!ctx.alive()) return;
      st.items = items || []; st.meta = meta;
      if (st.scope === 'todo' && !st.q && !st.stage) { const b = $('[data-todo]', el); if (b) b.textContent = st.items.length || ''; }
      const ids = new Set(st.items.filter(canBulk).map((x) => x.id));
      [...st.sel].forEach((id) => { if (!ids.has(id)) st.sel.delete(id); });
      paint();
    } catch (e) { if (ctx.alive()) errorBox($('[data-list]', el), e, load); }
  }
  function paint() {
    el.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === st.scope));
    el.querySelectorAll('[data-stage]').forEach((b) => b.classList.toggle('on', b.dataset.stage === st.stage));
    $('[data-dash]', el).classList.toggle('hidden', !st.meta?.canDash);
    const list = $('[data-list]', el);
    if (!st.items.length) {
      list.innerHTML = `<div class="card">${empty({ ic: 'receipt', title: st.q || st.stage ? 'ไม่พบใบที่ตรงเงื่อนไข' : st.scope === 'todo' ? 'ไม่มีใบที่รอคุณ' : 'ยังไม่มีใบสำคัญจ่าย',
        sub: st.scope === 'todo' ? 'ใบที่ต้องให้คุณอนุมัติ / จ่ายเงิน / ตรวจเคลียร์จะแสดงที่นี่' : '' })}</div>`;
      return;
    }
    const sum = st.items.reduce((s, x) => s + Number(x.amount || 0), 0);
    const bulk = st.items.filter(canBulk), all = bulk.length > 0 && bulk.every((x) => st.sel.has(x.id));
    const sel = st.items.filter((x) => st.sel.has(x.id)), selSum = sel.reduce((s, x) => s + Number(x.amount || 0), 0);
    list.innerHTML = `<div class="card"><div class="card-head">${bulk.length ? `<label class="check"><input type="checkbox" data-all ${all ? 'checked' : ''}> เลือกทั้งหมด (${bulk.length})</label>` : `<span class="text-sm muted">${st.items.length} ใบ</span>`}
      <span class="text-sm">รวม <b class="amount">${money(sum)}</b> บาท</span></div>
      <div class="list">${st.items.map((x) => pvRow(x, { select: canBulk(x), checked: st.sel.has(x.id) })).join('')}</div></div>
      ${sel.length ? `<div class="action-bar"><div class="grow">เลือก ${sel.length} ใบ · <b class="amount">${money(selSum)}</b></div>
        <button type="button" class="btn-icon sm" data-act="clear" aria-label="ล้างที่เลือก" style="color:#fff">${icon('x')}</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="bulk-reject">ตีกลับ</button>
        <button type="button" class="btn btn-success btn-sm" data-act="bulk-approve">${icon('check', 'sm')} อนุมัติ</button></div>` : ''}`;
  }

  // อนุมัติ / ตีกลับหลายใบ: ทำทีละใบตามลำดับ แล้วสรุปผล
  async function bulk(action) {
    const items = st.items.filter((x) => st.sel.has(x.id));
    if (!items.length) return;
    const sum = items.reduce((s, x) => s + Number(x.amount || 0), 0);
    let remark = '';
    if (action === 'reject') {
      remark = await promptBox({ title: `ตีกลับ ${items.length} ใบ`, label: 'เหตุผล (ใช้กับทุกใบที่เลือก)', hint: 'แต่ละใบจะถอยกลับไปขั้นก่อนหน้า 1 ขั้น', required: true, ok: 'ตีกลับทั้งหมด', danger: true });
      if (remark == null) return;
    } else if (!(await confirmBox({ title: `อนุมัติ ${items.length} ใบ`, message: `รวม ${money(sum)} บาท`, ok: 'อนุมัติทั้งหมด' }))) return;
    let done = 0; const fails = [];
    await busy('กำลังบันทึก…', async (set) => {
      for (let i = 0; i < items.length; i++) {
        set(`กำลังบันทึก ${i + 1}/${items.length}`);
        try { await api.rpc('pv_decide', { p_id: items[i].id, p_action: action, p_remark: remark }); done++; st.sel.delete(items[i].id); }
        catch (e) { fails.push(`${items[i].id}: ${e.message}`); }
      }
    });
    const verb = action === 'approve' ? 'อนุมัติ' : 'ตีกลับ';
    toast(fails.length ? `${verb}แล้ว ${done} ใบ · ไม่สำเร็จ ${fails.length} — ${fails[0]}` : `${verb}แล้ว ${done} ใบ`, fails.length ? 'bad' : 'ok');
    ctx.refreshBadges();
    await load();
  }

  // ค่าเริ่ม: มีใบรอฉัน → แท็บรอฉัน ไม่งั้นของฉัน
  if (!st.scope) {
    const n = await api.rpc('get_pv_todo_count', {}, { quiet: true }).catch(() => 0);
    if (!ctx.alive()) return;
    st.scope = n > 0 ? 'todo' : 'mine';
    $('[data-todo]', el).textContent = n || '';
  } else api.rpc('get_pv_todo_count', {}, { quiet: true }).then((n) => { const b = $('[data-todo]', el); if (b) b.textContent = n || ''; }).catch(() => {});
  await load();

  const reload = debounce(() => { $('[data-list]', el).innerHTML = skeleton(3); load(); }, 300);
  const offs = [
    on(el, 'click', '[data-s]', (e, t) => { st.scope = t.dataset.s; st.sel.clear(); reload(); paint(); }),
    on(el, 'click', '[data-stage]', (e, t) => { st.stage = t.dataset.stage; reload(); paint(); }),
    on(el, 'input', '[data-q]', (e, t) => { st.q = t.value.trim(); reload(); }),
    // ช่องติ๊กอยู่ในแถวที่เป็นลิงก์ → กันไม่ให้เปิดใบ แล้วสลับเอง
    on(el, 'click', '.row .check', (e, t) => {
      e.preventDefault(); e.stopPropagation();
      const id = t.querySelector('[data-sel]')?.dataset.sel; if (!id) return;
      st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id); paint();
    }),
    on(el, 'change', '[data-all]', (e, t) => { st.items.filter(canBulk).forEach((x) => (t.checked ? st.sel.add(x.id) : st.sel.delete(x.id))); paint(); }),
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'clear') { st.sel.clear(); paint(); }
      else if (a === 'bulk-approve') bulk('approve');
      else if (a === 'bulk-reject') bulk('reject');
    }),
  ];
  return () => offs.forEach((f) => f());
}
