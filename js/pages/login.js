// หน้าเข้าสู่ระบบ: อีเมล + รหัสผ่าน (รหัสเดิมจากระบบเก่าใช้ได้)
// ลืมรหัส → ลิงก์ทางอีเมล (ถ้าเปิดไว้) หรือ รหัสชั่วคราว 6 หลักจากหัวหน้า
// ข้อความทุกแบบไม่บอกว่าอีเมลไหนมีในระบบ (กันคนนอกสุ่มหารายชื่อพนักงาน)
import { auth, esc, cfg, state, MOCK_MODE, passwordProblem } from '../core.js';
import { icon, toast, withBtn } from '../ui.js';

export function render({ el, onLoggedIn }) {
  let email = localStorage.getItem('exion_last_email') || '';
  el.innerHTML = `
  <div class="auth">
    <div class="auth-art">
      <div class="ring" style="width:420px;height:420px;right:-140px;top:-120px"></div>
      <div class="ring" style="width:300px;height:300px;left:-120px;bottom:-100px"></div>
      <div class="flex gap-12" style="position:relative"><div class="logo-mark" style="background:#fff;color:var(--brand)">EX</div><b>${esc(cfg.COMPANY_NAME || 'Exion Thailand')}</b></div>
      <div style="position:relative">
        <h2>เบิกค่าใช้จ่าย<br>เร็ว ง่าย จบในมือถือ</h2>
        <p>ส่งบิล อนุมัติ ขอเบิกรายเดือน และเงินสดย่อย — ในที่เดียว</p>
        <div class="mt-24">
          <div class="feat">${icon('check-circle')} ถ่ายใบเสร็จแนบได้ทันที</div>
          <div class="feat">${icon('check-circle')} หัวหน้าอนุมัติได้หลายรายการในครั้งเดียว</div>
          <div class="feat">${icon('check-circle')} ดาวน์โหลดฟอร์ม Excel ได้ในไม่กี่วินาที</div>
        </div>
      </div>
      <div class="text-sm" style="opacity:.7;position:relative">EXION Expense v10</div>
    </div>
    <div class="auth-form" id="af"></div>
  </div>`;
  const af = el.querySelector('#af');
  const remember = (v) => { email = v; try { localStorage.setItem('exion_last_email', v); } catch {} };
  const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  const alertBox = (msg, kind = 'bad') => msg ? `<div class="alert ${kind} mb-16">${icon(kind === 'bad' ? 'alert' : 'info')}<div>${esc(msg)}</div></div>` : '';

  // ── 1) ล็อกอิน ──
  function stepLogin(msg = '', kind = 'bad') {
    af.innerHTML = `
      <div class="logo-mark">EX</div>
      <h1>เข้าสู่ระบบ</h1><p class="sub">ใช้อีเมลบริษัท และรหัสผ่านเดิมได้เลย</p>
      ${alertBox(msg, kind)}
      <form class="stack" id="f" novalidate>
        <div class="field"><label for="em">อีเมล</label>
          <input class="input" id="em" type="email" inputmode="email" autocomplete="username" placeholder="name@exionth.com" value="${esc(email)}" required ${email ? '' : 'autofocus'}></div>
        <div class="field"><label for="pw">รหัสผ่าน</label>
          <div class="input-group"><input class="input" id="pw" type="password" autocomplete="current-password" required ${email ? 'autofocus' : ''}>
          <button type="button" class="btn-icon sm" data-eye style="position:absolute;right:6px" aria-label="แสดงรหัส">${icon('eye')}</button></div></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">เข้าสู่ระบบ</button>
      </form>
      <div class="divider"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" type="button" data-forgot>ลืมรหัสผ่าน / ใช้ครั้งแรก</button>
        <button class="btn btn-ghost" type="button" data-code>มีรหัสชั่วคราวแล้ว</button>
      </div>
      ${MOCK_MODE ? `<div class="alert neutral mt-24">${icon('info')}<div class="text-sm">โหมดทดสอบ: ใช้อีเมล เช่น <b>ann@exion.test</b>, <b>smgr@exion.test</b>, <b>gm@exion.test</b>, <b>acc@exion.test</b>, <b>ceo@exion.test</b>, <b>admin@exion.test</b> รหัสอะไรก็ได้ (ยกเว้นคำว่า wrong)</div></div>` : ''}`;
    af.querySelector('[data-eye]').onclick = () => { const p = af.querySelector('#pw'); p.type = p.type === 'password' ? 'text' : 'password'; };
    af.querySelector('[data-forgot]').onclick = () => { const v = af.querySelector('#em').value.trim().toLowerCase(); if (v) remember(v); stepForgot(); };
    af.querySelector('[data-code]').onclick = () => { const v = af.querySelector('#em').value.trim().toLowerCase(); if (v) remember(v); stepCode(); };
    const f = af.querySelector('#f');
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = af.querySelector('#em').value.trim().toLowerCase(), pw = af.querySelector('#pw').value;
      if (!validEmail(v)) { af.querySelector('#em').classList.add('invalid'); af.querySelector('#em').focus(); return; }
      if (!pw) { af.querySelector('#pw').classList.add('invalid'); af.querySelector('#pw').focus(); return; }
      remember(v);
      withBtn(f.querySelector('[type=submit]'), async () => {
        try {
          const out = await auth.login(v, pw);
          if (out.migrated) toast('ย้ายบัญชีเข้าระบบใหม่เรียบร้อย');
          onLoggedIn();
        } catch (err) { stepLogin(err.message + (/ไม่ถูกต้อง/.test(err.message) ? ' — ถ้ายังไม่เคยตั้งรหัส หรือจำไม่ได้ กด "ลืมรหัสผ่าน"' : '')); }
      });
    };
  }

  // ── 2) ลืมรหัสผ่าน ──
  function stepForgot(msg = '') {
    af.innerHTML = `
      <div class="logo-mark">EX</div>
      <h1>ลืมรหัสผ่าน</h1><p class="sub">กรอกอีเมลบริษัท แล้วเราจะบอกขั้นตอนถัดไป (ใช้กับการเข้าใช้ครั้งแรกด้วย)</p>
      ${alertBox(msg)}
      <form class="stack" id="f" novalidate>
        <div class="field"><label for="em">อีเมล</label>
          <input class="input" id="em" type="email" inputmode="email" autocomplete="username" value="${esc(email)}" required autofocus></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">ดำเนินการต่อ ${icon('arrow-right')}</button>
        <button class="btn btn-ghost btn-block" type="button" data-back>${icon('chevron-left', 'sm')} กลับไปหน้าเข้าสู่ระบบ</button>
      </form>`;
    af.querySelector('[data-back]').onclick = () => stepLogin();
    const f = af.querySelector('#f');
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = af.querySelector('#em').value.trim().toLowerCase();
      if (!validEmail(v)) { af.querySelector('#em').classList.add('invalid'); return; }
      remember(v);
      withBtn(f.querySelector('[type=submit]'), async () => {
        try {
          const r = await auth.requestReset(v);
          if (r.mode === 'email') stepSent(r.message);
          else stepCode(r.message, 'info');
        } catch (err) { stepForgot(err.message); }
      });
    };
  }

  // ── 3) ส่งลิงก์ทางอีเมลแล้ว ──
  function stepSent(message) {
    af.innerHTML = `
      <div class="logo-mark">EX</div>
      <h1>เช็คอีเมลของคุณ 📬</h1>
      <div class="alert ok mt-16 mb-16">${icon('check-circle')}<div>${esc(message)}</div></div>
      <p class="muted text-sm">เปิดอีเมลจาก EXION บนเครื่องนี้ แล้วกดลิงก์ "ตั้งรหัสผ่านใหม่" — ถ้าไม่ได้รับภายใน 5 นาที ให้ขอใหม่ หรือขอรหัสชั่วคราวจากหัวหน้า/GM</p>
      <div class="btn-row mt-16">
        <button class="btn btn-secondary" type="button" data-back>${icon('chevron-left', 'sm')} หน้าเข้าสู่ระบบ</button>
        <button class="btn btn-ghost" type="button" data-code>มีรหัสชั่วคราวแล้ว</button>
      </div>`;
    af.querySelector('[data-back]').onclick = () => stepLogin();
    af.querySelector('[data-code]').onclick = () => stepCode();
  }

  // ── 4) รหัสชั่วคราว 6 หลัก + ตั้งรหัสใหม่ ──
  function stepCode(msg = '', kind = 'bad') {
    af.innerHTML = `
      <div class="logo-mark">EX</div>
      <h1>ตั้งรหัสผ่านใหม่</h1>
      <p class="sub">กรอก <b>รหัสชั่วคราว 6 หลัก</b> ที่ได้จากหัวหน้า แล้วตั้งรหัสผ่านของคุณ</p>
      ${alertBox(msg, kind)}
      <form class="stack" id="f" novalidate>
        <div class="field"><label for="em">อีเมล</label>
          <input class="input" id="em" type="email" inputmode="email" autocomplete="username" value="${esc(email)}" required></div>
        <div class="field"><label for="code">รหัสชั่วคราว 6 หลัก</label>
          <input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" pattern="[0-9]*"></div>
        <div class="field"><label for="p1">รหัสผ่านใหม่</label><input class="input" id="p1" type="password" autocomplete="new-password">
          <div class="hint">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข ห้ามมีชื่ออีเมลอยู่ข้างใน</div></div>
        <div class="field"><label for="p2">ยืนยันรหัสผ่านใหม่</label><input class="input" id="p2" type="password" autocomplete="new-password"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">ตั้งรหัสและเข้าสู่ระบบ</button>
        <button class="btn btn-ghost btn-block" type="button" data-back>${icon('chevron-left', 'sm')} กลับไปหน้าเข้าสู่ระบบ</button>
      </form>`;
    af.querySelector('[data-back]').onclick = () => stepLogin();
    const codeEl = af.querySelector('#code');
    codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 6); });
    (email ? codeEl : af.querySelector('#em')).focus();
    const f = af.querySelector('#f');
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = af.querySelector('#em').value.trim().toLowerCase();
      const code = codeEl.value;
      const p1 = af.querySelector('#p1').value, p2 = af.querySelector('#p2').value;
      if (!validEmail(v)) return toast('กรุณากรอกอีเมลให้ถูกต้อง', 'bad');
      if (code.length !== 6) return toast('กรอกรหัสชั่วคราวให้ครบ 6 หลัก', 'bad');
      const prob = passwordProblem(p1, v);
      if (prob) return toast(prob, 'bad');
      if (p1 !== p2) return toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'bad');
      remember(v);
      withBtn(f.querySelector('[type=submit]'), async () => {
        try { await auth.setPassword(v, code, p1); toast('ตั้งรหัสผ่านเรียบร้อย'); onLoggedIn(); }
        catch (err) { stepCode(err.message); }
      });
    };
  }

  const notice = state.authNotice; state.authNotice = null;
  stepLogin(notice || '', notice ? 'warn' : 'bad');
}
