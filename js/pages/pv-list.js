// ใบสำคัญจ่าย — รอฉัน / ของฉัน / ทั้งหมด · ค้นหาเลขใบ, Job, PO, Cost sheet, ผู้รับเงิน · กรองตามขั้น
import { api, money, esc } from '../core.js?v=10.1.0';
import { icon, empty, errorBox, skeleton, debounce, on, $ } from '../ui.js?v=10.1.0';
import { STAGES, pvRow } from './pv-common.js?v=10.1.0';

export async function render(ctx) {
  const { el, query } = ctx;
  const st = { scope: ['todo', 'mine', 'all'].includes(query.scope) ? query.scope : '', q: query.q || '', stage: query.stage || '', items: [], meta: null };

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
    list.innerHTML = `<div class="card"><div class="card-head"><span class="text-sm muted">${st.items.length} ใบ</span><span class="text-sm">รวม <b class="amount">${money(sum)}</b> บาท</span></div>
      <div class="list">${st.items.map(pvRow).join('')}</div></div>`;
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
    on(el, 'click', '[data-s]', (e, t) => { st.scope = t.dataset.s; reload(); paint(); }),
    on(el, 'click', '[data-stage]', (e, t) => { st.stage = t.dataset.stage; reload(); paint(); }),
    on(el, 'input', '[data-q]', (e, t) => { st.q = t.value.trim(); reload(); }),
  ];
  return () => offs.forEach((f) => f());
}
