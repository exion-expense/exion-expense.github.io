// Dashboard ใบสำคัญจ่าย (บัญชี / ผู้บริหาร) — งานค้างแต่ละขั้น · กล่องเงิน · advance · ยอดแยกแผนก/Job · ใบค้างนาน
import { api, money, esc, ymd, todayYMD } from '../core.js?v=10.1.3';
import { icon, bars, empty, errorBox, skeleton, on, $ } from '../ui.js?v=10.1.3';
import { pvRow } from './pv-common.js?v=10.1.3';

const TILES = [['dept', 'รออนุมัติแผนก'], ['fin1', 'รอบัญชี 1'], ['fin2', 'รอบัญชี 2'], ['fin3', 'รอบัญชี 3'], ['pay', 'รอจ่ายเงิน'], ['returned', 'ตีกลับให้แก้']];

export async function render(ctx) {
  const { el } = ctx;
  const now = new Date();
  const st = { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayYMD(), d: null };

  async function load() {
    try {
      st.d = await api.rpc('get_pv_dashboard', { p_from: st.from, p_to: st.to });
      if (ctx.alive()) paint();
    } catch (e) { if (ctx.alive()) errorBox($('[data-body]', el) || el, e, load); }
  }

  function paint() {
    const d = st.d, b = d.balance || {}, a = d.advOpen || {};
    const S = d.stages || {}, SA = d.stageAmounts || {};
    const lim = Number(b.limit) || 0, cash = Number(b.cash) || 0;
    const advPct = lim ? Math.min(100, (Number(a.amount) || 0) / lim * 100) : 0;
    const usedPct = lim ? Math.min(100, Math.max(0, (lim - cash) / lim * 100 - advPct)) : 0;
    $('[data-body]', el).innerHTML = `
      <div class="tiles pv-tiles">${TILES.map(([k, l]) => `<a class="stat ${k === 'returned' ? '' : ''}" href="#/pv?scope=all&stage=${k}">
        <div class="l">${l}</div><div class="v">${S[k] || 0}</div><div class="d">${SA[k] ? money(SA[k], 0) + ' บาท' : '&nbsp;'}</div></a>`).join('')}</div>

      <div class="grid-2">
        <div class="card pad stack-sm">
          <div class="flex between wrap"><b>${icon('wallet', 'sm')} กล่องเงินสด</b><span class="text-sm">${b.fundName ? esc(b.fundName) : ''}</span></div>
          <div class="flex between wrap"><span class="muted text-sm">เงินในกล่อง</span><b class="amount text-lg ${cash < 0 ? 'bad-text' : ''}">${money(cash)} / ${money(lim, 0)}</b></div>
          <div class="meter pv-meter" role="img" aria-label="ใช้ไปแล้วจากวงเงิน"><i style="width:${usedPct}%" class="u"></i><i style="width:${advPct}%" class="a"></i></div>
          <div class="pv-mkey"><span><b class="u"></b>จ่ายแล้ว</span><span><b class="a"></b>Advance ค้าง ${money(a.amount, 0)}</span><span><b></b>คงเหลือ</span></div>
          ${cash < 0 ? `<div class="alert bad">${icon('alert')}<div>เงินในกล่องติดลบ — เคลียร์บิล / เติมเงินที่หน้า <a href="#/petty/fund">กล่องเงินสด</a></div></div>` : ''}
        </div>
        <div class="card pad stack-sm">
          <b>${icon('utensils', 'sm')} Advance ที่ยังไม่เคลียร์</b>
          <div class="grid-2"><div class="stat"><div class="l">ยังไม่เคลียร์</div><div class="v">${a.count || 0}</div><div class="d">${money(a.amount, 0)} บาท</div></div>
            <a class="stat ${a.overdue ? 'pv-alert' : ''}" href="#/pv?scope=all&stage=adv_open"><div class="l">เลยกำหนด</div><div class="v">${a.overdue || 0}</div><div class="d">${money(a.overdueAmount, 0)} บาท</div></a></div>
          <a class="text-sm" href="#/pv?scope=all&stage=adv_check">รอบัญชีตรวจเคลียร์ ${S.adv_check || 0} ใบ ${icon('chevron-right', 'sm')}</a>
        </div>
      </div>

      <div class="grid-2">
        <div class="card pad stack-sm"><div class="flex between"><b>จ่ายแล้วแยกแผนก</b><span class="text-sm">รวม <b class="amount">${money(d.paidTotal, 0)}</b></span></div>
          ${(d.byDept || []).length ? bars(d.byDept.map((x) => ({ label: `${x.department} (${x.count})`, value: x.amount }))) : `<p class="muted text-sm">ยังไม่มีการจ่ายในช่วงนี้</p>`}</div>
        <div class="card pad stack-sm"><b>ยอดตาม Job</b>
          ${(d.byJob || []).length ? `<div class="table-wrap" style="max-height:320px"><table class="tbl"><thead><tr><th>Job No.</th><th class="r">ใบ</th><th class="r">ยอด</th></tr></thead><tbody>
            ${d.byJob.map((x) => `<tr><td><a href="#/pv?scope=all&q=${encodeURIComponent(x.jobNo)}">${esc(x.jobNo)}</a></td><td class="r">${x.count}</td><td class="r">${money(x.amount)}</td></tr>`).join('')}</tbody></table></div>`
            : `<p class="muted text-sm">ยังไม่มีใบที่มี Job ในช่วงนี้</p>`}</div>
      </div>

      <div class="card"><div class="card-head"><b>${icon('clock', 'sm')} ค้างเกิน ${d.staleDays} วัน</b><span class="text-sm muted">${(d.stale || []).length} ใบ</span></div>
        ${(d.stale || []).length ? `<div class="list">${d.stale.map(pvRow).join('')}</div>` : empty({ ic: 'check', title: 'ไม่มีใบค้างนาน' })}</div>`;
  }

  el.innerHTML = `<div class="stack">
    <div class="toolbar" style="margin-bottom:0">
      <div class="field" style="margin:0"><label for="pd-from" class="text-sm">ตั้งแต่</label><input type="date" class="input" id="pd-from" data-from value="${st.from}"></div>
      <div class="field" style="margin:0"><label for="pd-to" class="text-sm">ถึง</label><input type="date" class="input" id="pd-to" data-to value="${st.to}"></div>
      <a class="btn btn-secondary" href="#/pv?scope=all">${icon('list')} ใบทั้งหมด</a>
      <a class="btn btn-secondary" href="#/petty/msbc">${icon('sheet')} MSBC</a>
    </div>
    <div class="stack" data-body>${skeleton(4)}</div></div>`;
  await load();
  const offs = [
    on(el, 'change', '[data-from]', (e, t) => { st.from = t.value; load(); }),
    on(el, 'change', '[data-to]', (e, t) => { st.to = t.value; load(); }),
  ];
  return () => offs.forEach((f) => f());
}
