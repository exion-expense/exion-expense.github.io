// ขออนุมัติงบล่วงหน้า (ค่ารับรอง / กอล์ฟ) — ส่งก่อนใช้จ่าย แล้วค่อยส่งบิลจริงทีหลัง
import { api, money, esc, catName, todayYMD, addDays, loadCategories } from '../core.js';
import { icon, catIcon, toast, toastError, withBtn, on, $, $$ } from '../ui.js';
import { VISIT, loadVisitRules } from './submit.js';

const CUST_TYPES = [['Customer', 'ลูกค้า'], ['Principle', 'Principle'], ['Other Customer', 'ลูกค้าอื่น'], ['Other Principle', 'Principle อื่น']];
const ENT_CATS = ['ENT', 'GOLF'];

export async function render(ctx) {
  const { el, profile } = ctx;
  const [allCats] = await Promise.all([loadCategories(), loadVisitRules()]);
  const cats = (allCats || []).filter((c) => ENT_CATS.includes(c.code) && c.active !== false);
  const need = VISIT.required;
  if (!ctx.alive()) return;
  const F = { category: cats.length === 1 ? cats[0].code : '', custType: '' };

  const err = (k) => `<div class="err-text hidden" data-err="${k}"></div>`;
  el.innerHTML = `<div style="max-width:760px;margin:0 auto">
    <div class="page-head"><div><h1>ขออนุมัติงบล่วงหน้า</h1>
      <div class="sub">ขอก่อนใช้จ่าย${profile?.managerFullName ? ` · ส่งถึง ${esc(profile.managerFullName)}` : ''}</div></div></div>
    <div class="stack">
      <div class="card"><div class="card-head"><h3>${icon('calendar')} นัดหมาย</h3></div>
        <div class="pad stack-sm">
          <div class="field"><label class="req">ประเภท</label>
            <div class="cat-picker">${cats.map((c) => `<button type="button" class="cat-opt ${F.category === c.code ? 'on' : ''}" data-act="cat" data-code="${esc(c.code)}" aria-pressed="${F.category === c.code}">
              ${catIcon(c.code)}<span>${esc(c.name_th || catName(c.code))}</span></button>`).join('')}</div>${err('category')}</div>
          <div class="form-grid two">
            <div class="field"><label class="req">วันที่นัด / วางแผน</label><input class="input" type="date" data-f="expenseDate" value="${addDays(todayYMD(), 1)}">${err('expenseDate')}</div>
            <div class="field"><label class="req">สถานที่</label><input class="input" data-f="venue" placeholder="ชื่อร้าน / สนามกอล์ฟ" maxlength="300">${err('venue')}</div>
          </div>
        </div></div>

      <div class="card"><div class="card-head"><h3>${icon('users')} ฝ่ายที่รับรอง</h3></div>
        <div class="pad stack-sm">
          <div class="field"><label class="req">ประเภทลูกค้า</label>
            <div class="seg" role="group" aria-label="ประเภทลูกค้า">${CUST_TYPES.map(([v, l]) => `<button type="button" data-act="ctype" data-v="${esc(v)}" aria-pressed="false">${esc(l)}</button>`).join('')}</div>${err('custType')}</div>
          <div class="form-grid two">
            <div class="field"><label class="req">ชื่อลูกค้า / Principle</label><input class="input" data-f="customer" list="preCustList" placeholder="ชื่อบริษัท" autocomplete="off" maxlength="200">${err('customer')}</div>
            <div class="field"><label>Contact name <span class="opt">ไม่บังคับ</span></label><input class="input" data-f="customerContact" placeholder="ชื่อ / ตำแหน่ง" maxlength="200"></div>
            <div class="field span-2"><label class="req">Purpose of entertainment (โอกาส / วัตถุประสงค์)</label><textarea class="input" data-f="occasion" placeholder="เช่น เลี้ยงขอบคุณทีมจัดซื้อ SCG หลังปิดงาน เพื่อเพิ่มโอกาส Bidding โครงการปีหน้า" maxlength="500"></textarea>
              <div class="hint">อธิบายให้ละเอียด${need ? ` อย่างน้อย ${VISIT.minLen} ตัวอักษร` : ''} — พบใคร เพื่ออะไร คาดหวังอะไร (เช่น เพิ่มโอกาสขาย / Bidding งาน)</div>${err('occasion')}</div>
            <div class="field span-2"><label ${need ? 'class="req"' : ''}>ผู้ร่วม (คาดการณ์)${need ? '' : ' <span class="opt">ไม่บังคับ</span>'}</label><textarea class="input" data-f="attendees" placeholder="ชื่อ + บริษัท เช่น คุณสมชาย (SCG), คุณเอ (EXION)" maxlength="500"></textarea>${err('attendees')}</div>
            <div class="field"><label>เลข Job <span class="opt">ไม่บังคับ</span></label><input class="input" data-f="jobNo" placeholder="เช่น J2026-0142" maxlength="60"></div>
          </div>
        </div></div>

      <div class="card"><div class="card-head"><h3>${icon('wallet')} งบประมาณ</h3></div>
        <div class="pad stack-sm">
          <div class="field"><label class="req">งบที่ขอ</label>
            <div class="input-group has-pre has-suf"><span class="pre">฿</span><input class="input big" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" data-f="budget"><span class="suf">บาท</span></div>${err('budget')}</div>
          <div class="alert warn">${icon('alert')}<span>หลังใช้จ่ายต้อง <b>ส่งบิลจริง</b> พร้อมใบเสร็จ และหัวหน้าต้องอนุมัติอีกครั้ง — ถ้ายอดจริงเกินงบ หัวหน้าจะเห็นว่าเกิน</span></div>
        </div></div>
    </div>
    <div class="submit-bar">
      <div class="grow"><div class="text-sm muted">งบที่ขอ</div><div class="amount text-lg" data-total>฿0.00</div></div>
      <button type="button" class="btn btn-primary btn-lg" data-act="submit">${icon('send')} ส่งขออนุมัติ</button>
    </div>
    <datalist id="preCustList"></datalist>
  </div>`;

  // รายชื่อลูกค้า: ยังไม่เลือกประเภท = แสดงทั้งหมด (มี [ประเภท] นำหน้า) · เลือกแล้ว = เฉพาะประเภทนั้น ไม่มีคำนำหน้า
  let allCust = [];
  function fillCust() {
    const dl = $('#preCustList', el); if (!dl) return;
    const want = (F.custType || '').toLowerCase();
    const opts = !want ? allCust : [...new Set(allCust.map((c) => /^\[([^\]]+)\]\s*(.*)$/.exec(c))
      .filter((m) => m && m[1].trim().toLowerCase() === want && m[2].trim()).map((m) => m[2].trim()))].sort((x, y) => x.localeCompare(y));
    dl.innerHTML = opts.map((c) => `<option value="${esc(c)}"></option>`).join('');
  }
  api.rpc('get_customers', {}, { ttl: 600 }).then((list) => {
    if (!ctx.alive()) return;
    allCust = list || []; fillCust();
  }).catch(() => {});

  const val = (k) => String($(`[data-f="${k}"]`, el)?.value || '').trim();
  function setType(v) {
    F.custType = v;
    $$('[data-act="ctype"]', el).forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
    showErr('custType', '');
    fillCust();
  }
  function showErr(k, m) {
    const x = $(`[data-err="${k}"]`, el); if (x) { x.textContent = m; x.classList.toggle('hidden', !m); }
    $(`[data-f="${k}"]`, el)?.classList.toggle('invalid', !!m);
  }

  async function submit(btn) {
    const budget = Number(val('budget')) || 0;
    const d = val('expenseDate');
    const errs = {
      category: !F.category && 'เลือกประเภท',
      expenseDate: !/^\d{4}-\d{2}-\d{2}$/.test(d) ? 'ใส่วันที่' : d < '2020-01-01' && 'วันที่ไม่ถูกต้อง',
      venue: !val('venue') && 'ใส่สถานที่',
      custType: !F.custType && 'เลือกประเภทลูกค้า',
      customer: !val('customer') && 'ใส่ชื่อลูกค้า / Principle',
      occasion: !val('occasion') ? 'ใส่ Purpose of entertainment — เลี้ยง/พบใคร เพื่ออะไร'
        : need && val('occasion').length < VISIT.minLen && `อธิบายให้ละเอียดกว่านี้ (อย่างน้อย ${VISIT.minLen} ตัวอักษร) — พบใคร เพื่ออะไร`,
      attendees: need && !val('attendees') && 'ใส่ผู้ร่วม (คาดการณ์) — ชื่อ + บริษัท',
      budget: budget <= 0 ? 'ใส่งบประมาณ' : budget > 500000 && 'งบประมาณเกิน 500,000 บาท',
    };
    Object.entries(errs).forEach(([k, m]) => showErr(k, m || ''));
    const first = Object.keys(errs).find((k) => errs[k]);
    if (first) {
      $(`[data-err="${first}"]`, el)?.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('กรอกข้อมูลไม่ครบ — ดูช่องสีแดง', 'bad');
      return;
    }
    // ชื่อลูกค้าที่เลือกจากรายการอาจมี [ประเภท] นำหน้าอยู่แล้ว → ตัดออกก่อน
    const name = val('customer').replace(/^\[[^\]]*\]\s*/, '');
    try {
      await withBtn(btn, () => api.rpc('submit_preapprove', { p: {
        category: F.category, expenseDate: d, budget, venue: val('venue'), customer: `[${F.custType}] ${name}`,
        customerContact: val('customerContact'), occasion: val('occasion'), attendees: val('attendees'), jobNo: val('jobNo'),
      } }));
      toast(`ส่งขออนุมัติงบแล้ว${profile?.managerFullName ? ` — รอ ${profile.managerFullName} พิจารณา` : ''}`);
      ctx.refreshBadges?.();
      ctx.go('/preapprovals');
    } catch (e) { toastError(e); }
  }

  const offs = [
    on(el, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'cat') {
        F.category = t.dataset.code;
        $$('[data-act="cat"]', el).forEach((b) => { b.classList.toggle('on', b === t); b.setAttribute('aria-pressed', String(b === t)); });
        showErr('category', '');
      } else if (a === 'ctype') setType(t.dataset.v);
      else if (a === 'submit') submit(t);
    }),
    on(el, 'input', '[data-f]', (e, t) => {
      showErr(t.dataset.f, '');
      if (t.dataset.f === 'budget') $('[data-total]', el).textContent = '฿' + money(Number(t.value) || 0);
      if (t.dataset.f === 'customer') {
        // เลือก "[Customer] SCG" จากรายการ → ตั้งประเภทให้อัตโนมัติ
        const m = /^\[([^\]]+)\]\s*(.*)$/.exec(t.value);
        if (m && CUST_TYPES.some(([v]) => v === m[1])) { setType(m[1]); t.value = m[2]; }
      }
    }),
  ];
  return () => offs.forEach((f) => f());
}
