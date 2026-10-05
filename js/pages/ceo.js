// CEO อนุมัติสรุปเบิกจ่ายรายเดือน (บัญชี/GM เปิดดูได้แบบอ่านอย่างเดียว)
import { api, money, fmtDateTime, esc, monthLabel } from '../core.js';
import { icon, toast, toastError, confirmBox, promptBox, sheet, withBtn, empty, errorBox, on } from '../ui.js';

// คอลัมน์ตามใบสรุป (app.summary_col)
const COLS = ['รถ', 'น้ำมัน', 'ทางด่วน/ส่งเอกสาร', 'โทรศัพท์', 'รับรอง', 'กอล์ฟ', 'จอดรถ', 'ค่าเช่าที่พัก', 'โรงแรม', 'เดินทาง', 'เครื่องบิน', 'ต่างประเทศ', 'อื่นๆ'];
const ST = { Pending: ['รออนุมัติ', 'b-pending'], Approved: ['อนุมัติแล้ว', 'b-approved'], Rejected: ['ไม่อนุมัติ', 'b-rejected'] };
const ymLabel = (ym, full = true) => { const [y, m] = String(ym || '').split('-').map(Number); return y && m ? monthLabel(y, m, full) : ym; };
const deptLabel = (d) => (!d || d === '*' ? 'ทุกแผนก' : d);
const badge = (s) => { const [t, c] = ST[s] || [s, 'b-neutral']; return `<span class="badge ${c}">${esc(t)}</span>`; };

export async function render(ctx) {
  const { el } = ctx;
  let data = null;

  async function load() {
    try {
      await api.load('get_summary_approvals', {}, (d) => { data = d; if (ctx.alive()) paint(); });
    } catch (e) { if (ctx.alive()) errorBox(el, e, load); }
  }

  function paint() {
    const pend = data.pending || [], hist = data.history || [];
    const sum = pend.reduce((s, x) => s + (Number(x.total) || 0), 0);
    el.innerHTML = `<div class="stack">
      <section class="hero dark">
        <div style="position:relative;z-index:1"><div class="eyebrow">สรุปเบิกจ่ายรอ${data.isCEO ? 'คุณ' : ' CEO '}อนุมัติ</div><div class="big">${money(sum)}</div></div>
        <div class="hero-stats">
          <div class="hs"><div class="v">${pend.length}</div><div class="l">ใบสรุปรออนุมัติ</div></div>
          <div class="hs"><div class="v">${pend.reduce((s, x) => s + (Number(x.staff_count) || 0), 0)}</div><div class="l">พนักงานในสรุป</div></div>
          <div class="hs"><div class="v">${hist.length}</div><div class="l">ตัดสินแล้ว</div></div>
        </div>
      </section>
      ${data.isCEO ? '' : `<div class="alert neutral">${icon('eye')}<div>ดูอย่างเดียว — เฉพาะ CEO เท่านั้นที่อนุมัติหรือไม่อนุมัติสรุปได้</div></div>`}
      ${pend.length ? pend.map((x) => pendingCard(x, data.isCEO)).join('')
        : `<div class="card">${empty({ ic: 'check-circle', title: 'ไม่มีสรุปรออนุมัติ', sub: 'เมื่อบัญชีส่งสรุปรายเดือน จะแสดงที่นี่และมีแจ้งเตือน' })}</div>`}
      <div class="card"><div class="card-head"><h3>${icon('clock')} ประวัติ</h3>${hist.length ? `<span class="muted text-sm">${hist.length} ใบล่าสุด</span>` : ''}</div>
        ${hist.length ? `<div class="list">${hist.map((x) => `<button class="row" data-act="view" data-id="${esc(x.id)}">
            <span class="row-icon ${x.status === 'Approved' ? 'c-green' : 'c-red'}">${icon(x.status === 'Approved' ? 'check' : 'x')}</span>
            <div class="row-main"><div class="row-title">${esc(ymLabel(x.ym))} · ${esc(deptLabel(x.department))}</div>
              <div class="row-sub">${money(x.staff_count, 0)} คน · ${x.ceo_at ? 'ตัดสิน ' + fmtDateTime(x.ceo_at) : ''}${x.ceo_remark ? ' · ' + esc(x.ceo_remark) : ''}</div></div>
            <div class="row-end"><span class="amount">${money(x.total)}</span>${badge(x.status)}</div></button>`).join('')}</div>`
          : empty({ ic: 'clock', title: 'ยังไม่มีประวัติ' })}</div>
    </div>`;
  }

  async function act(t) {
    const id = t.dataset.id;
    const x = [...(data?.pending || []), ...(data?.history || [])].find((s) => s.id === id);
    try {
      if (t.dataset.act === 'view' && x) {
        sheet({ title: `${ymLabel(x.ym)} · ${deptLabel(x.department)}`, wide: true,
          body: `<div class="stack-sm"><div class="flex between wrap">${badge(x.status)}<span class="amount">${money(x.total)} บาท</span></div>
            ${x.ceo_remark ? `<div class="alert ${x.status === 'Rejected' ? 'bad' : 'ok'}">${icon('info')}<div>${esc(x.ceo_remark)}</div></div>` : ''}
            ${snapshot(x.snapshot || [])}</div>`,
          foot: `<button class="btn btn-secondary" data-x>ปิด</button>` });
        return;
      }
      if (t.dataset.act === 'xls' && x) {
        const meta = await withBtn(t, () => api.excel({ type: 'staff_summary', ym: x.ym, dept: x.department || '*' }));
        if (meta) toast(`ดาวน์โหลดแล้ว · ${meta.filename}`);
        return;
      }
      if (t.dataset.act === 'approve' && x) {
        if (!(await confirmBox({ title: 'อนุมัติสรุปเบิกจ่าย', message: `${ymLabel(x.ym)} · ${deptLabel(x.department)}\n${x.staff_count} คน · ${money(x.total)} บาท\nฝ่ายบัญชีจะได้รับแจ้งทันที`, ok: 'อนุมัติ' }))) return;
        await withBtn(t, () => api.rpc('decide_summary', { p_id: id, p_decision: 'Approved', p_remark: '' }));
        toast('อนุมัติแล้ว');
      } else if (t.dataset.act === 'reject' && x) {
        const why = await promptBox({ title: 'ไม่อนุมัติสรุปนี้', label: 'เหตุผล (ฝ่ายบัญชีจะเห็น)', required: true, ok: 'ไม่อนุมัติ', danger: true });
        if (why == null) return;
        await api.rpc('decide_summary', { p_id: id, p_decision: 'Rejected', p_remark: why });
        toast('บันทึกแล้ว');
      } else return;
      ctx.refreshBadges();
      await load();
    } catch (e) { toastError(e); }
  }

  await load();
  return on(el, 'click', '[data-act]', (e, t) => act(t));
}

function pendingCard(x, isCEO) {
  return `<div class="card">
    <div class="card-head"><h3>${icon('crown')} ${esc(ymLabel(x.ym))} · ${esc(deptLabel(x.department))}</h3>${badge(x.status)}</div>
    <div class="pad stack-sm">
      <div class="flex between wrap">
        <dl class="kv tight grow kv-min">
          <dt>ส่งโดย</dt><dd>${esc(x.requested_by || '-')}</dd>
          <dt>ส่งเมื่อ</dt><dd>${fmtDateTime(x.requested_at)}</dd>
          <dt>จำนวนคน</dt><dd>${money(x.staff_count, 0)} คน</dd>
        </dl>
        <div class="callout-amount"><span class="v">${money(x.total)}</span><span class="muted">บาท</span></div>
      </div>
      ${snapshot(x.snapshot || [])}
    </div>
    <div class="card-foot"><div class="btn-row">
      <button class="btn btn-secondary" data-act="xls" data-id="${esc(x.id)}" data-busy="กำลังสร้างไฟล์…">${icon('download')} Excel</button>
      ${isCEO ? `<button class="btn btn-danger" data-act="reject" data-id="${esc(x.id)}">${icon('x')} ไม่อนุมัติ</button>
      <button class="btn btn-success" data-act="approve" data-id="${esc(x.id)}">${icon('check')} อนุมัติ</button>` : ''}
    </div></div>
  </div>`;
}

// ตารางรายคน: จอใหญ่ = ตาราง (เฉพาะหมวดที่มียอด) · มือถือ = รายการ
function snapshot(rows) {
  if (!rows.length) return '<p class="hint">ไม่มีรายละเอียดรายคน</p>';
  const used = COLS.map((_, i) => i).filter((i) => rows.some((r) => Number((r.amounts || [])[i]) > 0));
  const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const colSum = (i) => rows.reduce((s, r) => s + (Number((r.amounts || [])[i]) || 0), 0);
  return `<div class="table-wrap hide-mobile"><table class="tbl">
      <thead><tr><th class="sticky-col">พนักงาน</th><th>แผนก</th>${used.map((i) => `<th class="r">${COLS[i]}</th>`).join('')}<th class="r">รวม</th><th>สถานะ</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="sticky-col">${esc(r.name)}</td><td>${esc(r.dept || '-')}</td>
        ${used.map((i) => `<td class="r">${Number(r.amounts[i]) ? money(r.amounts[i]) : '<span class="faint">-</span>'}</td>`).join('')}
        <td class="r bold">${money(r.total)}</td><td class="nowrap">${esc(r.status || '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td class="sticky-col">รวม ${rows.length} คน</td><td></td>${used.map((i) => `<td class="r">${money(colSum(i))}</td>`).join('')}<td class="r">${money(total)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="card hide-desktop"><div class="list">${rows.map((r) => {
      const top = used.filter((i) => Number(r.amounts[i]) > 0).sort((a, b) => r.amounts[b] - r.amounts[a]).slice(0, 3).map((i) => `${COLS[i]} ${money(r.amounts[i], 0)}`).join(' · ');
      return `<div class="row"><div class="row-main"><div class="row-title">${esc(r.name)}</div><div class="row-sub">${esc(r.dept || '-')}${top ? ' · ' + esc(top) : ''}</div></div>
        <div class="row-end"><span class="amount">${money(r.total)}</span><span class="text-xs muted">${esc(r.status || '')}</span></div></div>`;
    }).join('')}</div></div>`;
}
