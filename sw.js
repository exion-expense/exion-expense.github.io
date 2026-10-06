// Service worker — แคชเฉพาะไฟล์หน้าเว็บ · ไม่แตะข้อมูล Supabase (ข้อมูลสดเสมอ)
const VERSION = 'exion-v10.0.9';
const SHELL = ['./', './index.html', './css/app.css', './config.js', './manifest.webmanifest', './icons/favicon-64.png', './icons/icon-192.png', './brand/logo.png', './brand/mark.png', './brand/plant.svg',
  './js/main.js', './js/core.js', './js/ui.js', './js/shell.js', './js/icons.js', './js/csp.js', './vendor/supabase-2.117.2.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // แคชเฉพาะไฟล์ของแอปเอง · ข้อมูล Supabase / ฟอนต์ ไม่ผ่านแคชของเรา
  if (url.origin !== location.origin) return;
  // เครือข่ายก่อน (ได้เวอร์ชันใหม่ทันที) · ออฟไลน์ใช้แคช · เก็บเฉพาะคำตอบที่สำเร็จ
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
