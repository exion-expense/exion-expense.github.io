// หน้าแรกเงินสดย่อย — เงินในกล่อง / ทางลัด / คำขอล่าสุด / งานที่รอ (ผู้อนุมัติ, คนถือกล่อง)
import { api, money, fmtDate, esc, catName, statusBadge, loadPettyCategories } from '../core.js?v=10.0.16';
import { icon, catIcon, empty, errorBox, skeleton, on } from '../ui.js?v=10.0.16';

// กล่องเงินที่เลือกไว้ (ใช้ร่วมทุกหน้าเงินสดย่อย) · ว่าง = กล่องหลัก
const FUND_KEY = 'exion_petty_fund';
function fundId() { try { return localStorage.getItem(FUND_KEY) || null; } catch { return null; } }
function setFund(v) { try { v ? localStorage.setItem(FUND_KEY, v) : localStorage.removeItem(FUND_KEY); } catch {} }

export async function render(ctx) {
  const { el } = ctx;
  const st = { home: null, inbox: null };
  loadPettyCategories().catch(() => {});

  async function load() {
    try {
      await loadHome(ctx, st);
    } catch (e) {
      if (/ยังไม่ได้ตั้งกล่องเงินสด/.test(e.message)) {
        el.innerHTML = `<div class="card">${empty({ ic: 'wallet', title: 'ยังไม่เปิดใช้เงินสดย่อย', sub: e.message,
          action: `<a class="btn btn-secondary" href="#/">${icon('arrow-left')} กลับไปเบิกค่าใช้จ่าย</a>` })}</div>`;
        return;
      }
      errorBox(el, e, load);
    }
  }
  await load();

  const offs = [
    on(el, 'change', '[data-fund]', (e, t) => { setFund(t.value); st.inbox = null; el.innerHTML = skeleton(4); load(); }),
  ];
  return () => offs.forEach((f) => f());
}

async function loadHome(ctx, st) {
  const args = () => ({ p_fund_id: fundId() });
  const paintHome = (d) => { st.home = d; if (ctx.alive()) paint(ctx, st); };
  try {
    await api.load('get_petty_home', args(), paintHome);
  } catch (e) {
    // กล่องที่จำไว้ถูกลบ/ปิด → กลับไปกล่องหลัก
    if (fundId() && /ไม่พบกล่องเงินสด/.test(e.message)) { setFund(''); await api.load('get_petty_home', args(), paintHome); }
    else throw e;
  }
  const d = st.home;
  // มีงานรอ → ดึงรายการมาแสดงบางส่วน
  if (d && (d.toApprove || d.toPay)) {
    api.load('get_petty_inbox', args(), (x) => { st.inbox = x; if (ctx.alive()) paint(ctx, st); }).catch(() => {});
  }
}

function paint(ctx, st) {
  const { el, profile } = ctx;
  const d = st.home || {};
  const b = d.balance || {}, f = d.fund || {};
  const pct = b.limit ? Math.max(0, Math.min(100, (b.cash / b.limit) * 100)) : 0;
  const canFund = d.isHolder || d.isAccountant;
  const role = profile.role || {};
  const showMsbc = role.isAccountant || role.canViewAll;
  const funds = d.funds || [];

  el.innerHTML = `
  <div class="stack">
    ${funds.length > 1 ? `<div class="field"><label for="pc-fund">กล่องเงินสด</label>
      <select class="input" id="pc-fund" data-fund>${funds.map((x) => `<option value="${esc(x.fundId)}" ${x.fundId === f.fundId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}

    <section class="hero ${b.lowCash ? '' : 'green'}">
      <div style="position:relative;z-index:1">
        <div class="flex between"><span class="eyebrow">${icon('wallet', 'sm')} ${esc(f.name || b.fundName || 'เงินสดย่อย')}</span>
          ${d.isHolder ? '<span class="badge plain" style="background:rgba(255,255,255,.18);color:#fff">คุณถือกล่องนี้</span>' : ''}</div>
        <div class="eyebrow mt-12">เงินสดในกล่อง</div>
        <div class="flex wrap" style="align-items:baseline"><span class="big">${money(b.cash, 0)}</span><span style="opacity:.85">/ ${money(b.limit, 0)} บาท</span></div>
        <div class="meter mt-8" style="background:rgba(255,255,255,.22)" role="img" aria-label="เงินในกล่อง ${pct.toFixed(0)}% ของวงเงิน"><i style="width:${pct}%;background:#fff"></i></div>
      </div>
      <div class="hero-stats">
        <div class="hs"><div class="v">${money(b.available, 0)}</div><div class="l">พร้อมจ่าย</div></div>
        <div class="hs"><div class="v">${money(b.reserved, 0)}</div><div class="l">อนุมัติรอจ่าย</div></div>
        <div class="hs"><div class="v">${money(b.pendingOut, 0)}</div><div class="l">รออนุมัติ</div></div>
      </div>
      <div class="flex wrap mt-16">
        <a class="btn btn-white" href="#/petty/request">${icon('plus')} ขอเบิก</a>
        <a class="btn btn-glass" href="#/petty/list">${icon('list')} รายการ</a>
        ${canFund ? `<a class="btn btn-glass" href="#/petty/fund">${icon('wallet')} กล่องเงิน</a>` : ''}
      </div>
    </section>

    ${b.lowCash ? `<div class="alert warn">${icon('alert')}<div><b>เงินสดเหลือน้อย</b> — ต่ำกว่าเส้นเตือน ${money(b.lowAlert, 0)} บาท
      ${canFund ? `<div class="mt-4"><a href="#/petty/fund" class="bold">ขอเติมเงิน / เคลียร์บิล ${icon('chevron-right', 'sm')}</a></div>` : '<div class="text-sm">คนถือกล่องจะขอเติมเงินกับฝ่ายบัญชี</div>'}</div></div>` : ''}

    <div class="split">
      <div class="stack">
        ${pendingCard(d, st.inbox)}
        ${recentCard(d, profile)}
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('info')} ข้อมูลกล่อง</h3></div>
          <div class="pad"><dl class="kv tight">
            <dt>คนถือกล่อง</dt><dd>${esc(b.holderName || f.holderEmail || '-')}</dd>
            <dt>เบิกได้ต่อครั้ง</dt><dd>ไม่เกิน <span class="amount">${money(d.maxPerRequest, 0)}</span> บาท</dd>
            <dt>เติมเงินล่าสุด</dt><dd>${b.lastTopUpAt ? fmtDate(b.lastTopUpAt) : '-'}</dd>
            ${d.myPending ? `<dt>คำขอของฉันที่ค้าง</dt><dd>${d.myPending} รายการ</dd>` : ''}
          </dl></div></div>
        <div class="card"><div class="card-head"><h3>${icon('grid')} เมนูลัด</h3></div>
          <div class="pad tiles">
            <a class="tile" href="#/petty/request"><span class="row-icon c-red">${icon('plus')}</span>ขอเบิก</a>
            <a class="tile" href="#/petty/list"><span class="row-icon c-blue">${icon('list')}</span>รายการ</a>
            ${d.toApprove || d.toPay || canFund || role.isManager ? `<a class="tile" href="#/petty/approve"><span class="row-icon c-amber">${icon('inbox')}</span>รออนุมัติ / รอจ่าย</a>` : ''}
            ${canFund || role.canViewAll ? `<a class="tile" href="#/petty/fund"><span class="row-icon c-green">${icon('wallet')}</span>กล่องเงิน</a>` : ''}
            ${showMsbc ? `<a class="tile" href="#/petty/msbc"><span class="row-icon c-teal">${icon('sheet')}</span>ตาราง MSBC</a>` : ''}
            <a class="tile" href="#/"><span class="row-icon">${icon('receipt')}</span>เบิกค่าใช้จ่าย</a>
          </div></div>
      </div>
    </div>
  </div>`;
}

function pendingCard(d, inbox) {
  const n = (d.toApprove || 0) + (d.toPay || 0);
  if (!n) return '';
  const items = inbox ? [...(inbox.toApprove || []), ...(inbox.toPay || []), ...(inbox.toReceive || [])].slice(0, 4) : [];
  const parts = [d.toApprove ? `รออนุมัติ ${d.toApprove}` : '', d.toPay ? `รอจ่ายเงิน ${d.toPay}` : ''].filter(Boolean).join(' · ');
  return `<div class="card">
    <div class="card-head"><h3>${icon('inbox')} งานที่รอคุณ <span class="badge b-pending plain">${n}</span></h3><a class="link" href="#/petty/approve">ไปจัดการ ${icon('chevron-right', 'sm')}</a></div>
    ${items.length ? `<div class="list">${items.map((x) => row(x, { who: true, href: '#/petty/approve' })).join('')}</div>`
      : `<a class="row" href="#/petty/approve"><span class="row-icon c-amber">${icon('inbox')}</span><div class="row-main"><div class="row-title">${esc(parts)}</div><div class="row-sub">แตะเพื่อดูรายการ</div></div>${icon('chevron-right')}</a>`}
  </div>`;
}

function recentCard(d, profile) {
  const all = d.canSeeAll;
  const me = String(profile.email || '').toLowerCase();
  const rows = (d.recent || []).slice(0, 6);
  return `<div class="card"><div class="card-head"><h3>${icon('clock')} ${all ? 'ความเคลื่อนไหวล่าสุด' : 'คำขอล่าสุดของฉัน'}</h3><a class="link" href="#/petty/list">ทั้งหมด ${icon('chevron-right', 'sm')}</a></div>
    ${rows.length ? `<div class="list">${rows.map((x) => row(x, { who: all && String(x.requester_email || '').toLowerCase() !== me, href: '#/petty/list?id=' + encodeURIComponent(x.id) })).join('')}</div>`
      : empty({ ic: 'wallet', title: 'ยังไม่มีรายการ', sub: 'ซื้อของเล็กๆ น้อยๆ ให้บริษัท ขอเบิกเงินสดได้ที่นี่', action: `<a class="btn btn-primary" href="#/petty/request">${icon('plus')} ขอเบิกเงินสดย่อย</a>` })}</div>`;
}

// ─────────────── แถวรายการเงินสดย่อย ───────────────
function row(x, { who = false, href = '' } = {}) {
  const title = x.type === 'OUT' ? (x.purpose || catName(x.category)) : catName(x.category);
  const sub = [fmtDate(x.expense_date || x.created_at), x.type === 'OUT' ? catName(x.category) : '', x.payee && x.type === 'OUT' ? x.payee : '']
    .filter(Boolean).map(esc).join(' · ');
  const files = (x.receipt_paths || []).length ? ` · ${icon('paperclip', 'sm')}${x.receipt_paths.length}` : '';
  return `<a class="row" href="${esc(href)}">${catIcon(x.category)}
    <div class="row-main"><div class="row-title">${who ? esc(x.requester_name) + ' · ' : ''}${esc(title)}</div><div class="row-sub">${sub}${files}</div></div>
    <div class="row-end">${signed(x)}${badge(x)}</div></a>`;
}
function signed(x) {
  const a = Number(x.amount) || 0;
  const v = x.type === 'OUT' ? -a : a;      // IN = บวก · ADJUST ตามเครื่องหมายของยอด
  const dead = x.status === 'Rejected' || x.status === 'Cancelled';   // ไม่มีผลกับยอดกล่อง
  return `<span class="amount ${dead ? 'faint' : v > 0 ? 'ok-text' : ''}">${v > 0 ? '+' : '−'}${money(Math.abs(v))}</span>`;
}
function badge(x) {
  if (x.type === 'ADJUST') return statusBadge('Paid', 'ปรับยอดแล้ว');
  if (x.type === 'IN' && x.status === 'Paid') return statusBadge('Paid', 'เข้ากล่องแล้ว');
  if (x.type === 'IN' && x.status === 'Approved') return statusBadge('Approved', 'อนุมัติ · รอรับเงิน');
  if (x.type === 'OUT' && x.status === 'Approved') return statusBadge('Approved', 'อนุมัติ · รอรับเงินสด');
  return statusBadge(x.status);
}
