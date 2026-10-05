// ล็อกให้หน้าเว็บคุยได้เฉพาะโปรเจกต์ Supabase ของบริษัท (เข้มกว่าค่าใน index.html ที่อนุญาต *.supabase.co)
(function () {
  const u = (window.EXION_CONFIG || {}).SUPABASE_URL || '';
  const m = /^https:\/\/([a-z0-9-]+)\.supabase\.(co|in)\/?$/.exec(u);
  if (!m) return;
  const host = m[1] + '.supabase.' + m[2];
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = "img-src 'self' data: blob: https://" + host + "; connect-src 'self' https://" + host + ' wss://' + host + '; frame-src https://' + host;
  document.head.appendChild(meta);
})();
