// ลิงก์/ไอคอนจากระบบเดิม (status.html ฯลฯ) → หน้าใหม่
location.replace('./?legacy=' + encodeURIComponent(location.pathname.split('/').pop() || 'index.html') + (location.search ? '&' + location.search.slice(1) : ''));
