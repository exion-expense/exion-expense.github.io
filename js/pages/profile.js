// โปรไฟล์ · ลายเซ็น · ขอเบิกรายเดือน (ใช้ทั้ง /profile และ /petty/profile — ฝั่งเงินสดย่อยไม่มีส่วนขอเบิกรายเดือน)
import { api, auth, loadProfile, money, fmtDate, fmtDateTime, esc, initials, roleLabel, monthLabel, catName, exportStage, statusBadge } from '../core.js';
import { icon, catIcon, toast, toastError, confirmBox, sheet, busy, withBtn, signaturePad, monthNav, shiftMonth, empty, on, debounce } from '../ui.js';

export async function render(ctx) {
  const { el } = ctx;
  const petty = ctx.app === 'petty';
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  // สถานะของหน้า (เก็บใน closure)
  const st = { y: curY, m: curM, info: null, infoErr: null, exports: null, start: '', end: '', pv: null, pvErr: '', pvLoading: false, pvSeq: 0, allowance: null };
  const me = () => ctx.profile.email;

  el.innerHTML = `<div class="stack">
    <div id="pf-prof"></div>
    ${petty ? `<div class="split"><div class="stack"><div id="pf-sig"></div></div><div class="stack"><div id="pf-acc"></div></div></div>`
      : `<div class="split">
        <div class="stack"><div id="pf-claim"></div><div id="pf-hist"></div></div>
        <div class="stack"><div id="pf-sig"></div><div id="pf-acc"></div></div>
      </div>`}
  </div>`;
  const $ = (id) => el.querySelector('#' + id);

  paintProfile(ctx, $('pf-prof'));
  paintAccount($('pf-acc'), petty);
  const sigJob = loadSig();

  // ─────────── ลายเซ็น ───────────
  async function loadSig() {
    const box = $('pf-sig');
    box.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('pen')} ลายเซ็น</h3></div><div class="pad"><span class="spin"></span></div></div>`;
    try {
      const s = await api.rpc('get_my_signature');
      if (!ctx.alive()) return;
      box.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('pen')} ลายเซ็น</h3>
          <button class="btn btn-secondary btn-sm" data-act="sign">${icon('edit', 'sm')} ${s.hasSignature ? 'เปลี่ยนลายเซ็น' : 'เพิ่มลายเซ็น'}</button></div>
        <div class="pad stack-sm">
          ${s.hasSignature ? `<img class="sig-img" alt="ลายเซ็นของฉัน" data-sig>`
            : `<div class="alert warn">${icon('alert')}<div>ยังไม่มีลายเซ็น — ใช้ตอนอนุมัติรายการและพิมพ์ลงฟอร์มขอเบิก</div></div>`}
          <p class="hint">ลายเซ็นนี้จะถูกใส่ในฟอร์ม Excel ที่คุณเป็นผู้อนุมัติ</p>
        </div></div>`;
      if (s.hasSignature) {
        const img = box.querySelector('[data-sig]');
        api.fileUrl(s.path).then((u) => { img.src = u; }).catch(() => { img.replaceWith(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'เปิดรูปลายเซ็นไม่ได้' })); });
      }
    } catch (e) {
      if (ctx.alive()) box.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('pen')} ลายเซ็น</h3></div><div class="pad"><div class="alert bad">${icon('alert')}<div>${esc(e.message)}</div></div></div></div>`;
    }
  }

  function openSignSheet() {
    let file = null, pad = null;
    const s = sheet({
      title: 'เปลี่ยนลายเซ็น',
      body: `<div id="sp"></div>
        <div class="divider"></div>
        <div class="flex between wrap"><span class="hint">หรืออัปโหลดรูปลายเซ็น (PNG/JPG พื้นขาว)</span>
          <label class="btn btn-secondary btn-sm">${icon('upload', 'sm')} เลือกรูป<input type="file" accept="image/png,image/jpeg" hidden data-file></label></div>
        <p class="hint mt-8 hidden" data-fname></p>`,
      foot: `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-save>${icon('check')} บันทึกลายเซ็น</button>`,
      onMount: (box) => {
        pad = signaturePad(box.querySelector('#sp'));
        box.querySelector('[data-file]').onchange = (e) => {
          file = e.target.files[0] || null;
          const n = box.querySelector('[data-fname]');
          n.textContent = file ? `ใช้ไฟล์: ${file.name} (แทนการเซ็นในกรอบ)` : '';
          n.classList.toggle('hidden', !file);
        };
        box.querySelector('[data-save]').onclick = async () => {
          if (!file && pad.isEmpty()) { toast('กรุณาเซ็นชื่อในกรอบ หรือเลือกรูปลายเซ็น', 'bad'); return; }
          if (file && file.size > 5 * 1024 * 1024) { toast('รูปลายเซ็นใหญ่เกิน 5MB', 'bad'); return; }
          try {
            await busy('กำลังบันทึกลายเซ็น…', async () => {
              const f = file || (await pad.toBlob());
              const path = await api.upload(f, 'signatures');
              await api.rpc('save_signature', { p_path: path });
            });
            s.close(true);
            toast('บันทึกลายเซ็นแล้ว');
            loadProfile(true).then((p) => { ctx.profile = p; }).catch(() => {});
            if (ctx.alive()) loadSig();
          } catch (e) { toastError(e); }
        };
      },
    });
  }

  // ─────────── ขอเบิกรายเดือน (เฉพาะฝั่งเบิกค่าใช้จ่าย) ───────────
  const isFuture = () => st.y * 12 + st.m > curY * 12 + curM;
  const curExport = () => (st.exports || []).find((e) => e.year === st.y && e.month === st.m && e.overall_status !== 'Rejected');
  const lastRejected = () => (st.exports || []).find((e) => e.year === st.y && e.month === st.m && e.overall_status === 'Rejected');

  async function loadPeriod() {
    st.info = null; st.infoErr = null; st.pv = null; st.pvErr = '';
    paintClaim();
    const y = st.y, m = st.m;
    try {
      const info = await api.rpc('get_period_info', { p_year: y, p_month: m });
      if (!ctx.alive() || y !== st.y || m !== st.m) return;
      st.info = info;
      st.start = info.expectedStart;
      st.end = info.suggestedEnd > info.maxEnd ? info.maxEnd : info.suggestedEnd;
    } catch (e) { if (y === st.y && m === st.m) st.infoErr = e; }
    if (!ctx.alive()) return;
    paintClaim();
    if (st.info && !curExport()) runPreview();
  }

  function paintClaim() {
    const box = $('pf-claim'); if (!box) return;
    const head = `<div class="card-head"><h3>${icon('calendar')} ขอเบิกรายเดือน</h3>${monthNav(st.y, st.m)}</div>`;
    if (st.infoErr) { box.innerHTML = `<div class="card">${head}<div class="pad"><div class="alert bad">${icon('alert')}<div>${esc(st.infoErr.message)}</div></div></div></div>`; return; }
    if (!st.info || !st.exports) { box.innerHTML = `<div class="card">${head}<div class="pad"><div class="skel-row"><div class="skel b"></div></div><div class="skel-row"><div class="skel b"></div><div class="skel c"></div></div></div></div>`; return; }
    const ex = curExport();
    if (ex) {
      box.innerHTML = `<div class="card">${head}<div class="pad stack-sm">
        <p class="text-sm muted">รอบ ${esc(monthLabel(ex.year, ex.month, true))} ส่งขอเบิกแล้ว — ติดตามสถานะได้ที่นี่</p>
        ${exportCard(ex)}</div></div>`;
      return;
    }
    const i = st.info, rej = lastRejected();
    box.innerHTML = `<div class="card">${head}
      <div class="pad stack">
        ${isFuture() ? `<div class="alert neutral">${icon('info')}<div>ยังไม่ถึงรอบเดือนนี้</div></div>` : ''}
        ${rej ? `<div class="alert bad">${icon('x-circle')}<div><b>รอบนี้เคยไม่อนุมัติ</b>${rej.approver_remark ? ` — ${esc(rej.approver_remark)}` : ''}<br><span class="text-sm">แก้ไขรายการแล้วส่งขออนุมัติใหม่ได้</span></div></div>` : ''}
        <dl class="kv tight">
          <dt>รอบปกติ</dt><dd>${esc(i.rangeLabel)}</dd>
          <dt>ตัดรอบ</dt><dd>${esc(i.cutoffLabel)}</dd>
          <dt>ปิดรอบล่าสุด</dt><dd>${i.hasSettled ? esc(i.lastSettledTH) : '<span class="muted">ยังไม่เคยเบิก</span>'}</dd>
        </dl>
        <div>
          <div class="label mb-8">1 · เลือกช่วงวันที่ของบิล</div>
          <div class="form-grid two">
            <div class="field"><label for="pf-s">ตั้งแต่</label><input class="input" type="date" id="pf-s" value="${esc(st.start)}" max="${esc(i.maxEnd)}"></div>
            <div class="field"><label for="pf-e">ถึง</label><input class="input" type="date" id="pf-e" value="${esc(st.end)}" max="${esc(i.maxEnd)}"></div>
          </div>
          <div class="flex between wrap mt-8"><span class="hint">แนะนำ: เริ่ม ${esc(i.expectedStartTH)} (ต่อจากรอบที่ปิดแล้ว) ถึง ${esc(i.suggestedEndTH)}</span>
            <button class="btn btn-ghost btn-sm" data-act="reset-range">${icon('rotate-ccw', 'sm')} ใช้ค่าแนะนำ</button></div>
        </div>
        <div>
          <div class="label mb-8">2 · ตรวจยอดก่อนส่ง</div>
          <div id="pf-pv"></div>
        </div>
      </div>
      <div class="card-foot"><div class="btn-row">
        <button class="btn btn-secondary" data-act="draft" data-busy="กำลังสร้างไฟล์…">${icon('download')} ร่าง Excel</button>
        <button class="btn btn-primary" data-act="request" ${st.pv && st.pv.count > 0 ? '' : 'disabled'}>${icon('send')} ส่งขออนุมัติ</button>
      </div></div></div>`;
    paintPreview();
  }

  function paintPreview() {
    const box = $('pf-pv'); if (!box) return;
    const sendBtn = el.querySelector('[data-act=request]');
    if (sendBtn) sendBtn.disabled = !(st.pv && st.pv.count > 0) || st.pvLoading;
    if (st.pvErr) { box.innerHTML = `<div class="alert bad">${icon('alert')}<div>${esc(st.pvErr)}</div></div>`; return; }
    if (!st.pv) { box.innerHTML = `<div class="flex"><span class="spin"></span><span class="muted text-sm">กำลังคำนวณยอด…</span></div>`; return; }
    const pv = st.pv;
    // รวมตามหมวด
    const groups = {};
    (pv.items || []).forEach((r) => {
      const g = groups[r.category] || (groups[r.category] = { code: r.category, n: 0, amt: 0 });
      g.n++; g.amt += Number(r.amount) || 0;
    });
    const rows = Object.values(groups).sort((a, b) => b.amt - a.amt);
    const autos = pv.autoAllowance || [];
    const al = st.allowance;
    const alText = al && al.auto ? [['CAR', 'รถ'], ['MOBILE', 'โทรศัพท์'], ['APT', 'ที่พัก']].filter(([k]) => Number(al[k]) > 0).map(([k, l]) => `${l} ${money(al[k], 0)}`).join(' · ') : '';
    box.innerHTML = `<div class="stack-sm">
      ${st.pvLoading ? `<div class="flex"><span class="spin"></span><span class="muted text-sm">กำลังคำนวณยอดใหม่…</span></div>` : ''}
      ${(pv.warnings || []).map((w) => `<div class="alert warn">${icon('alert')}<div>${esc(String(w).replace(/^⚠️\s*/, ''))}</div></div>`).join('')}
      <div class="card">
        ${rows.length || autos.length ? `<div class="list">
          ${rows.map((g) => `<div class="row">${catIcon(g.code)}<div class="row-main"><div class="row-title">${esc(catName(g.code))}</div><div class="row-sub">${g.n} รายการ</div></div>
            <div class="row-end"><span class="amount">${money(g.amt)}</span></div></div>`).join('')}
          ${autos.map((a) => `<div class="row">${catIcon(a.category)}<div class="row-main"><div class="row-title">${esc(catName(a.category))}</div><div class="row-sub">ค่าเหมาจ่ายรายเดือน · ระบบเติมให้</div></div>
            <div class="row-end"><span class="amount">${money(a.amount)}</span><span class="badge b-info plain">อัตโนมัติ</span></div></div>`).join('')}
        </div>` : empty({ ic: 'receipt', title: 'ไม่มีรายการที่อนุมัติแล้วในช่วงนี้', sub: 'ลองขยายช่วงวัน หรือรอให้บิลได้รับอนุมัติก่อน' })}
        <div class="card-foot flex between"><span class="text-sm muted">${esc(pv.periodStartTH)} – ${esc(pv.periodEndTH)} · ${pv.count} รายการ</span>
          <span class="callout-amount"><span class="v">${money(pv.total)}</span><span class="muted">บาท</span></span></div>
      </div>
      ${alText ? `<p class="hint">ค่าเหมาจ่ายประจำของคุณ: ${esc(alText)} บาท — ระบบเติมให้เมื่อไม่ได้ส่งหมวดนั้นเองในรอบนี้</p>` : ''}
      ${pv.pendingCount ? `<p class="hint"><a href="#/requests">ดูรายการที่รออนุมัติ ${icon('chevron-right', 'sm')}</a></p>` : ''}
    </div>`;
  }

  const runPreview = debounce(async () => {
    if (!st.start || !st.end) { st.pv = null; st.pvErr = 'กรุณาเลือกวันเริ่มและวันสิ้นสุด'; paintPreview(); return; }
    if (st.end < st.start) { st.pv = null; st.pvErr = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'; paintPreview(); return; }
    const seq = ++st.pvSeq;
    st.pvLoading = true; st.pvErr = ''; paintPreview();
    try {
      const pv = await api.rpc('preview_period', { p_staff_email: me(), p_start: st.start, p_end: st.end });
      if (seq !== st.pvSeq || !ctx.alive()) return;
      st.pv = pv;
    } catch (e) { if (seq === st.pvSeq) { st.pv = null; st.pvErr = e.message; } }
    if (seq !== st.pvSeq || !ctx.alive()) return;
    st.pvLoading = false;
    paintPreview();
  }, 300);

  function paintHist() {
    const box = $('pf-hist'); if (!box) return;
    const list = st.exports || [];
    box.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('clock')} ประวัติการขอเบิก</h3>${list.length ? `<span class="muted text-sm">${list.length} รอบ</span>` : ''}</div>
      ${list.length ? `<div class="pad stack-sm">${list.map((e) => exportCard(e)).join('')}</div>`
        : empty({ ic: 'calendar', title: 'ยังไม่เคยขอเบิกรายเดือน', sub: 'เมื่อบิลอนุมัติครบ เลือกเดือนด้านบนแล้วกด “ส่งขออนุมัติ”' })}</div>`;
  }

  async function loadExports() {
    try {
      await api.load('get_my_export_requests', {}, (d) => {
        st.exports = d || [];
        if (!ctx.alive()) return;
        paintHist();
        if (st.info) paintClaim();
      });
    } catch (e) {
      if (!ctx.alive()) return;
      st.exports = st.exports || [];
      $('pf-hist').innerHTML = `<div class="card"><div class="pad"><div class="alert bad">${icon('alert')}<div>${esc(e.message)}</div></div></div></div>`;
    }
  }

  async function act(t) {
    const a = t.dataset.act;
    try {
      if (a === 'sign') return openSignSheet();
      if (a === 'logout') {
        if (!(await confirmBox({ title: 'ออกจากระบบ', message: 'ต้องการออกจากระบบใช่ไหม', ok: 'ออกจากระบบ' }))) return;
        await auth.logout();
        location.hash = '#/login';
        location.reload();
        return;
      }
      if (a === 'reset-range' && st.info) {
        st.start = st.info.expectedStart; st.end = st.info.suggestedEnd > st.info.maxEnd ? st.info.maxEnd : st.info.suggestedEnd;
        el.querySelector('#pf-s').value = st.start; el.querySelector('#pf-e').value = st.end;
        runPreview(); return;
      }
      if (a === 'draft') {
        const meta = await withBtn(t, () => api.excel({ type: 'staff_form', kind: 'draft', staffEmail: me(), year: st.y, month: st.m, periodStart: st.start, periodEnd: st.end }));
        if (meta) toast(`ดาวน์โหลดร่างแล้ว · ${meta.filename}`);
        return;
      }
      if (a === 'final') {
        const meta = await withBtn(t, () => api.excel({ type: 'staff_form', kind: 'final', exportId: t.dataset.id }));
        if (meta?.drift) toast(`ยอดปัจจุบันต่างจากตอนอนุมัติ (อนุมัติ ${money(meta.drift.approvedTotal)} · ตอนนี้ ${money(meta.drift.currentTotal)})`, 'info');
        else if (meta) toast(`ดาวน์โหลดแล้ว · ${meta.filename}`);
        return;
      }
      if (a === 'request') {
        const pv = st.pv; if (!pv) return;
        const warn = (pv.warnings || []).length ? `\n\nคำเตือน:\n${pv.warnings.join('\n')}` : '';
        const ok = await confirmBox({ title: `ส่งขออนุมัติรอบ ${monthLabel(st.y, st.m, true)}`,
          message: `${pv.periodStartTH} – ${pv.periodEndTH}\n${pv.count} รายการ · ${money(pv.total)} บาท${warn}`, ok: 'ส่งขออนุมัติ' });
        if (!ok) return;
        const res = await busy('กำลังส่งขออนุมัติ…', () => api.rpc('request_export_approval', { p_staff_email: me(), p_year: st.y, p_month: st.m, p_start: st.start, p_end: st.end }));
        toast(res.auto ? 'อนุมัติอัตโนมัติแล้ว — ดาวน์โหลดฟอร์มตัวจริงได้เลย' : 'ส่งขออนุมัติแล้ว — รอผู้อนุมัติ');
        ctx.refreshBadges();
        await loadExports();
        if (ctx.alive()) paintClaim();
      }
    } catch (e) { toastError(e); }
  }

  if (!petty) {
    // โหลดพร้อมกัน: ประวัติ + ข้อมูลรอบ + ค่าเหมาจ่าย
    api.rpc('get_my_allowance', {}, { ttl: 600 }).then((a) => { st.allowance = a; if (ctx.alive() && st.pv) paintPreview(); }).catch(() => {});
    await Promise.all([loadExports(), loadPeriod()]);
  }
  await sigJob;

  const offs = [
    on(el, 'click', '[data-act]', (e, t) => act(t)),
    on(el, 'click', '[data-mprev],[data-mnext]', (e, t) => {
      const [y, m] = shiftMonth(st.y, st.m, t.hasAttribute('data-mprev') ? -1 : 1);
      if (y * 12 + m > curY * 12 + curM) { toast('ยังไม่ถึงเดือนนี้', 'info'); return; }
      st.y = y; st.m = m;
      loadPeriod();
    }),
    on(el, 'change', '#pf-s,#pf-e', (e, t) => {
      if (t.id === 'pf-s') st.start = t.value; else st.end = t.value;
      runPreview();
    }),
  ];
  return () => offs.forEach((f) => f());
}

// การ์ดโปรไฟล์
function paintProfile(ctx, box) {
  const p = ctx.profile || {};
  const kv = [['อีเมล', p.email], ['แผนก', p.department], ['ทีม', p.team], ['ตำแหน่ง', p.position], ['หัวหน้า', p.managerFullName || p.manager]].filter(([, v]) => v);
  box.innerHTML = `<div class="card pad">
    <div class="flex gap-12">
      <span class="avatar lg brand">${esc(initials(p.name))}</span>
      <div class="grow"><div class="text-lg bold">${esc(p.fullName || p.name)}</div>
        <div class="muted text-sm">${esc(p.name)}${p.position ? ' · ' + esc(p.position) : ''}</div>
        <div class="flex wrap mt-4"><span class="badge b-brand plain">${esc(roleLabel(p.role))}</span>${p.department ? `<span class="badge plain">${esc(p.department)}</span>` : ''}${p.isPettyHolder ? '<span class="badge b-teal plain">ผู้ถือเงินสดย่อย</span>' : ''}</div></div>
    </div>
    <div class="divider"></div>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  </div>`;
}

function paintAccount(box, petty) {
  box.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('lock')} บัญชีผู้ใช้</h3></div>
    <div class="pad stack-sm">
      <p class="text-sm muted">ลืมรหัสผ่าน? ออกจากระบบแล้วกด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบ${petty ? '' : ' · สลับไประบบเงินสดย่อยได้จากเมนูบัญชีมุมขวาบน'}</p>
      <button class="btn btn-secondary btn-block" data-act="logout">${icon('logout')} ออกจากระบบ</button>
    </div></div>`;
}

// การ์ดใบขอเบิกรายเดือน 1 รอบ (ใช้ทั้งรอบปัจจุบันและประวัติ)
function exportCard(e) {
  const stage = exportStage(e);
  const steps = [['ขอเบิก', stage !== 'none'], ['อนุมัติ', stage === 'approved' || stage === 'paid'], ['โอนแล้ว', stage === 'paid']];
  const nowIdx = steps.findIndex((s) => !s[1]);
  const badge = { waiting: statusBadge('Pending', 'รออนุมัติ'), approved: statusBadge('Approved', 'อนุมัติแล้ว · รอโอน'), paid: statusBadge('Paid', 'โอนแล้ว'), rejected: statusBadge('Rejected') }[stage] || '';
  const kv = [
    ['ช่วงบิล', e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)}` : '-'],
    ['รายการ', `${money(e.item_count, 0)} รายการ`],
    ['ผู้อนุมัติ', e.approver_name || e.approver_email || 'อัตโนมัติ'],
    ['ส่งเมื่อ', fmtDateTime(e.requested_at)],
  ];
  if (stage === 'approved' || stage === 'rejected') kv.push([stage === 'approved' ? 'อนุมัติเมื่อ' : 'ตัดสินเมื่อ', fmtDateTime(e.decided_at)]);
  if (stage === 'paid') kv.push(['โอนเมื่อ', `${fmtDateTime(e.paid_at)}${e.paid_by_name ? ' · ' + e.paid_by_name : ''}`]);
  return `<div class="item-card">
    <div class="ic-head"><span class="row-icon ${stage === 'paid' ? 'c-teal' : stage === 'approved' ? 'c-green' : stage === 'rejected' ? 'c-red' : 'c-amber'}">${icon(stage === 'paid' ? 'banknote' : stage === 'rejected' ? 'x-circle' : 'calendar')}</span>
      <div class="grow"><div class="bold">รอบ ${esc(monthLabel(e.year, e.month, true))}</div><div class="amount">${money(e.total_amount)} บาท</div></div>${badge}</div>
    <div class="ic-body stack-sm">
      <div class="steps">${steps.map(([l, ok], i) => {
        const fail = stage === 'rejected' && i === 1;
        return `<div class="st ${fail ? 'fail' : ok ? 'done' : stage !== 'rejected' && i === nowIdx ? 'now' : ''}"><span class="dot">${fail ? icon('x') : ok ? icon('check') : ''}</span>${fail ? 'ไม่อนุมัติ' : l}</div>`;
      }).join('')}</div>
      ${stage === 'rejected' ? `<div class="alert bad">${icon('alert')}<div><b>เหตุผล:</b> ${esc(e.approver_remark || 'ไม่ได้ระบุ')}</div></div>` : ''}
      ${stage === 'approved' && e.approver_remark ? `<p class="hint">${esc(e.approver_remark)}</p>` : ''}
      <dl class="kv tight">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${stage === 'approved' || stage === 'paid' ? `<button class="btn btn-secondary btn-block" data-act="final" data-id="${esc(e.id)}" data-busy="กำลังสร้างไฟล์…">${icon('download')} ดาวน์โหลดฟอร์มตัวจริง</button>` : ''}
      ${stage === 'waiting' ? `<p class="hint">รอ ${esc(e.approver_name || 'ผู้อนุมัติ')} อนุมัติ — ระบบจะแจ้งเตือนเมื่อมีผล</p>` : ''}
    </div></div>`;
}
