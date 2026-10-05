// กล่องเงินสด — ยอดในกล่อง / ขอเติมเงิน / นับเงิน / เคลียร์บิล / ตั้งวงเงิน (สิทธิ์ตามบทบาท)
import { api, money, fmtDate, esc } from '../core.js';
import { icon, toast, toastError, withBtn, sheet, empty, errorBox, skeleton, on, $ } from '../ui.js';

const FUND_KEY = 'exion_petty_fund';
function fundId() { try { return localStorage.getItem(FUND_KEY) || null; } catch { return null; } }
function setFund(v) { try { v ? localStorage.setItem(FUND_KEY, v) : localStorage.removeItem(FUND_KEY); } catch {} }
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function render(ctx) {
  const { el, profile } = ctx;
  const role = profile.role || {};
  let d = null;

  async function load() {
    const paintIt = (x) => { d = x; if (ctx.alive()) paint(); };
    try {
      try { await api.load('get_petty_home', { p_fund_id: fundId() }, paintIt); }
      catch (e) {
        if (fundId() && /ไม่พบกล่องเงินสด/.test(e.message)) { setFund(''); await api.load('get_petty_home', { p_fund_id: null }, paintIt); }
        else throw e;
      }
    } catch (e) {
      if (!ctx.alive()) return;
      if (/ยังไม่ได้ตั้งกล่องเงินสด/.test(e.message)) el.innerHTML = `<div class="card">${empty({ ic: 'wallet', title: 'ยังไม่เปิดใช้เงินสดย่อย', sub: e.message })}</div>`;
      else errorBox(el, e, load);
    }
  }
  const reload = () => { ctx.refreshBadges(); return load(); };

  function paint() {
    const b = d.balance || {}, f = d.fund || {};
    const funds = d.funds || [];
    const pct = b.limit ? Math.max(0, Math.min(100, (b.cash / b.limit) * 100)) : 0;
    const alertPct = b.limit ? Math.min(100, (b.lowAlert / b.limit) * 100) : 0;
    const canOps = d.isHolder || d.isAccountant;   // ขอเติม / นับเงิน
    const boss = d.isAccountant;                     // บัญชี หรือ GM: เคลียร์บิล / ตั้งค่า
    const uncleared = r2(b.limit - b.cash);
    const who = [d.isHolder && 'คนถือกล่อง', boss && (role.isGM && !role.isAccountant ? 'ผู้บริหาร' : 'ฝ่ายบัญชี')].filter(Boolean).join(' · ') || 'ดูอย่างเดียว';
    const lock = (t) => `<span class="badge b-neutral plain">${icon('lock', 'sm')} ${t}</span>`;
    const action = (key, ic, color, title, sub, allowed, lockText, btn, disabledWhy = '') => `<div class="row">
      <span class="row-icon ${color}">${icon(ic)}</span>
      <div class="row-main"><div class="row-title">${title}</div><div class="row-sub" style="white-space:normal">${sub}</div></div>
      <div class="row-end">${!allowed ? lock(lockText) : disabledWhy ? `<span class="badge b-neutral plain">${esc(disabledWhy)}</span>`
        : `<button type="button" class="btn btn-secondary btn-sm" data-act="${key}">${btn}</button>`}</div></div>`;

    el.innerHTML = `
    <div class="stack">
      ${funds.length > 1 ? `<div class="field"><label for="pf-fund">กล่องเงินสด</label>
        <select class="input" id="pf-fund" data-fund>${funds.map((x) => `<option value="${esc(x.fundId)}" ${x.fundId === f.fundId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
      ${!canOps ? `<div class="alert neutral">${icon('eye')}<div>คุณดูข้อมูลกล่องได้อย่างเดียว — การขอเติมเงิน/นับเงินทำได้เฉพาะคนถือกล่องและฝ่ายบัญชี</div></div>` : ''}
      <div class="split">
        <div class="stack">
          <div class="card">
            <div class="card-head"><h3>${icon('wallet')} ${esc(f.name || b.fundName || 'กล่องเงินสด')}</h3><span class="badge b-brand plain">${esc(who)}</span></div>
            <div class="pad">
              <div class="muted text-sm">เงินสดในกล่อง</div>
              <div class="callout-amount"><span class="v amount">${money(b.cash)}</span><span class="muted">/ ${money(b.limit, 0)} บาท</span></div>
              <div class="meter mt-8 ${b.lowCash ? 'bad' : pct < 40 ? 'warn' : ''}" role="img" aria-label="เงินในกล่อง ${pct.toFixed(0)}% ของวงเงิน"><i style="width:${pct}%"></i></div>
              <div class="flex between text-xs muted mt-4"><span>เส้นเตือน ${money(b.lowAlert, 0)} (${alertPct.toFixed(0)}%)</span><span>${pct.toFixed(0)}% ของวงเงิน</span></div>
              ${b.lowCash ? `<div class="alert warn mt-12">${icon('alert')}<div><b>เงินสดเหลือน้อย</b> — ต่ำกว่าเส้นเตือน ${canOps ? 'ขอเติมเงินหรือให้บัญชีเคลียร์บิล' : ''}</div></div>` : ''}
              <div class="grid-2 mt-16">
                <div class="stat"><div class="l">ใช้ไปตั้งแต่เติมล่าสุด</div><div class="v">${money(b.spentSinceTopUp, 0)}</div><div class="d">เติมล่าสุด ${b.lastTopUpAt ? fmtDate(b.lastTopUpAt) : '-'}</div></div>
                <div class="stat ${b.suggestTopUp > 0 ? 'brand' : 'ok'}"><div class="l">แนะนำให้เติม</div><div class="v">${money(b.suggestTopUp, 0)}</div><div class="d">วงเงิน − เงินในกล่อง</div></div>
                <div class="stat"><div class="l">พร้อมจ่าย</div><div class="v">${money(b.available, 0)}</div><div class="d">หักที่อนุมัติรอจ่ายแล้ว</div></div>
                <div class="stat warn"><div class="l">อนุมัติรอจ่าย</div><div class="v">${money(b.reserved, 0)}</div><div class="d">รออนุมัติอีก ${money(b.pendingOut, 0)}</div></div>
              </div>
              <dl class="kv tight mt-16">
                <dt>คนถือกล่อง</dt><dd>${esc(b.holderName || f.holderEmail || '-')}</dd>
                <dt>วงเงิน</dt><dd><span class="amount">${money(b.limit)}</span> บาท</dd>
                <dt>เตือนเมื่อต่ำกว่า</dt><dd><span class="amount">${money(b.lowAlert)}</span> บาท</dd>
                <dt>เติมเงินล่าสุด</dt><dd>${b.lastTopUpAt ? fmtDate(b.lastTopUpAt, { full: true }) : '-'}</dd>
                <dt>รายการในสมุด</dt><dd>${money(b.txCount, 0)} รายการ</dd>
              </dl>
              <div class="alert neutral mt-16">${icon('calculator')}<div>เงินในกล่อง <b class="amount">${money(b.cash)}</b> + บิลที่ยังไม่เคลียร์ <b class="amount">${money(uncleared)}</b> = วงเงิน <b class="amount">${money(b.limit)}</b></div></div>
            </div>
          </div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><h3>${icon('settings')} จัดการกล่อง</h3></div>
            <div class="list">
              ${action('topup', 'plus-circle', 'c-green', 'ขอเติมเงินเข้ากล่อง', 'ส่งคำขอให้ผู้อนุมัติ · ได้รับเงินแล้วกด “รับเงินเข้ากล่อง” ในหน้ารออนุมัติ', canOps, 'คนถือกล่อง/บัญชี', 'ขอเติม', b.suggestTopUp > 0 ? '' : 'กล่องเต็มแล้ว')}
              ${action('count', 'calculator', 'c-amber', 'นับเงินในกล่อง', 'เทียบเงินจริงกับระบบ — ถ้าไม่ตรง ระบบบันทึกปรับยอดและแจ้ง GM/บัญชี', canOps, 'คนถือกล่อง/บัญชี', 'นับเงิน')}
              ${action('clear', 'refresh', 'c-teal', 'เคลียร์บิล', 'บัญชีรับบิลที่จ่ายแล้ว และเติมเงินกลับให้เต็มวงเงินในขั้นตอนเดียว', boss, 'บัญชี/GM', 'เคลียร์บิล', b.suggestTopUp > 0 ? '' : 'กล่องเต็มแล้ว')}
              ${action('config', 'settings', 'c-violet', 'ตั้งวงเงิน / เส้นเตือน', `วงเงิน ${money(b.limit, 0)} · เตือนเมื่อต่ำกว่า ${money(b.lowAlert, 0)} บาท`, boss, 'บัญชี/GM', 'ตั้งค่า')}
            </div></div>
          <div class="card"><div class="list">
            <a class="row" href="#/petty/list"><span class="row-icon c-blue">${icon('list')}</span><div class="row-main"><div class="row-title">สมุดบัญชีกล่อง</div><div class="row-sub">รายการรับ-จ่ายทั้งหมด</div></div>${icon('chevron-right')}</a>
            <a class="row" href="#/petty/approve"><span class="row-icon c-amber">${icon('inbox')}</span><div class="row-main"><div class="row-title">รออนุมัติ / รอจ่าย</div><div class="row-sub">${d.toPay ? `รอจ่ายเงิน ${d.toPay} รายการ` : 'จ่ายเงินสด · รับเงินเติม'}</div></div>${icon('chevron-right')}</a>
            ${role.isAccountant || role.canViewAll ? `<a class="row" href="#/petty/msbc"><span class="row-icon c-teal">${icon('sheet')}</span><div class="row-main"><div class="row-title">ตาราง MSBC</div><div class="row-sub">สรุปบิลลงบัญชี + Excel</div></div>${icon('chevron-right')}</a>` : ''}
          </div></div>
        </div>
      </div>
    </div>`;
  }

  // ─────────────── หน้าต่างแต่ละงาน ───────────────
  function topupSheet() {
    const b = d.balance, room = r2(b.limit - b.cash);
    sheet({
      title: 'ขอเติมเงินเข้ากล่อง',
      body: `<div class="stack-sm">
        <div class="field"><label class="req" for="tu-amt">จำนวนเงินที่ขอเติม</label>
          <div class="input-group has-suf"><input type="number" class="input big" id="tu-amt" inputmode="decimal" step="0.01" min="0" max="${room}" value="${r2(b.suggestTopUp)}" autofocus><span class="suf">บาท</span></div>
          <div class="hint">แนะนำ ${money(b.suggestTopUp)} บาท (วงเงิน − เงินในกล่อง) · เติมได้ไม่เกิน ${money(room)} บาท</div>
          <div class="err-text hidden" id="tu-err"></div></div>
        <div class="field"><label for="tu-note">หมายเหตุ <span class="opt">ไม่บังคับ</span></label><input class="input" id="tu-note" maxlength="200" placeholder="เบิกชดเชยเงินสดย่อย"></div>
        <div class="alert">${icon('info')}<div>1) ส่งคำขอให้ผู้อนุมัติ &nbsp;2) ได้รับเงินจริงแล้ว กด <b>“รับเงินเข้ากล่องแล้ว”</b> ที่หน้า รออนุมัติ / รอจ่าย — ยอดในกล่องจะเพิ่มตอนนั้น</div></div>
      </div>`,
      foot: `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>${icon('send')} ส่งคำขอเติมเงิน</button>`,
      onMount: (sh, close) => {
        const ok = $('[data-ok]', sh), inp = $('#tu-amt', sh), err = $('#tu-err', sh);
        ok.onclick = () => {
          const amt = r2(inp.value);
          const msg = amt <= 0 ? 'กรุณาใส่จำนวนเงิน' : amt > room + 0.01 ? `เติมแล้วจะเกินวงเงิน (เติมได้ไม่เกิน ${money(room)} บาท)` : '';
          err.textContent = msg; err.classList.toggle('hidden', !msg); inp.classList.toggle('invalid', !!msg);
          if (msg) return;
          withBtn(ok, async () => {
            try {
              const r = await api.rpc('request_petty_topup', { p_fund_id: d.fund.fundId, p_amount: amt, p_note: $('#tu-note', sh).value.trim() });
              close(true);
              toast(`ส่งคำขอเติมเงิน ${money(r.amount ?? amt)} บาทแล้ว`);
              reload();
            } catch (e) { toastError(e); }
          });
        };
      },
    });
  }

  function countSheet() {
    const b = d.balance;
    sheet({
      title: 'นับเงินในกล่อง',
      body: `<div class="stack-sm">
        <div class="flex between"><span class="muted">ยอดตามระบบ</span><b class="amount text-lg">${money(b.cash)} บาท</b></div>
        <div class="field"><label class="req" for="ct-amt">ยอดที่นับได้จริง</label>
          <div class="input-group has-suf"><input type="number" class="input big" id="ct-amt" inputmode="decimal" step="0.01" min="0" placeholder="0.00" autofocus><span class="suf">บาท</span></div></div>
        <div id="ct-diff" class="alert neutral">${icon('calculator')}<div>กรอกยอดที่นับได้ ระบบจะเทียบให้ทันที</div></div>
        <div class="field hidden" id="ct-why"><label class="req" for="ct-reason">สาเหตุที่เงินไม่ตรง</label>
          <textarea class="input" id="ct-reason" maxlength="300" placeholder="เช่น ทอนเงินผิด / ลืมบันทึกบิล"></textarea>
          <div class="hint">ระบบจะบันทึกรายการ “ปรับยอด” และแจ้ง GM/ฝ่ายบัญชี</div><div class="err-text hidden" id="ct-err">กรุณาระบุสาเหตุ</div></div>
      </div>`,
      foot: `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>${icon('check')} บันทึกผลการนับ</button>`,
      onMount: (sh, close) => {
        const inp = $('#ct-amt', sh), box = $('#ct-diff', sh), why = $('#ct-why', sh), ok = $('[data-ok]', sh);
        const diffOf = () => (inp.value === '' ? null : r2(r2(inp.value) - b.cash));
        const update = () => {
          const df = diffOf();
          why.classList.toggle('hidden', !df);
          if (df == null) { box.className = 'alert neutral'; box.innerHTML = `${icon('calculator')}<div>กรอกยอดที่นับได้ ระบบจะเทียบให้ทันที</div>`; }
          else if (!df) { box.className = 'alert ok'; box.innerHTML = `${icon('check-circle')}<div><b>ตรงกับระบบ</b></div>`; }
          else {
            box.className = 'alert ' + (df > 0 ? 'warn' : 'bad');
            box.innerHTML = `${icon('alert')}<div><b>เงิน${df > 0 ? 'เกิน' : 'ขาด'} ${money(Math.abs(df))} บาท</b> — ต้องระบุสาเหตุก่อนบันทึก</div>`;
          }
          ok.innerHTML = df ? `${icon('check')} บันทึกปรับยอด` : `${icon('check')} บันทึกผลการนับ`;
        };
        inp.addEventListener('input', update);
        $('#ct-reason', sh).addEventListener('input', () => $('#ct-err', sh).classList.add('hidden'));
        ok.onclick = () => {
          const df = diffOf(), reason = $('#ct-reason', sh).value.trim();
          if (df == null || Number(inp.value) < 0) { inp.classList.add('invalid'); inp.focus(); return; }
          if (df && !reason) { $('#ct-err', sh).classList.remove('hidden'); $('#ct-reason', sh).focus(); return; }
          withBtn(ok, async () => {
            try {
              const r = await api.rpc('submit_petty_count', { p_fund_id: d.fund.fundId, p_counted: r2(inp.value), p_reason: reason });
              if (r.needReason) { toast(r.message, 'bad'); why.classList.remove('hidden'); return; }
              close(true);
              toast(r.matched ? 'นับเงินตรงกับระบบ ✓' : `บันทึกปรับยอด ${r.diff > 0 ? '+' : '−'}${money(Math.abs(r.diff))} บาทแล้ว · แจ้ง GM/บัญชีแล้ว`);
              reload();
            } catch (e) { toastError(e); }
          });
        };
      },
    });
  }

  function clearSheet() {
    const b = d.balance, topup = r2(b.limit - b.cash);
    sheet({
      title: 'เคลียร์บิล',
      body: `<div class="stack-sm">
        <p class="muted">ฝ่ายบัญชีรับบิลที่คนถือกล่องจ่ายไปแล้วมาลงบัญชี แล้ว<b>เติมเงินสดกลับเข้ากล่องให้เต็มวงเงินทันที</b> (บันทึกเป็นเงินรับเข้า ไม่ต้องรออนุมัติ)</p>
        <dl class="kv">
          <dt>บิลที่ใช้ไปตั้งแต่เติมล่าสุด</dt><dd><span class="amount">${money(b.spentSinceTopUp)}</span> บาท</dd>
          <dt>เงินในกล่องตอนนี้</dt><dd><span class="amount">${money(b.cash)}</span> บาท</dd>
          <dt>จะเติมกลับ</dt><dd><span class="amount ok-text">+${money(topup)}</span> บาท</dd>
          <dt>เงินในกล่องหลังเคลียร์</dt><dd><span class="amount">${money(b.limit)}</span> บาท (เต็มวงเงิน)</dd>
        </dl>
        ${Math.abs(topup - Number(b.spentSinceTopUp)) > 0.01 ? `<p class="hint">ยอดเติมกลับไม่เท่ายอดบิล เพราะมีการปรับยอดจากการนับ หรือครั้งก่อนเติมไม่เต็มวงเงิน</p>` : ''}
        <div class="alert warn">${icon('alert')}<div>กดยืนยันเมื่อ<b>มอบเงิน ${money(topup)} บาทให้คนถือกล่องแล้ว</b> · คำขอเติมเงินที่ยังค้างอยู่จะถูกปิดอัตโนมัติ</div></div>
        <div class="field"><label for="cl-note">หมายเหตุ <span class="opt">ไม่บังคับ</span></label><input class="input" id="cl-note" maxlength="200" placeholder="เช่น เลขที่เอกสาร / งวด"></div>
      </div>`,
      foot: `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-success" data-ok>${icon('check')} ยืนยันเคลียร์บิล</button>`,
      onMount: (sh, close) => {
        const ok = $('[data-ok]', sh);
        ok.onclick = () => withBtn(ok, async () => {
          try {
            const r = await api.rpc('clear_petty_bills', { p_fund_id: d.fund.fundId, p_note: $('#cl-note', sh).value.trim() });
            close(true);
            toast(`เคลียร์บิลแล้ว · เติมกลับ ${money(r.toppedUp)} บาท — กล่องเต็มวงเงิน`);
            reload();
          } catch (e) { toastError(e); }
        });
      },
    });
  }

  function configSheet() {
    const b = d.balance;
    sheet({
      title: 'ตั้งวงเงิน / เส้นเตือน',
      body: `<div class="stack-sm">
        <div class="field"><label class="req" for="cf-limit">วงเงินกล่อง</label>
          <div class="input-group has-suf"><input type="number" class="input" id="cf-limit" inputmode="decimal" step="1" min="0" value="${r2(b.limit)}"><span class="suf">บาท</span></div>
          <div class="hint">ต้องไม่ต่ำกว่าเงินในกล่องตอนนี้ (${money(b.cash)} บาท)</div></div>
        <div class="field"><label class="req" for="cf-alert">เตือนเมื่อเงินเหลือต่ำกว่า</label>
          <div class="input-group has-suf"><input type="number" class="input" id="cf-alert" inputmode="decimal" step="1" min="0" value="${r2(b.lowAlert)}"><span class="suf">บาท</span></div>
          <div class="hint">ต้องน้อยกว่าวงเงิน</div></div>
        <div class="err-text hidden" id="cf-err"></div>
        <p class="hint">ถ้าเพิ่มวงเงิน กล่องจะยังไม่เต็ม — กด “เคลียร์บิล” เพื่อเติมให้เต็มวงเงินใหม่</p>
      </div>`,
      foot: `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>${icon('check')} บันทึก</button>`,
      onMount: (sh, close) => {
        const ok = $('[data-ok]', sh), err = $('#cf-err', sh);
        ok.onclick = () => {
          const lim = r2($('#cf-limit', sh).value), al = r2($('#cf-alert', sh).value);
          const msg = lim <= 0 ? 'วงเงินต้องมากกว่า 0' : lim < b.cash - 0.01 ? `วงเงินต่ำกว่าเงินสดที่มีจริง (${money(b.cash)} บาท)` : al < 0 || al >= lim ? 'เส้นเตือนต้องน้อยกว่าวงเงิน' : '';
          err.textContent = msg; err.classList.toggle('hidden', !msg);
          if (msg) return;
          withBtn(ok, async () => {
            try {
              const r = await api.rpc('set_petty_fund_config', { p_fund_id: d.fund.fundId, p_limit: lim, p_low_alert: al });
              close(true);
              toast(r.message || 'บันทึกแล้ว', r.needClear ? 'info' : 'ok');
              reload();
            } catch (e) { toastError(e); }
          });
        };
      },
    });
  }

  el.innerHTML = skeleton(4);
  await load();

  const offs = [
    on(el, 'click', '[data-act]', (e, t) => {
      if (!d) return;
      ({ topup: topupSheet, count: countSheet, clear: clearSheet, config: configSheet })[t.dataset.act]?.();
    }),
    on(el, 'change', '[data-fund]', (e, t) => { setFund(t.value); el.innerHTML = skeleton(4); load(); }),
  ];
  return () => offs.forEach((f) => f());
}
