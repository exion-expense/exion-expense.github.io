// เคลียร์ advance — หน้ารวม advance ของฉัน: รอเคลียร์ (กรอกตาราง) / รอบัญชีตรวจ / ใช้เกิน รอส่งใบส่วนเกิน / เคลียร์แล้ว
// ใช้ข้อมูลจาก get_pv_list (ใบที่ฉันเบิก หรือกรอกแทน) · ปุ่มในแต่ละแถวพาไปหน้ากรอกตาราง / ใบ advance
import { api, money, fmtDate, esc } from '../core.js?v=10.4.26';
import { icon, empty, errorBox, skeleton } from '../ui.js?v=10.4.26';
import { isTest } from './pv-common.js?v=10.4.26';

export async function render(ctx) {
  const { el, profile } = ctx;
  const st = { open: [], check: [], over: [], done: [], fin: 0 };
  const list = (stage, limit = 100) => api.rpc('get_pv_list', { p_scope: 'mine', p_q: '', p_stage: stage, p_limit: limit });

  async function load() {
    try {
      const role = profile.role || {};
      const [open, check, paid, todo] = await Promise.all([list('adv_open'), list('adv_check'), list('paid', 300),
        role.isAccountant || role.isGM ? api.rpc('get_pv_list', { p_scope: 'todo', p_q: '', p_stage: 'adv_check', p_limit: 100 }).catch(() => []) : []]);
      if (!ctx.alive()) return;
      st.open = open || []; st.check = check || []; st.fin = (todo || []).length;
      const cleared = (paid || []).filter((x) => x.kind === 'ADV' && x.advClear === 'Cleared');
      // ใช้เกิน: ถามสถานะใบส่วนเกินของแต่ละใบ (ไม่เกิน 10 ใบล่าสุด) → แยก "ยังไม่ได้ส่งใบส่วนเกิน" ออกมาไว้บนสุด
      const overs = cleared.filter((x) => Number(x.advActual) > Number(x.amount)).slice(0, 10);
      const info = await Promise.all(overs.map((x) => api.rpc('get_pv_adv', { p_id: x.id }, { quiet: true }).catch(() => null)));
      if (!ctx.alive()) return;
      st.over = overs.map((x, i) => ({ ...x, adv: info[i] })).filter((x) => x.adv?.canClaimExtra);
      const overIds = new Set(st.over.map((x) => x.id));
      st.done = cleared.filter((x) => !overIds.has(x.id)).slice(0, 8);
      paint();
    } catch (e) { if (ctx.alive()) errorBox(el, e, load); }
  }

  const head = (x) => `<div class="row-title"><span class="mono">${esc(x.id)}</span> · ${esc(x.supplier || x.payee)}${isTest(x.id) ? ' <span class="badge b-pending plain">ทดลอง</span>' : ''}</div>`;
  const who = (x) => `${esc(x.requesterName)}${x.onBehalfBy ? ' · กรอกโดย ' + esc(x.onBehalfBy) : ''}`;
  const card = (x, sub, badge, btn) => `<div class="card pad adv-item">
      <div class="row-main">${head(x)}<div class="row-sub">${who(x)} · ${sub}</div></div>
      <div class="adv-end"><span class="amount">${money(x.amount)}</span>${badge}</div>
      <div class="adv-btn">${btn}</div></div>`;
  const section = (title, hint, items) => items.length ? `<div class="stack-sm"><div><b>${title}</b> <span class="badge b-neutral plain">${items.length}</span>${hint ? `<div class="hint">${hint}</div>` : ''}</div>${items.join('')}</div>` : '';

  function paint() {
    const view = (x) => `#/pv/view?id=${encodeURIComponent(x.id)}`;
    const open = st.open.map((x) => card(x,
      x.advClear === 'Returned' ? 'บัญชีตีกลับการเคลียร์ ให้แก้แล้วส่งใหม่' : `รับเงิน ${x.paidAt ? fmtDate(x.paidAt) : '-'} · เคลียร์ภายใน ${x.advDue ? fmtDate(x.advDue) : '-'}`,
      x.advClear === 'Returned' ? '<span class="badge b-rejected">ตีกลับ</span>' : x.advOverdue ? '<span class="badge b-rejected">เลยกำหนดเคลียร์</span>' : '<span class="badge b-pending">รอเคลียร์</span>',
      `<a class="btn btn-primary btn-sm" href="#/pv/clear?id=${encodeURIComponent(x.id)}">${icon('edit', 'sm')} กรอกตารางเคลียร์</a><a class="btn btn-secondary btn-sm" href="${view(x)}">ดูใบ</a>`));
    const over = st.over.map((x) => card(x, `ใช้จริง ${money(x.advActual)} · บัญชีตรวจเคลียร์แล้ว`,
      `<span class="badge b-pending">ใช้เกิน ${money(x.adv.extraDue)}</span>`,
      `<a class="btn btn-primary btn-sm" href="${view(x)}">${icon('send', 'sm')} เบิกส่วนเกิน ${money(x.adv.extraDue)} บาท</a>`));
    const check = st.check.map((x) => card(x, `ใช้จริง ${money(x.advActual)} · ส่งเคลียร์แล้ว`,
      '<span class="badge b-info">รอบัญชีตรวจ</span>', `<a class="btn btn-secondary btn-sm" href="${view(x)}">ดูตาราง / Excel</a>`));
    const done = st.done.map((x) => card(x, `ใช้จริง ${money(x.advActual)}`,
      '<span class="badge b-paid">เคลียร์แล้ว</span>', `<a class="btn btn-secondary btn-sm" href="${view(x)}">ดูตาราง / Excel</a>`));
    const todo = open.length + over.length;
    el.innerHTML = `<div class="stack">
      ${st.fin ? `<a class="card row" href="#/pv?scope=todo&stage=adv_check"><span class="row-icon c-red">${icon('check-circle')}</span><div class="row-main"><div class="row-title">รอคุณตรวจเคลียร์ <span class="badge b-pending plain">${st.fin}</span></div>
        <div class="row-sub">advance ที่พนักงานส่งเคลียร์มา (ฝ่ายบัญชี)</div></div>${icon('chevron-right')}</a>` : ''}
      ${section('ต้องกรอกตารางเคลียร์', 'advance ที่รับเงินแล้ว · กรอกรายการที่ใช้จริง แนบใบเสร็จ แล้วส่งให้บัญชีตรวจ (บันทึกร่างไว้กรอกต่อได้)', open)}
      ${section('ใช้เกิน รอส่งใบเบิกส่วนเกิน', 'บัญชีตรวจเคลียร์แล้ว · กดปุ่มเพื่อเปิดใบแล้วส่งใบฟ้าส่วนที่เกิน (ไม่ใช่ advance)', over)}
      ${!todo ? `<div class="card">${empty({ ic: 'check-circle', title: 'ไม่มี advance ที่ต้องเคลียร์',
        sub: 'ขอ advance ที่ปุ่ม "ขอเบิก" → อนุมัติครบ → บัญชีจ่ายเงิน แล้วใบจะมาขึ้นที่นี่ให้กรอกตารางเคลียร์',
        action: `<a class="btn btn-secondary" href="#/petty/request">${icon('plus')} ขอเบิก advance</a>` })}</div>` : ''}
      ${section('ส่งเคลียร์แล้ว รอบัญชีตรวจ', '', check)}
      ${section('เคลียร์แล้ว (ล่าสุด)', '', done)}
    </div>`;
  }

  el.innerHTML = skeleton(4);
  await load();
}
