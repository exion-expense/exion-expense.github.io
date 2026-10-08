// ตั้งรหัสผ่านใหม่ หลังกดลิงก์ "ตั้งรหัสผ่านใหม่" ในอีเมล (มี session ชั่วคราวจากลิงก์แล้ว)
import { auth, esc, passwordProblem, loadProfile } from '../core.js?v=10.0.16';
import { icon, toast, withBtn } from '../ui.js?v=10.0.16';

export function render(ctx) {
  const { el, go } = ctx;
  const email = auth.user?.email || '';
  el.innerHTML = `
  <div class="card pad" style="max-width:480px;margin:0 auto">
    <div class="flex gap-12 mb-16"><span class="row-icon c-red">${icon('key')}</span>
      <div><h2>ตั้งรหัสผ่านใหม่</h2><div class="muted text-sm">${esc(email)}</div></div></div>
    <form class="stack" id="f" novalidate>
      <input type="email" autocomplete="username" value="${esc(email)}" hidden>
      <div class="field"><label for="p1">รหัสผ่านใหม่</label><input class="input" id="p1" type="password" autocomplete="new-password" autofocus>
        <div class="hint">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข ห้ามมีชื่ออีเมลอยู่ข้างใน</div></div>
      <div class="field"><label for="p2">ยืนยันรหัสผ่านใหม่</label><input class="input" id="p2" type="password" autocomplete="new-password"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">บันทึกรหัสผ่านใหม่</button>
    </form>
  </div>`;
  const f = el.querySelector('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    const p1 = el.querySelector('#p1').value, p2 = el.querySelector('#p2').value;
    const prob = passwordProblem(p1, email);
    if (prob) return toast(prob, 'bad');
    if (p1 !== p2) return toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'bad');
    withBtn(f.querySelector('[type=submit]'), async () => {
      try {
        await auth.resetWithSession(p1);
        await loadProfile(true).catch(() => {});
        toast('ตั้งรหัสผ่านใหม่เรียบร้อย');
        go('/');
      } catch (err) { toast(err.message, 'bad'); }
    });
  };
}
