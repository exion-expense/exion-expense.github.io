// ════════════════════════════════════════════════════════════════════
//  ตั้งค่าการเชื่อมต่อ Supabase  (คู่มือ ขั้นที่ 9)
//  ค่าทั้งสองนี้เปิดเผยได้ (publishable key ขึ้นต้น sb_publishable_ หรือ anon key ขึ้นต้น eyJ) — ความปลอดภัยอยู่ที่ฐานข้อมูล
//  ⚠️ ห้ามใส่ secret / service_role key ในไฟล์นี้เด็ดขาด (หน้าเว็บจะไม่ยอมเปิด)
// ════════════════════════════════════════════════════════════════════
window.EXION_CONFIG = {
  SUPABASE_URL: 'https://dpjmpinokjkjsqbqopvp.supabase.co',     // ← Project URL
  SUPABASE_ANON_KEY: 'sb_publishable_ZIOiW_SaQGInbE_UgvHjVA_LkwQulbq',          // ← publishable key (หรือ anon public key)
  COMPANY_NAME: 'Exion Thailand',
};
