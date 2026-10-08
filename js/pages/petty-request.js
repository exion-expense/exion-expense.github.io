// ขอเบิกเงินสดย่อย — ส่งได้หลายรายการในครั้งเดียว · คนถือกล่อง/บัญชีเบิกแทนพนักงานได้
import { api, money, esc, todayYMD, loadPettyCategories } from '../core.js?v=10.0.15';
import { icon, catIcon, toast, toastError, busy, receiptPicker, errorBox, empty, on, $, $$ } from '../ui.js?v=10.0.15';

const FUND_KEY = 'exion_petty_fund';
function fundId() { try { return localStorage.getItem(FUND_KEY) || null; } catch { return null; } }

const RULE = { YES: 'ต้องแนบใบเสร็จ', OPTIONAL: 'แนบใบเสร็จถ้ามี', NO: 'ไม่ต้องแนบใบเสร็จ' };

export async function render(ctx) {
  const { el, profile } = ctx;
  let home, cats;
  try {
    [home, cats] = await Promise.all([api.rpc('get_petty_home', { p_fund_id: fundId() }, { ttl: 30 }), loadPettyCategories()]);
  } catch (e) {
    if (!ctx.alive()) return;
    if (/ยังไม่ได้ตั้งกล่องเงินสด/.test(e.message)) { el.innerHTML = `<div class="card">${empty({ ic: 'wallet', title: 'ยังไม่เปิดใช้เงินสดย่อย', sub: e.message })}</div>`; return; }
    errorBox(el, e, () => render(ctx)); return;
  }
  const canBehalf = home.isHolder || home.isAccountant;
  const me = String(profile.email || '').toLowerCase();
  const staff = canBehalf ? await api.rpc('get_staff_list', {}, { ttl: 600 }).catch(() => []) : [];
  if (!ctx.alive()) return;

  const b = home.balance || {};
  const cap = Number(home.maxPerRequest) || 50000;
  const catOf = (code) => cats.find((c) => c.code === code);
  // กันส่งซ้ำ: ใช้ batchId เดิมถ้ากดส่งใหม่หลังเน็ตหลุด
  const batchId = 'PCB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const items = new Map();   // key → {rp, cat, uploaded}
  let seq = 0;

  el.innerHTML = `
  <div class="stack">
    <div class="card pad">
      <div class="flex between wrap">
        <div><div class="muted text-sm">${icon('wallet', 'sm')} ${esc(home.fund?.name || b.fundName || 'เงินสดย่อย')}</div>
          <div class="text-sm">คนถือกล่อง: <b>${esc(b.holderName || '-')}</b></div></div>
        <div class="text-right"><div class="muted text-sm">พร้อมจ่ายในกล่อง</div><div class="amount text-lg">${money(b.available)}</div></div>
      </div>
      <p class="hint mt-8">เบิกได้ไม่เกิน <b>${money(cap, 0)}</b> บาทต่อครั้ง (รวมทุกรายการ) · แต่ละหมวดมีเพดานต่อรายการ — ยอดสูงกว่านั้นให้ใช้ระบบเบิกค่าใช้จ่าย</p>
    </div>

    ${canBehalf ? `<div class="card pad"><div class="field"><label for="pc-who">ขอเบิกให้</label>
      <select class="input" id="pc-who" data-who>
        <option value="">ตัวเอง (${esc(profile.name || profile.email)})</option>
        ${staff.filter((s) => s.email !== me).map((s) => `<option value="${esc(s.email)}">${esc(s.name)}${s.fullName && s.fullName !== s.name ? ' — ' + esc(s.fullName) : ''}${s.department ? ' · ' + esc(s.department) : ''}</option>`).join('')}
      </select><div class="hint">คนถือกล่อง/ฝ่ายบัญชีเบิกแทนพนักงานได้ — คำขอจะไปที่หัวหน้าของพนักงานคนนั้น</div></div></div>` : ''}

    <div class="stack" data-items></div>
    <button type="button" class="add-item" data-act="add">${icon('plus')} เพิ่มรายการ</button>

    <div class="submit-bar">
      <div class="grow" style="min-width:0">
        <div class="text-sm muted" data-count></div>
        <div class="amount text-lg" data-total>0.00</div>
        <div class="err-text hidden" data-toterr></div>
      </div>
      <button type="button" class="btn btn-primary btn-lg" data-act="submit">${icon('send')} ส่งคำขอ</button>
    </div>
  </div>`;

  const box = $('[data-items]', el);

  function addItem() {
    const k = String(++seq);
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.item = k;
    card.innerHTML = `
      <div class="ic-head"><span class="ic-num"></span><b class="grow" data-title></b>
        <button type="button" class="btn-icon sm" data-act="remove" aria-label="ลบรายการนี้">${icon('trash')}</button></div>
      <div class="ic-body stack-sm">
        <div class="field"><label class="req">หมวด</label>
          <div class="cat-picker">${cats.map((c) => `<button type="button" class="cat-opt" data-cat="${esc(c.code)}">${catIcon(c.code)}<span>${esc(c.name_th)}</span>
            ${Number(c.max_amount) > 0 ? `<span class="text-xs muted">ไม่เกิน ${money(c.max_amount, 0)}</span>` : ''}</button>`).join('')}</div>
          <div class="hint" data-rule>เลือกหมวดของค่าใช้จ่าย</div><div class="err-text hidden" data-err="cat">กรุณาเลือกหมวด</div></div>
        <div class="form-grid two">
          <div class="field"><label class="req" for="d${k}">วันที่ใช้จ่าย</label>
            <input type="date" class="input" id="d${k}" data-f="date" value="${todayYMD()}" max="${todayYMD()}"><div class="err-text hidden" data-err="date">กรุณาใส่วันที่ (ไม่เกินวันนี้)</div></div>
          <div class="field"><label class="req" for="a${k}">จำนวนเงิน</label>
            <div class="input-group has-suf"><input type="number" class="input" id="a${k}" data-f="amount" inputmode="decimal" step="0.01" min="0" placeholder="0.00"><span class="suf">บาท</span></div>
            <div class="err-text hidden" data-err="amount"></div></div>
          <div class="field span-2"><label class="req" for="p${k}">วัตถุประสงค์</label>
            <input class="input" id="p${k}" data-f="purpose" maxlength="300" placeholder="เช่น ซื้อกระดาษ A4 ใช้ในแผนก"><div class="err-text hidden" data-err="purpose">กรุณาใส่วัตถุประสงค์</div></div>
          <div class="field"><label for="y${k}">ผู้รับเงิน / ร้านค้า <span class="opt">ไม่บังคับ</span></label>
            <input class="input" id="y${k}" data-f="payee" maxlength="150" placeholder="เช่น OfficeMate"></div>
          <div class="field"><label for="n${k}">หมายเหตุ <span class="opt">ไม่บังคับ</span></label>
            <input class="input" id="n${k}" data-f="note" maxlength="300"></div>
          <div class="field span-2"><label data-rlabel>ใบเสร็จ</label><div data-rp></div>
            <div class="err-text hidden" data-err="receipt">หมวดนี้ต้องแนบใบเสร็จ</div></div>
        </div>
      </div>`;
    box.appendChild(card);
    const it = { cat: '', uploaded: null, rp: null };
    it.rp = receiptPicker($('[data-rp]', card), { max: 10, onChange: () => { it.uploaded = null; $('[data-err=receipt]', card)?.classList.add('hidden'); } });
    items.set(k, it);
    renumber(); recalc();
    return card;
  }

  function renumber() {
    $$('.item-card', box).forEach((c, i) => {
      $('.ic-num', c).textContent = i + 1;
      $('[data-title]', c).textContent = 'รายการที่ ' + (i + 1);
      $('[data-act=remove]', c).classList.toggle('hidden', items.size < 2);
    });
  }

  function pickCat(card, code) {
    const it = items.get(card.dataset.item);
    it.cat = code;
    $$('.cat-opt', card).forEach((o) => o.classList.toggle('on', o.dataset.cat === code));
    const c = catOf(code);
    $('[data-rule]', card).innerHTML = c ? `${Number(c.max_amount) > 0 ? `เบิกได้ไม่เกิน <b>${money(c.max_amount, 0)}</b> บาทต่อรายการ · ` : ''}${RULE[c.need_receipt] || ''}` : '';
    const lab = $('[data-rlabel]', card);
    lab.classList.toggle('req', c?.need_receipt === 'YES');
    lab.innerHTML = c?.need_receipt === 'YES' ? 'ใบเสร็จ' : `ใบเสร็จ <span class="opt">${c?.need_receipt === 'NO' ? 'ไม่ต้องแนบ' : 'ไม่บังคับ'}</span>`;
    $('[data-err=cat]', card).classList.add('hidden');
    recalc();
  }

  const val = (card, f) => $(`[data-f=${f}]`, card).value.trim();
  const amt = (card) => Math.round((Number(val(card, 'amount')) || 0) * 100) / 100;

  // ยอดรวม + เตือนทันทีที่พิมพ์
  function recalc() {
    let total = 0;
    $$('.item-card', box).forEach((card) => {
      const a = amt(card), c = catOf(items.get(card.dataset.item).cat);
      total += a;
      const e = $('[data-err=amount]', card);
      const over = c && Number(c.max_amount) > 0 && a > Number(c.max_amount);
      e.textContent = over ? `เกินเพดานหมวดนี้ (${money(c.max_amount, 0)} บาท)` : 'กรุณาใส่จำนวนเงิน';
      e.classList.toggle('hidden', !over);
      $('[data-f=amount]', card).classList.toggle('invalid', !!over);
    });
    total = Math.round(total * 100) / 100;
    $('[data-count]', el).textContent = `รวม ${items.size} รายการ`;
    $('[data-total]', el).textContent = money(total) + ' บาท';
    const err = total > cap ? `เกินเพดานต่อครั้ง ${money(cap, 0)} บาท` : total > Number(b.available) ? `เงินในกล่องไม่พอ (พร้อมจ่าย ${money(b.available)} บาท)` : '';
    const te = $('[data-toterr]', el);
    te.textContent = err; te.classList.toggle('hidden', !err);
    return total;
  }

  function validate() {
    let first = null;
    const bad = (card, key, input) => {
      $(`[data-err=${key}]`, card).classList.remove('hidden');
      if (input) $(`[data-f=${input}]`, card).classList.add('invalid');
      first = first || card;
    };
    const total = recalc();
    $$('.err-text[data-err]', box).forEach((e) => e.classList.add('hidden'));
    $$('.input.invalid', box).forEach((e) => e.classList.remove('invalid'));
    const out = [];
    $$('.item-card', box).forEach((card) => {
      const it = items.get(card.dataset.item), c = catOf(it.cat), a = amt(card), d = val(card, 'date');
      if (!c) bad(card, 'cat');
      if (!d || d > todayYMD()) bad(card, 'date', 'date');
      if (a <= 0) { $('[data-err=amount]', card).textContent = 'กรุณาใส่จำนวนเงิน'; bad(card, 'amount', 'amount'); }
      else if (c && Number(c.max_amount) > 0 && a > Number(c.max_amount)) { $('[data-err=amount]', card).textContent = `เกินเพดานหมวดนี้ (${money(c.max_amount, 0)} บาท)`; bad(card, 'amount', 'amount'); }
      if (!val(card, 'purpose')) bad(card, 'purpose', 'purpose');
      if (c?.need_receipt === 'YES' && !it.rp.count()) bad(card, 'receipt');
      out.push({ it, card, a, d });
    });
    if (first) return { msg: 'กรุณากรอกข้อมูลให้ครบ', el: first };
    if (total > cap) return { msg: `ยอดรวมเกินเพดานต่อครั้ง ${money(cap, 0)} บาท`, el: $('.submit-bar', el) };
    if (total > Number(b.available)) return { msg: `เงินในกล่องไม่พอ (พร้อมจ่าย ${money(b.available)} บาท)`, el: $('.submit-bar', el) };
    return { ok: true, rows: out, total };
  }

  async function submit() {
    const v = validate();
    if (!v.ok) { toast(v.msg, 'bad'); v.el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const who = $('[data-who]', el)?.value || '';
    try {
      const res = await busy('กำลังเตรียมข้อมูล…', async (set) => {
        for (let i = 0; i < v.rows.length; i++) {
          const { it } = v.rows[i];
          if (!it.uploaded) it.uploaded = await it.rp.uploadAll((n, all) => set(`อัปโหลดใบเสร็จ รายการ ${i + 1} (${n}/${all})`));
        }
        set('กำลังส่งคำขอ…');
        return api.rpc('submit_petty', { p: {
          fundId: home.fund?.fundId || fundId() || '',
          requesterEmail: who,
          batchId,
          items: v.rows.map(({ it, card, a, d }) => ({ category: it.cat, expenseDate: d, amount: a, payee: val(card, 'payee'),
            purpose: val(card, 'purpose'), note: val(card, 'note'), receiptPaths: it.uploaded || [] })),
        } });
      });
      toast(res.alreadySubmitted ? 'คำขอนี้ส่งไปแล้ว' : `ส่งคำขอแล้ว ${v.rows.length} รายการ · ${money(res.total ?? v.total)} บาท`);
      ctx.refreshBadges();
      ctx.go('/petty/list');
    } catch (e) { toastError(e); }
  }

  addItem();
  const offs = [
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'add') { const c = addItem(); c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (a === 'remove') {
        const card = t.closest('.item-card');
        if (items.size < 2) return;
        items.delete(card.dataset.item); card.remove(); renumber(); recalc();
      } else if (a === 'submit') submit();
    }),
    on(el, 'click', '.cat-opt', (e, t) => pickCat(t.closest('.item-card'), t.dataset.cat)),
    on(el, 'input', '[data-f]', (e, t) => {
      t.classList.remove('invalid');
      const err = t.closest('.field')?.querySelector('.err-text');
      if (err && t.dataset.f !== 'amount') err.classList.add('hidden');
      if (t.dataset.f === 'amount') recalc();
    }),
  ];
  return () => offs.forEach((f) => f());
}
