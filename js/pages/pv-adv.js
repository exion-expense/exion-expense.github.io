// เคลียร์ advance — หน้ารวม advance ของฉัน: รอเคลียร์ (กรอกตาราง) / รอบัญชีตรวจ / ใช้เกิน รอส่งใบส่วนเกิน / เคลียร์แล้ว
// ใช้ข้อมูลจาก get_pv_list (ใบที่ฉันเบิก หรือกรอกแทน) · ปุ่มในแต่ละแถวพาไปหน้ากรอกตาราง / ใบ advance
// 0079: ปุ่ม "เคลียร์ advance" ด้านบน = เคลียร์แบบไม่มีใบ advance (จ่ายไปก่อน) → ร่าง / ใบฟ้าที่ออกจากตาราง มาจาก get_pv_clr_list
// 0082: เคลียร์ = ออกใบฟ้า (ใบเคลียร์) ทุกกรณี · ใบเคลียร์ของ advance อยู่ในรายการเดียวกัน (advId) · ใช้ไม่ถึง = ขึ้น "ต้องโอนคืนบริษัท"
import { api, money, fmtDate, esc } from '../core.js?v=10.4.30';
import { icon, empty, errorBox, skeleton, toast, toastError, confirmBox, on } from '../ui.js?v=10.4.30';
import { isTest } from './pv-common.js?v=10.4.30';

const VST = { Pending: ['b-pending', 'รออนุมัติ'], Approved: ['b-info', 'รอจ่ายเงิน'], Paid: ['b-paid', 'จ่ายแล้ว'], Returned: ['b-rejected', 'ตีกลับ'], Cancelled: ['b-neutral', 'ยกเลิก'] };

export async function render(ctx) {
  const { el, profile } = ctx;
  const st = { open: [], check: [], over: [], done: [], fin: 0, clr: null };   // clr: null = ฐานข้อมูลยังไม่มี 0079 → ไม่แสดงปุ่ม / ส่วนของแบบไม่มีใบ advance
  const list = (stage, limit = 100) => api.rpc('get_pv_list', { p_scope: 'mine', p_q: '', p_stage: stage, p_limit: limit });

  async function load() {
    try {
      const role = profile.role || {};
      const [open, check, paid, todo, clr] = await Promise.all([list('adv_open'), list('adv_check'), list('paid', 300),
        role.isAccountant || role.isGM ? api.rpc('get_pv_list', { p_scope: 'todo', p_q: '', p_stage: 'adv_check', p_limit: 100 }).catch(() => []) : [],
        api.rpc('get_pv_clr_list', {}, { quiet: true }).catch(() => null)]);
      if (!ctx.alive()) return;
      st.open = open || []; st.check = check || []; st.fin = (todo || []).length; st.clr = clr;
      // advance ที่มีใบเคลียร์ (0082) → ติดตามที่ใบเคลียร์ ไม่ขึ้นซ้ำในรายการของใบ advance
      const viaClr = new Set((clr?.vouchers || []).filter((x) => x.advId && x.status !== 'Cancelled').map((x) => x.advId));
      st.open = st.open.filter((x) => !(x.advClear === 'Returned' && viaClr.has(x.id)));
      const cleared = (paid || []).filter((x) => x.kind === 'ADV' && x.advClear === 'Cleared' && !viaClr.has(x.id));
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
  const item = (title, sub, amount, badge, btn) => `<div class="card pad adv-item">
      <div class="row-main">${title}${[].concat(sub).filter(Boolean).map((s) => `<div class="row-sub">${s}</div>`).join('')}</div>
      <div class="adv-end"><span class="amount">${money(amount)}</span>${badge}</div>
      <div class="adv-btn">${btn}</div></div>`;
  const card = (x, sub, badge, btn) => item(head(x), `${who(x)} · ${sub}`, x.amount, badge, btn);
  const section = (title, hint, items) => items.length ? `<div class="stack-sm"><div><b>${title}</b> <span class="badge b-neutral plain">${items.length}</span>${hint ? `<div class="hint">${hint}</div>` : ''}</div>${items.join('')}</div>` : '';

  function paint() {
    const view = (x) => `#/pv/view?id=${encodeURIComponent(x.id)}`;
    const open = st.open.map((x) => card(x,
      x.advClear === 'Returned' ? 'ถูกตีกลับ ให้แก้ตารางแล้วส่งใหม่' : `รับเงิน ${x.paidAt ? fmtDate(x.paidAt) : '-'} · เคลียร์ภายใน ${x.advDue ? fmtDate(x.advDue) : '-'}`,
      x.advClear === 'Returned' ? '<span class="badge b-rejected">ตีกลับ</span>' : x.advOverdue ? '<span class="badge b-rejected">เลยกำหนดเคลียร์</span>' : '<span class="badge b-pending">รอเคลียร์</span>',
      `<a class="btn btn-primary btn-sm" href="#/pv/clear?id=${encodeURIComponent(x.id)}">${icon('edit', 'sm')} กรอกตารางเคลียร์</a><a class="btn btn-secondary btn-sm" href="${view(x)}">ดูใบ</a>`));
    const over = st.over.map((x) => card(x, `ใช้จริง ${money(x.advActual)} · บัญชีตรวจเคลียร์แล้ว`,
      `<span class="badge b-pending">ใช้เกิน ${money(x.adv.extraDue)}</span>`,
      `<a class="btn btn-primary btn-sm" href="${view(x)}">${icon('send', 'sm')} เบิกส่วนเกิน ${money(x.adv.extraDue)} บาท</a>`));
    const check = st.check.map((x) => card(x, `ใช้จริง ${money(x.advActual)} · ส่งเคลียร์แล้ว`,
      '<span class="badge b-info">รอบัญชีตรวจ</span>', `<a class="btn btn-secondary btn-sm" href="${view(x)}">ดูตาราง / Excel</a>`));
    const done = st.done.map((x) => card(x, `ใช้จริง ${money(x.advActual)}`,
      '<span class="badge b-paid">เคลียร์แล้ว</span>', `<a class="btn btn-secondary btn-sm" href="${view(x)}">ดูตาราง / Excel</a>`));

    // ไม่มีใบ advance (จ่ายไปก่อน): ร่างที่ยังไม่ส่ง · ใบฟ้าที่ถูกตีกลับ · ใบฟ้าที่ส่งไปแล้ว
    const c = st.clr || { drafts: [], vouchers: [] };
    const tripOf = (x) => x.trip ? esc(x.trip) : '<span class="muted">ยังไม่ได้ใส่ชื่อ Trip</span>';
    const drafts = (c.drafts || []).map((x) => item(`<div class="row-title">${tripOf(x)}</div>`,
      `${x.requesterName ? 'เบิกให้ ' + esc(x.requesterName) + ' · ' : ''}${x.rows} รายการ · แนบไฟล์ ${x.files} · บันทึกล่าสุด ${x.updatedAt ? fmtDate(x.updatedAt) : '-'}`,
      x.total, '<span class="badge b-neutral">ร่าง ยังไม่ส่ง</span>',
      `<a class="btn btn-primary btn-sm" href="#/pv/clear?id=${encodeURIComponent(x.id)}">${icon('edit', 'sm')} กรอกต่อ</a><button type="button" class="btn btn-ghost btn-sm" data-deldraft="${esc(x.id)}">${icon('trash', 'sm')} ลบร่าง</button>`));
    // ใบเคลียร์ (ใบฟ้าที่ออกจากตาราง): ยอดที่แสดง = ใช้จริง · มีใบ advance → บอกผลหักลบ (จ่ายเพิ่ม / โอนคืน / ยอดตรง)
    const owe = (x) => x.advId && Number(x.returnDue) > 0 && !x.returnDone && ['Pending', 'Approved'].includes(x.status);   // ยังมีเงินต้องโอนคืน
    const netBadge = (x) => { if (!x.advId) return '';
      const back = Number(x.returnDue) || 0, more = Math.round((Number(x.actual) - Number(x.advAmount)) * 100) / 100;
      return back > 0 ? `<span class="badge ${x.returnDone ? 'b-paid' : 'b-pending'} plain">โอนคืน ${money(back)}${x.returnDone ? ' · รับคืนแล้ว' : x.returnReported ? ' · แจ้งแล้ว' : ''}</span>`
        : more > 0 ? `<span class="badge b-info plain">จ่ายเพิ่ม ${money(more)}</span>` : '<span class="badge b-neutral plain">ยอดตรงกับ advance</span>'; };
    const vcard = (x) => { const [cls, label] = VST[x.status] || ['b-neutral', x.status]; const zero = x.advId && Number(x.amount) === 0;
      return item(`<div class="row-title"><span class="mono">${esc(x.id)}</span> · ${tripOf(x)}</div>`,
      [`${who(x)} · ${x.rows} รายการ`, x.advId ? `advance ${esc(x.advId)} · ${money(x.advAmount)}` : 'ไม่มีใบ advance', x.status === 'Returned' && x.remark ? `“${esc(x.remark)}”` : ''],
      x.actual ?? x.amount, `<span class="badge ${cls}">${zero && x.status === 'Approved' ? 'รอบัญชีปิดใบ' : zero && x.status === 'Paid' ? 'เรียบร้อย' : label}</span>${netBadge(x)}`,
      x.status === 'Returned' ? `<a class="btn btn-primary btn-sm" href="#/pv/clear?id=${encodeURIComponent(x.id)}">${icon('edit', 'sm')} แก้ตารางแล้วส่งใหม่</a><a class="btn btn-secondary btn-sm" href="${view(x)}">ดูใบ</a>`
        : owe(x) && !x.returnReported ? `<a class="btn btn-primary btn-sm" href="${view(x)}">${icon('send', 'sm')} โอนคืน ${money(x.returnDue)} บาท · แจ้ง / แนบสลิป</a>`
        : `<a class="btn btn-secondary btn-sm" href="${view(x)}">ดูใบ / ตาราง / Excel</a>`); };
    const vs = (c.vouchers || []).filter((x) => x.status !== 'Cancelled');
    const back = vs.filter((x) => x.status === 'Returned').map(vcard);
    const ret = vs.filter((x) => owe(x) && !x.returnReported).map(vcard);
    const sent = vs.filter((x) => x.status !== 'Returned' && !(owe(x) && !x.returnReported)).slice(0, 8).map(vcard);

    const todo = open.length + over.length + drafts.length + back.length + ret.length;
    el.innerHTML = `<div class="stack">
      ${st.clr ? `<div class="card pad flex between wrap gap-12" style="align-items:center">
        <div class="grow" style="min-width:200px"><b>จ่ายไปก่อน ไม่ได้ขอ advance ไว้?</b><div class="text-sm muted">กรอกตารางเคลียร์ได้เลย · ส่งแล้วระบบออกใบฟ้าให้ตามยอดรวม</div></div>
        <a class="btn btn-primary" href="#/pv/clear?new=1">${icon('plus')} เคลียร์ advance</a></div>` : ''}
      ${st.fin ? `<a class="card row" href="#/pv?scope=todo&stage=adv_check"><span class="row-icon c-red">${icon('check-circle')}</span><div class="row-main"><div class="row-title">รอคุณตรวจเคลียร์ <span class="badge b-pending plain">${st.fin}</span></div>
        <div class="row-sub">advance ที่พนักงานส่งเคลียร์มา (ฝ่ายบัญชี)</div></div>${icon('chevron-right')}</a>` : ''}
      ${section('ถูกตีกลับ ให้แก้ตารางแล้วส่งใหม่', 'ใบฟ้าที่ออกจากตารางเคลียร์', back)}
      ${section('ต้องโอนคืนบริษัท', 'ใช้ไม่ถึงยอด advance · โอนเงินที่เหลือคืนบริษัท แล้วกดแจ้ง (แนบสลิปได้) ในใบ', ret)}
      ${section('ต้องกรอกตารางเคลียร์', 'advance ที่รับเงินแล้ว · กรอกรายการที่ใช้จริง กดส่งแล้วระบบออกใบฟ้าตามยอดใช้จริง และหักลบกับ advance ให้ (บันทึกร่างไว้กรอกต่อได้)', open)}
      ${section('ร่างที่ยังไม่ส่ง', 'เคลียร์แบบไม่มีใบ advance ที่บันทึกร่างไว้ · เห็นเฉพาะคุณ', drafts)}
      ${section('ใช้เกิน รอส่งใบเบิกส่วนเกิน', 'บัญชีตรวจเคลียร์แล้ว · กดปุ่มเพื่อเปิดใบแล้วส่งใบฟ้าส่วนที่เกิน (ไม่ใช่ advance)', over)}
      ${!todo ? `<div class="card">${empty({ ic: 'check-circle', title: 'ไม่มี advance ที่ต้องเคลียร์',
        sub: 'ขอ advance ที่ปุ่ม "ขอเบิก" → อนุมัติครบ → บัญชีจ่ายเงิน แล้วใบจะมาขึ้นที่นี่ให้กรอกตารางเคลียร์',
        action: `<a class="btn btn-secondary" href="#/petty/request">${icon('plus')} ขอเบิก advance</a>` })}</div>` : ''}
      ${section('ส่งเคลียร์แล้ว รอบัญชีตรวจ', '', check)}
      ${section('ใบเคลียร์ที่ส่งแล้ว (ล่าสุด)', 'ใบฟ้าที่ออกจากตารางเคลียร์ · ติดตามสถานะได้ที่ใบ', sent)}
      ${section('เคลียร์แล้ว (ล่าสุด)', '', done)}
    </div>`;
  }

  el.innerHTML = skeleton(4);
  await load();
  const off = on(el, 'click', '[data-deldraft]', async (e, t) => {
    if (!(await confirmBox({ title: 'ลบร่างนี้', message: 'ลบแล้วเอากลับมาไม่ได้ (ตารางและไฟล์ที่แนบไว้ในร่างนี้)', ok: 'ลบร่าง', danger: true }))) return;
    try {
      await api.rpc('pv_clr_delete', { p_id: t.dataset.deldraft });
      try { localStorage.removeItem('exion_advclr_' + t.dataset.deldraft); } catch {}
      toast('ลบร่างแล้ว'); await load();
    } catch (err) { toastError(err); }
  });
  return () => off();
}
