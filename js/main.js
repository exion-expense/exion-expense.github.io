// จุดเริ่มแอป
import { initClient, cfg } from './core.js?v=10.0.13';
import { start } from './shell.js?v=10.0.13';

(async () => {
  // กันเว็บอื่นเอาหน้านี้ไปฝังหลอกให้กด (clickjacking)
  if (window.top !== window.self) { document.body.innerHTML = ''; try { window.top.location = location.href; } catch { /* */ } return; }
  try {
    await initClient();
    await start();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="auth-form"><img class="auth-logo" src="brand/logo.png" alt="EXION Thailand"><h1>เปิดแอปไม่ได้</h1><p class="sub">${String(e.message || e).replace(/</g, '&lt;')}</p>
      <button class="btn btn-primary" id="retry">ลองใหม่</button></div>`;
    document.getElementById('retry')?.addEventListener('click', () => location.reload());
  }
  if ('serviceWorker' in navigator && !cfg.MOCK_URL && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
