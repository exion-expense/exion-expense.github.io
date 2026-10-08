// ส่งบิลจริงของงบที่อนุมัติแล้ว — แยกได้หลายบิล แต่ละบิลต้องแนบใบเสร็จ · เทียบยอดกับงบแบบสด
import { api, money, esc, fmtDate, fmtDateTime, catName, todayYMD, addDays } from '../core.js?v=10.0.15';
import { icon, catIcon, toast, toastError, confirmBox, busy, empty, receiptPicker, on, $, $$ } from '../ui.js?v=10.0.15';

function custHtml(c) {
  const m = /^\[(.+?)\]\s*(.*)$/.exec(String(c || ''));
  return m ? `<span class="badge b-neutral plain">${esc(m[1])}</span> ${esc(m[2])}` : esc(c);
}

export async function render(ctx) {
  const { el, params } = ctx;
  const now = new Date();
  let pre, names = {}, settled = null;
  try {
    [pre] = await Promise.all([
      api.rpc('get_request', { p_id: params.id }),
      api.rpc('get_staff_list', {}, { ttl: 3600 }).then((l) => { names = Object.fromEntries((l || []).map((s) => [String(s.email).toLowerCase(), s.fullName || s.name])); }).catch(() => {}),
      api.rpc('get_period_info', { p_year: now.getFullYear(), p_month: now.getMonth() + 1 }, { ttl: 300 }).then((p) => { settled = p?.lastSettled || null; }).catch(() => {}),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="card">${empty({ ic: 'alert', title: 'เปิดงบนี้ไม่ได้', sub: e.message, action: `<a class="btn btn-secondary" href="#/preapprovals">${icon('arrow-left')} กลับไปหน้างบ</a>` })}</div>`;
    return;
  }
  if (!ctx.alive()) return;

  // ตรวจว่าส่งบิลได้ไหม (กติกาเดียวกับ finalize_claim)
  const done = pre.status !== 'PreApprove' || String(pre.batch_id || '').startsWith('FINALIZE-');
  const block = pre.preapprove_status !== 'Approved'
    ? (pre.preapprove_status === 'Rejected' ? ['x-circle', 'งบนี้ไม่ได้รับอนุมัติ', 'ขออนุมัติใหม่ได้ที่หน้าขออนุมัติงบ'] : ['clock', 'งบนี้ยังรออนุมัติ', 'ส่งบิลจริงได้หลังหัวหน้าอนุมัติงบ'])
    : done ? ['check-circle', 'ส่งบิลของงบนี้ไปแล้ว', 'ดูสถานะบิลได้ที่หน้าคำขอของฉัน'] : null;
  if (block) {
    el.innerHTML = `<div class="card">${empty({ ic: block[0], title: block[1], sub: block[2], action: done && pre.preapprove_status === 'Approved'
      ? `<a class="btn btn-primary" href="#/requests?id=${encodeURIComponent(pre.id)}">${icon('eye')} ดูบิลจริง</a>`
      : `<a class="btn btn-secondary" href="#/preapprovals">${icon('arrow-left')} กลับไปหน้างบ</a>` })}</div>`;
    return;
  }

  const budget = Number(pre.preapprove_budget) || 0;
  const S = { bills: [], seq: 0, sending: false };
  const who = (e) => names[String(e || '').toLowerCase()] || String(e || '').split('@')[0];

  el.innerHTML = `<div style="max-width:760px;margin:0 auto">
    <div class="page-head"><div><h1>ส่งบิลจริง</h1><div class="sub">ใส่ยอดที่ใช้จริงพร้อมแนบใบเสร็จ · แยกได้หลายบิล</div></div></div>
    <div class="stack">
      <div class="card"><div class="pad stack-sm">
        <div class="flex gap-12">${catIcon(pre.category)}<div class="grow"><div class="bold">ขออนุมัติงบ · ${esc(catName(pre.category))}</div>
          <div class="text-sm muted">${fmtDate(pre.expense_date, { full: true })}</div></div><span class="badge b-approved">อนุมัติงบแล้ว</span></div>
        <div class="callout-amount"><span class="v">${money(budget)}</span><span class="muted">บาท (งบที่อนุมัติ)</span></div>
        <dl class="kv tight">
          ${pre.venue ? `<dt>สถานที่</dt><dd>${esc(pre.venue)}</dd>` : ''}
          ${pre.customer ? `<dt>ลูกค้า</dt><dd>${custHtml(pre.customer)}</dd>` : ''}
          ${pre.occasion ? `<dt>Purpose of entertainment</dt><dd>${esc(pre.occasion)}</dd>` : ''}
          ${pre.attendees ? `<dt>ผู้ร่วม</dt><dd>${esc(pre.attendees)}</dd>` : ''}
          ${pre.preapprove_by ? `<dt>อนุมัติโดย</dt><dd>${esc(who(pre.preapprove_by))}${pre.preapprove_at ? ` · ${fmtDateTime(pre.preapprove_at)}` : ''}</dd>` : ''}
        </dl>
        <div data-meter></div>
      </div></div>
      <div class="alert">${icon('info')}<span>หลังส่ง หัวหน้าต้องอนุมัติบิลจริงอีกครั้งเสมอ แม้ยอดไม่เกินงบ</span></div>
      <div class="stack" data-bills></div>
      <button type="button" class="add-item" data-act="add">${icon('plus')} เพิ่มบิล</button>
    </div>
    <div class="submit-bar">
      <div class="grow"><div class="text-sm muted" data-count></div><div class="amount text-lg" data-total></div></div>
      <button type="button" class="btn btn-primary btn-lg" data-act="submit">${icon('send')} ส่งบิล</button>
    </div>
  </div>`;
  const box = $('[data-bills]', el);
  const cardOf = (b) => box.querySelector(`[data-key="${b.key}"]`);
  const billOf = (node) => S.bills.find((x) => x.key === node.closest('[data-key]')?.dataset.key);

  const ENT = String(pre.category || '').toUpperCase() === 'ENT';   // ค่ารับรอง: คำอธิบายบังคับ
  function addBill() {
    const b = { key: 'b' + ++S.seq, date: pre.expense_date && pre.expense_date <= todayYMD() ? pre.expense_date : todayYMD(), amount: '', description: '', paths: null, n: 0 };
    const d = document.createElement('div');
    d.className = 'item-card'; d.dataset.key = b.key;
    d.innerHTML = `<div class="ic-head"><span class="ic-num"></span><div class="grow bold" data-title></div><span class="amount" data-amt></span>
        <button type="button" class="btn-icon" data-act="remove" aria-label="ลบบิลนี้" title="ลบบิลนี้">${icon('trash')}</button></div>
      <div class="ic-body"><div class="form-grid two">
        <div class="field"><label class="req">วันที่ในบิล</label><input class="input" type="date" data-f="date" value="${esc(b.date)}" max="${todayYMD()}">
          <div class="hint hidden" data-warn></div><div class="err-text hidden" data-err="date"></div></div>
        <div class="field"><label class="req">จำนวนเงิน</label><div class="input-group has-pre has-suf"><span class="pre">฿</span>
          <input class="input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" data-f="amount"><span class="suf">บาท</span></div><div class="err-text hidden" data-err="amount"></div></div>
        <div class="field span-2">${ENT ? '<label class="req">คำอธิบาย <span class="opt">ทานกับใคร เพื่ออะไร</span></label>' : '<label>รายละเอียด <span class="opt">ไม่บังคับ</span></label>'}
          <input class="input" data-f="description" maxlength="300"
          placeholder="${ENT ? 'เช่น เลี้ยงคุณสมชาย + ทีมจัดซื้อ SCG 3 ท่าน หลังปิดงานติดตั้ง' : S.bills.length ? 'เช่น ค่าเครื่องดื่ม' : esc(pre.occasion || 'เช่น อาหารมื้อค่ำ')}">
          <div class="err-text hidden" data-err="description"></div></div>
        <div class="field span-2"><label class="req">ใบเสร็จ</label><div data-rslot></div><div class="err-text hidden" data-err="receipts"></div></div>
      </div></div>`;
    box.appendChild(d);
    b.rp = receiptPicker($('[data-rslot]', d), { max: 10, onChange: (n) => { b.paths = null; b.n = n; if (n) setErr(b, 'receipts', ''); } });
    S.bills.push(b);
    dateWarn(b); refresh();
    return b;
  }
  function setErr(b, k, m) {
    const card = cardOf(b); if (!card) return;
    const x = $(`[data-err="${k}"]`, card); if (x) { x.textContent = m; x.classList.toggle('hidden', !m); }
    $(`[data-f="${k}"]`, card)?.classList.toggle('invalid', !!m);
  }
  // วันที่อยู่ในรอบที่ส่งบัญชีแล้ว → เตือน (ไม่บล็อก)
  function dateWarn(b) {
    const w = $('[data-warn]', cardOf(b)); if (!w) return;
    const bad = settled && b.date && b.date <= settled;
    w.textContent = bad ? `วันที่นี้อยู่ในรอบที่ส่งบัญชีแล้ว (ปิดถึง ${fmtDate(settled)}) — บิลนี้จะไม่อยู่ในรอบเบิกถัดไป ตรวจวันที่อีกครั้ง` : '';
    w.classList.toggle('hidden', !bad);
    w.classList.toggle('warn-text', !!bad);
  }

  function refresh() {
    const many = S.bills.length > 1;
    S.bills.forEach((b, i) => {
      const card = cardOf(b);
      $('.ic-num', card).textContent = i + 1;
      $('[data-title]', card).textContent = `บิลที่ ${i + 1}`;
      $('[data-amt]', card).textContent = Number(b.amount) > 0 ? '฿' + money(b.amount) : '';
      $('[data-act="remove"]', card).classList.toggle('hidden', !many);
    });
    const total = S.bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const diff = total - budget;
    const pct = budget ? Math.min(100, (total / budget) * 100) : 0;
    $('[data-meter]', el).innerHTML = `<div class="flex between text-sm"><span>ใช้จริง <b class="amount">฿${money(total)}</b></span>
        <span class="${diff > 0 ? 'bad-text bold' : 'muted'}">${diff > 0 ? `เกินงบ ฿${money(diff)}` : `เหลืองบ ฿${money(-diff)}`}</span></div>
      <div class="meter mt-8 ${diff > 0 ? 'bad' : pct > 90 ? 'warn' : ''}"><i style="width:${diff > 0 ? 100 : pct}%"></i></div>
      ${diff > 0 ? `<div class="alert warn mt-8">${icon('alert')}<span>ยอดจริงเกินงบ ฿${money(diff)} — ส่งได้ แต่หัวหน้าจะเห็นว่าเกินงบตอนอนุมัติ</span></div>` : ''}`;
    $('[data-count]', el).textContent = `${S.bills.length} บิล · งบ ฿${money(budget, 0)}`;
    const tt = $('[data-total]', el);
    tt.textContent = '฿' + money(total);
    tt.classList.toggle('bad-text', diff > 0);
  }

  async function submit(btn) {
    if (S.sending) return;
    S.bills.forEach((b) => $$('[data-f]', cardOf(b)).forEach((x) => { b[x.dataset.f] = x.value; }));
    let first = null;
    S.bills.forEach((b) => {
      const a = Number(b.amount) || 0;
      const e = {
        date: !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ? 'ใส่วันที่' : b.date > addDays(todayYMD(), 1) ? 'วันที่อยู่ในอนาคต' : '',
        amount: a <= 0 ? 'ใส่จำนวนเงิน' : a > 500000 ? 'จำนวนเงินเกิน 500,000 บาท' : '',
        receipts: !b.rp.count() ? 'แนบใบเสร็จอย่างน้อย 1 ไฟล์' : '',
        description: ENT && String(b.description || '').trim().length < 5 ? 'ค่ารับรองต้องใส่คำอธิบาย ทานกับใคร เพื่ออะไร' : '',
      };
      Object.entries(e).forEach(([k, m]) => setErr(b, k, m));
      if (!first && (e.date || e.amount || e.receipts || e.description)) first = cardOf(b);
    });
    if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('กรอกข้อมูลบิลไม่ครบ — ดูช่องสีแดง', 'bad'); return; }
    const total = S.bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    if (total > budget && !(await confirmBox({ title: 'ยอดจริงเกินงบ', ok: 'ส่งเลย', cancel: 'กลับไปแก้',
      message: `ยอดจริง ฿${money(total)} เกินงบ ฿${money(budget)} อยู่ ฿${money(total - budget)}\nหัวหน้าจะเห็นว่าเกินงบตอนอนุมัติ — ยืนยันส่ง?` }))) return;
    S.sending = true; btn.disabled = true;
    try {
      const res = await busy('กำลังเตรียม…', async (set) => {
        for (let i = 0; i < S.bills.length; i++) {
          const b = S.bills[i];
          if (!b.paths) b.paths = await b.rp.uploadAll((k, n) => set(`อัปโหลดใบเสร็จ บิลที่ ${i + 1} (${k}/${n})`));
        }
        set('กำลังส่งบิล…');
        return api.rpc('finalize_claim', { p: { preApproveId: pre.id, items: S.bills.map((b) => ({
          date: b.date, amount: Number(b.amount) || 0, description: String(b.description || '').trim(), receiptPaths: b.paths })) } });
      });
      toast(`ส่งบิลจริงแล้ว ${res?.itemsCreated || S.bills.length} บิล · รวม ฿${money(res?.totalAmount ?? total)} — รอหัวหน้าอนุมัติ`);
      ctx.refreshBadges?.();
      ctx.go('/requests');
    } catch (e) { toastError(e); }
    finally { S.sending = false; btn.disabled = false; }
  }

  addBill();
  const offs = [
    on(el, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'add') { const b = addBill(); setTimeout(() => cardOf(b)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); }
      else if (a === 'remove') {
        const b = billOf(t); if (!b || S.bills.length < 2) return;
        if ((Number(b.amount) > 0 || b.n) && !(await confirmBox({ title: 'ลบบิลนี้?', message: `บิล ฿${money(b.amount)}${b.n ? ` · ใบเสร็จ ${b.n} ไฟล์` : ''}`, ok: 'ลบ', danger: true }))) return;
        S.bills.splice(S.bills.indexOf(b), 1); cardOf(b)?.remove(); refresh();
      } else if (a === 'submit') submit(t);
    }),
    on(el, 'input', '[data-f]', (e, t) => {
      const b = billOf(t); if (!b) return;
      b[t.dataset.f] = t.value; setErr(b, t.dataset.f, '');
      if (t.dataset.f === 'amount') refresh();
      if (t.dataset.f === 'date') dateWarn(b);
    }),
    on(el, 'change', '[data-f="date"]', (e, t) => { const b = billOf(t); if (b) { b.date = t.value; dateWarn(b); } }),
  ];
  return () => offs.forEach((f) => f());
}
