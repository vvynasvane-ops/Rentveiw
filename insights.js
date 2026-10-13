/* ═══════════════════════════════════════════════════════════════
   Rentveiw · insights.js
   Dashboard upgrades (ES module, imported by app.js):
   · Welcome hero with live date & time
   · Building-health score + chart (pie ⇄ bar)
   · This-month collection tracker
   · Lease radar
   · Per-room usage trends
   · Command palette (Ctrl/⌘ + K)
   ═══════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = a => a.reduce((s, x) => s + (x || 0), 0);
const kes = n => 'KES ' + Math.round(n || 0).toLocaleString('en-KE');
const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n));
const monthKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = m => { const p = String(m || '').split('-'); return p.length === 2 && MONTHS[+p[1] - 1] ? MONTHS[+p[1] - 1] + " '" + p[0].slice(2) : String(m || '—'); };
const LS = {
  get: (k, f) => { try { return localStorage.getItem('rr_' + k) || f; } catch (e) { return f; } },
  set: (k, v) => { try { localStorage.setItem('rr_' + k, v); } catch (e) { } }
};

let ctx = null;
let chartSet = LS.get('chartSet', 'occupancy');
let chartView = LS.get('chartView', 'pie');

/* ───────────────────────── Welcome hero ───────────────────────── */
const PERIODS = [
  { key: 'morning', from: 5, to: 12, greet: 'Good morning', sw: 'Habari za asubuhi', icon: '🌅', sky: 'linear-gradient(120deg,#f59e0b 0%,#db2777 58%,#4f46e5 100%)' },
  { key: 'afternoon', from: 12, to: 17, greet: 'Good afternoon', sw: 'Habari za mchana', icon: '☀️', sky: 'linear-gradient(120deg,#0ea5e9 0%,#2563eb 55%,#4338ca 100%)' },
  { key: 'evening', from: 17, to: 20, greet: 'Good evening', sw: 'Habari za jioni', icon: '🌇', sky: 'linear-gradient(120deg,#f97316 0%,#be185d 55%,#4c1d95 100%)' },
  { key: 'night', from: 20, to: 29, greet: 'Good evening', sw: 'Habari za usiku', icon: '🌙', sky: 'linear-gradient(120deg,#0f172a 0%,#312e81 60%,#1e1b4b 100%)' }
];
function period(d = new Date()) {
  const h = d.getHours(), hh = h < 5 ? h + 24 : h;
  const p = PERIODS.find(x => hh >= x.from && hh < x.to) || PERIODS[3];
  if (p.key === 'night' && hh >= 23) return { ...p, greet: 'Working late' };
  return p;
}
function firstName(u) {
  let n = (u && u.displayName) ? u.displayName.trim().split(/\s+/)[0] : ((u && u.email) || '').split('@')[0].split(/[._\-+\d]/)[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'there';
}
function overdueBills(d) { const mk = monthKey(); return d.bills.filter(b => !b.paid && b.month && b.month < mk); }

function paintHero() {
  const el = $('hero'); if (!el || !ctx) return;
  const d = ctx.data(), u = ctx.user(), p = period();
  const unpaid = d.bills.filter(b => !b.paid), od = overdueBills(d);
  let line;
  if (!d.rooms.length) line = 'Add your first room and Rentveiw will start keeping score.';
  else if (od.length) line = `${od.length} bill${od.length > 1 ? 's are' : ' is'} overdue — a gentle reminder could help.`;
  else if (unpaid.length) line = `${unpaid.length} bill${unpaid.length > 1 ? 's are' : ' is'} waiting for payment.`;
  else line = 'Every bill is settled. Enjoy the calm.';
  el.innerHTML = `<div class="hw ${p.key}" style="--sky:${p.sky}">
    <div class="hw-main"><div class="hw-icon" aria-hidden="true">${p.icon}</div>
      <div><h2>${p.greet}, ${esc(u.first)}</h2>
        ${u.cc === '254' ? `<div class="hw-sw">${p.sw}</div>` : ''}
        <p class="hw-line">${line}</p>
        ${u.building ? `<span class="hw-chip">🏢 ${esc(u.building)}</span>` : ''}</div></div>
    <div class="hw-clock" role="timer" aria-label="Current date and time">
      <div class="hw-time"><span id="hw-hm"></span><small id="hw-s"></small></div>
      <div class="hw-date" id="hw-date"></div>
      <div class="hw-month"><i id="hw-mbar"></i></div><div class="hw-mtxt" id="hw-mtxt"></div></div></div>`;
  tick();
}
function tick() {
  const n = new Date(), p2 = x => String(x).padStart(2, '0');
  const hm = $('hw-hm');
  if (hm) {
    hm.textContent = p2(n.getHours()) + ':' + p2(n.getMinutes());
    $('hw-s').textContent = ':' + p2(n.getSeconds());
    $('hw-date').textContent = n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const dim = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate(), left = dim - n.getDate();
    $('hw-mbar').style.width = (n.getDate() / dim * 100).toFixed(1) + '%';
    $('hw-mtxt').textContent = `Day ${n.getDate()} of ${dim} · ${left === 0 ? 'last day of the month' : left + ' day' + (left > 1 ? 's' : '') + ' to month-end'}`;
  }
  const tb = $('topbar-clock');
  if (tb) tb.textContent = n.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + p2(n.getHours()) + ':' + p2(n.getMinutes());
}

/* ───────────────────── Health score + datasets ───────────────────── */
function metrics(d) {
  const n = d.rooms.length, st = s => d.rooms.filter(r => r.status === s).length;
  const occ = st('occupied'), vac = st('vacant'), mnt = st('maintenance');
  const billed = sum(d.bills.map(b => b.total)), paid = sum(d.bills.filter(b => b.paid).map(b => b.total));
  const open = d.complaints.filter(c => c.status !== 'resolved').length;
  const occRate = n ? occ / n : 0, colRate = billed ? paid / billed : 1, issueRate = 1 - Math.min(1, open / Math.max(1, n));
  const score = n ? Math.round(occRate * 35 + colRate * 40 + issueRate * 25) : null;
  return { n, occ, vac, mnt, billed, paid, out: billed - paid, open, occRate, colRate, issueRate, score };
}
function verdict(s) {
  if (s == null) return ['—', '--dim', 'Add rooms to see how the building is doing'];
  if (s >= 85) return ['Thriving', '--green', 'Full rooms, rent flowing, few worries'];
  if (s >= 70) return ['Healthy', '--accent', 'Steady — a little polish would help'];
  if (s >= 50) return ['Needs attention', '--amber', 'Check vacancies, unpaid bills and open issues'];
  return ['At risk', '--red', 'Several areas need your attention'];
}
function dataset(key, d) {
  const m = metrics(d), num = v => String(v);
  if (key === 'collections') return { title: 'Rent collected vs outstanding', unit: 'kes', fmt: kes, items: [['Collected', m.paid, '--green'], ['Outstanding', m.out, '--red']] };
  if (key === 'issues') {
    const c = s => d.complaints.filter(x => (x.status || 'open') === s).length;
    return { title: 'Complaints & maintenance', unit: 'items', fmt: num, items: [['Open', c('open'), '--red'], ['In progress', c('in-progress'), '--amber'], ['Resolved', c('resolved'), '--green']] };
  }
  if (key === 'revenue') {
    const by = {}; d.bills.filter(b => b.paid && b.month).forEach(b => { by[b.month] = (by[b.month] || 0) + (b.total || 0); });
    const pal = ['--accent', '--purple', '--green', '--amber', '--red', '--txt2'];
    const items = Object.keys(by).sort().slice(-6).map((mo, i) => [monthLabel(mo), by[mo], pal[i % pal.length]]);
    return { title: 'Paid revenue by month', unit: 'kes', fmt: kes, items };
  }
  return { title: 'Room occupancy', unit: 'rooms', fmt: num, items: [['Occupied', m.occ, '--green'], ['Vacant', m.vac, '--accent'], ['Maintenance', m.mnt, '--amber']] };
}

function pieSvg(ds, animate) {
  const total = sum(ds.items.map(i => i[1])), C = 2 * Math.PI * 70;
  let segs = '', off = 0;
  const live = ds.items.filter(i => i[1] > 0);
  if (total > 0) live.forEach((it, i) => {
    const len = Math.max(0, it[1] / total * C - (live.length > 1 ? 3 : 0));
    segs += `<circle class="pie-seg" data-seg="${ds.items.indexOf(it)}" cx="100" cy="100" r="70" fill="none" stroke-width="30" style="stroke:var(${it[2]});stroke-dasharray:${animate ? '0 ' + C : len + ' ' + (C - len)};stroke-dashoffset:${-off}" data-len="${len}" data-c="${C}" transform="rotate(-90 100 100)"><title>${esc(it[0])}: ${esc(ds.fmt(it[1]))}</title></circle>`;
    off += it[1] / total * C;
  });
  return `<svg class="pie" viewBox="0 0 200 200" role="img" aria-label="${esc(ds.title)} pie chart">
    <circle cx="100" cy="100" r="70" fill="none" stroke-width="30" style="stroke:var(--border)" opacity="${total > 0 ? .35 : 1}"/>${segs}
    <text id="pie-c1" x="100" y="102" text-anchor="middle" class="pie-n">${total > 0 ? esc(ds.unit === 'kes' ? 'KES ' + compact(total) : total) : '0'}</text>
    <text id="pie-c2" x="100" y="122" text-anchor="middle" class="pie-l">${total > 0 ? 'total' : 'no data yet'}</text></svg>`;
}
function barSvg(ds, animate) {
  const items = ds.items, n = Math.max(1, items.length), W = 360, base = 176, H = 144;
  const slot = (W - 16) / n, bw = Math.min(58, slot * .62), max = Math.max(1, ...items.map(i => i[1]));
  let g = `<line x1="8" x2="${W - 8}" y1="${base - H}" y2="${base - H}" class="grid"/><line x1="8" x2="${W - 8}" y1="${base - H / 2}" y2="${base - H / 2}" class="grid"/><line x1="8" x2="${W - 8}" y1="${base}" y2="${base}" class="axis"/>`;
  items.forEach((it, i) => {
    const h = it[1] / max * H, x = 8 + slot * i + (slot - bw) / 2, lab = String(it[0]);
    g += `<g class="bar-g" data-seg="${i}"><rect class="bar${animate ? ' grow' : ''}" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, it[1] > 0 ? 2 : 0).toFixed(1)}" rx="6" style="fill:var(${it[2]})"><title>${esc(lab)}: ${esc(ds.fmt(it[1]))}</title></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(base - h - 7).toFixed(1)}" text-anchor="middle" class="bar-v">${ds.unit === 'kes' ? compact(it[1]) : it[1]}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${base + 17}" text-anchor="middle" class="bar-l">${esc(lab.length > 11 ? lab.slice(0, 10) + '…' : lab)}</text></g>`;
  });
  return `<svg class="bars" viewBox="0 0 ${W} 200" role="img" aria-label="${esc(ds.title)} bar chart">${g}</svg>`;
}

const SETS = [['occupancy', '🚪 Occupancy'], ['collections', '💰 Collections'], ['issues', '📋 Issues'], ['revenue', '📈 Revenue']];
function paintHealth(animate) {
  const el = $('health-card'); if (!el || !ctx) return;
  const d = ctx.data(), m = metrics(d), ds = dataset(chartSet, d), total = sum(ds.items.map(i => i[1]));
  const [vLabel, vCol, vText] = verdict(m.score), R = 34, C = 2 * Math.PI * R;
  const pct = x => Math.round(x * 100) + '%';
  const legend = ds.items.length ? ds.items.map((it, i) => `<li data-seg="${i}"><i style="background:var(${it[2]})"></i><span>${esc(it[0])}</span><b>${esc(ds.fmt(it[1]))}</b>${total > 0 && chartView === 'pie' ? `<em>${Math.round(it[1] / total * 100)}%</em>` : ''}</li>`).join('') : '<li class="hc-empty">Nothing to show yet</li>';
  const chart = !ds.items.length ? '<div class="hc-nodata">No paid bills yet — revenue will appear here once a bill is marked paid.</div>' : (chartView === 'pie' ? pieSvg(ds, animate) : barSvg(ds, animate));
  el.innerHTML = `<div class="hc-head"><div><div class="dash-card-title" style="margin-bottom:2px">How the building is doing</div><div class="hc-sub">${esc(ds.title)}</div></div>
      <div class="seg" role="group" aria-label="Chart type"><button type="button" data-hview="pie" aria-pressed="${chartView === 'pie'}" class="${chartView === 'pie' ? 'on' : ''}">◔ Pie</button><button type="button" data-hview="bar" aria-pressed="${chartView === 'bar'}" class="${chartView === 'bar' ? 'on' : ''}">▮ Bar</button></div></div>
    <div class="hc-tabs" role="tablist">${SETS.map(s => `<button type="button" role="tab" aria-selected="${chartSet === s[0]}" data-hset="${s[0]}" class="${chartSet === s[0] ? 'on' : ''}">${s[1]}</button>`).join('')}</div>
    <div class="hc-body v-${chartView}"><div class="hc-chart">${chart}</div><ul class="hc-legend">${legend}</ul></div>
    <div class="hc-score"><svg viewBox="0 0 84 84" class="ring" role="img" aria-label="Building health score ${m.score ?? 'not available'}"><circle cx="42" cy="42" r="${R}" fill="none" stroke-width="8" style="stroke:var(--border)"/>
        <circle cx="42" cy="42" r="${R}" fill="none" stroke-width="8" stroke-linecap="round" transform="rotate(-90 42 42)" style="stroke:var(${vCol});stroke-dasharray:${((m.score || 0) / 100 * C).toFixed(1)} ${C.toFixed(1)}"/>
        <text x="42" y="47" text-anchor="middle" class="ring-n">${m.score ?? '—'}</text></svg>
      <div class="hc-verdict"><b style="color:var(${vCol})">${vLabel}</b><span>${vText}</span></div>
      <div class="hc-meters"><div><span>Occupancy</span><i><u style="width:${pct(m.occRate)}"></u></i><b>${pct(m.occRate)}</b></div>
        <div><span>Collection</span><i><u style="width:${pct(m.colRate)}"></u></i><b>${pct(m.colRate)}</b></div>
        <div><span>Issue-free</span><i><u style="width:${pct(m.issueRate)}"></u></i><b>${pct(m.issueRate)}</b></div></div></div>`;
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.pie-seg').forEach(c => { c.style.strokeDasharray = c.dataset.len + ' ' + (c.dataset.c - c.dataset.len); })));
}
function hoverSeg(i, on) {
  const el = $('health-card'); if (!el) return;
  const d = ctx.data(), ds = dataset(chartSet, d), it = ds.items[i], total = sum(ds.items.map(x => x[1]));
  el.querySelectorAll('[data-seg]').forEach(n => n.classList.toggle('dim', on && n.dataset.seg != i));
  const c1 = $('pie-c1'), c2 = $('pie-c2'); if (!c1 || !it) return;
  c1.textContent = on ? (ds.unit === 'kes' ? 'KES ' + compact(it[1]) : it[1]) : (total > 0 ? (ds.unit === 'kes' ? 'KES ' + compact(total) : total) : '0');
  c2.textContent = on ? it[0] : (total > 0 ? 'total' : 'no data yet');
}

/* ─────────────────────── Collection tracker ─────────────────────── */
function paintCollect() {
  const el = $('collect-card'); if (!el || !ctx) return;
  const d = ctx.data(), mk = monthKey();
  const occ = d.rooms.filter(r => r.status === 'occupied');
  const expected = sum(occ.map(r => r.rent)), mb = d.bills.filter(b => b.month === mk);
  const billed = sum(mb.map(b => b.total)), got = sum(mb.filter(b => b.paid).map(b => b.total));
  const target = Math.max(expected, billed, 1), pg = got / target * 100, pb = Math.max(0, billed - got) / target * 100;
  const unbilled = occ.filter(r => !mb.some(b => b.roomId === r.id));
  el.innerHTML = `<div class="dash-card-title">${monthLabel(mk)} collection</div>
    ${!occ.length && !mb.length ? '<div class="empty-item">No occupied rooms yet</div>' : `
    <div class="ct-nums"><b>${kes(got)}</b><span>collected of ${kes(Math.max(expected, billed))} expected</span></div>
    <div class="ct-bar" role="img" aria-label="${Math.round(pg)} percent collected"><i class="g" style="width:${pg.toFixed(1)}%"></i><i class="a" style="width:${pb.toFixed(1)}%"></i></div>
    <div class="ct-key"><span><i class="g"></i>Collected</span><span><i class="a"></i>Billed, unpaid</span><span><i></i>Not billed</span></div>
    ${unbilled.length ? `<div class="ct-unbilled"><span>Not billed yet:</span>${unbilled.slice(0, 8).map(r => `<button type="button" class="chip" onclick="openRoom('${esc(r.id)}')">${esc(r.name)}</button>`).join('')}${unbilled.length > 8 ? `<span>+${unbilled.length - 8} more</span>` : ''}</div>` : '<div class="ct-ok">✓ Every occupied room has a bill this month</div>'}`}`;
}

/* ───────────────────────── Lease radar ───────────────────────── */
function paintLeases() {
  const el = $('lease-card'); if (!el || !ctx) return;
  const d = ctx.data(), today = new Date(); today.setHours(0, 0, 0, 0);
  const rows = d.tenants.filter(t => t.leaseEnd).map(t => {
    const e = new Date(t.leaseEnd + 'T00:00:00'); return { t, days: Math.round((e - today) / 864e5) };
  }).filter(x => !isNaN(x.days) && x.days <= 60).sort((a, b) => a.days - b.days);
  const when = n => n < 0 ? `ended ${-n} day${n < -1 ? 's' : ''} ago` : n === 0 ? 'ends today' : `ends in ${n} day${n > 1 ? 's' : ''}`;
  el.innerHTML = `<div class="dash-card-title">Lease radar <span class="lr-sub">next 60 days</span></div>` + (rows.length ? `<ul class="lr-list">${rows.slice(0, 6).map(({ t, days }) => {
    const room = d.rooms.find(r => r.id === t.roomId);
    return `<li class="${days < 0 ? 'lr-bad' : days <= 14 ? 'lr-soon' : ''}"><span class="lr-who"><b>${esc(t.name)}</b><small>${room ? esc(room.name) : 'No room'} · ${when(days)}</small></span><button type="button" class="btn-xs btn-whatsapp" onclick="nudgeLease('${esc(t.id)}')" title="Message about renewal">💬 Renew?</button></li>`;
  }).join('')}</ul>${rows.length > 6 ? `<div class="lr-more">+${rows.length - 6} more on the Tenants page</div>` : ''}` : '<div class="empty-item">✓ No leases ending soon</div>');
}

export function renderHome() { paintHero(); paintHealth(false); paintCollect(); paintLeases(); }

/* ───────────────────────── Usage trends (room page) ───────────────────────── */
export function usageTrends(roomBills) {
  const rows = roomBills.filter(b => b.month).slice().sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  if (rows.length < 1) return '';
  const mini = (key, label, icon, color, unit) => {
    const vals = rows.map(b => +b[key] || 0), max = Math.max(1, ...vals);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length, last = vals[vals.length - 1], prev = vals.length > 1 ? vals[vals.length - 2] : null;
    const delta = prev == null || prev === 0 ? '' : (() => { const p = Math.round((last - prev) / prev * 100); return `<em class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% vs last month</em>`; })();
    return `<div class="ut-col"><div class="ut-head"><b>${icon} ${label}</b><span>avg ${avg.toFixed(1)} ${unit}</span></div>
      <div class="ut-bars">${rows.map((b, i) => `<div class="ut-b" title="${esc(monthLabel(b.month))}: ${vals[i].toFixed(1)} ${unit}"><u style="height:${Math.max(3, vals[i] / max * 100)}%;background:var(${color})"></u><small>${esc(monthLabel(b.month).split(' ')[0])}</small></div>`).join('')}</div>
      <div class="ut-foot">Latest <b>${last.toFixed(1)} ${unit}</b> ${delta}</div></div>`;
  };
  return `<div class="dash-card ut" style="margin-top:16px"><div class="dash-card-title">Usage trends <span class="lr-sub">last ${rows.length} bill${rows.length > 1 ? 's' : ''}</span></div><div class="ut-grid">${mini('waterUsed', 'Water', '💧', '--accent', 'units')}${mini('powerUsed', 'Power', '⚡', '--amber', 'kWh')}</div></div>`;
}

/* ───────────────────────── Command palette ───────────────────────── */
let cmd = null, cmdItems = [], cmdSel = 0;
const PAGES = [['dashboard', '📊', 'Dashboard'], ['rooms', '🚪', 'Rooms'], ['tenants', '👤', 'Tenants'], ['readings', '🔢', 'Meter readings'], ['billing', '🧾', 'Billing'], ['complaints', '📋', 'Complaints & notes'], ['ai', '🤖', 'AI Assistant']];
function buildCmd() {
  if (cmd) return;
  cmd = document.createElement('div'); cmd.id = 'cmdk'; cmd.setAttribute('role', 'dialog'); cmd.setAttribute('aria-modal', 'true'); cmd.setAttribute('aria-label', 'Search Rentveiw');
  cmd.innerHTML = `<div class="cmd-box"><input id="cmd-in" type="text" placeholder="Search rooms, tenants, bills, complaints… or jump to a page" autocomplete="off" aria-label="Search"/><ul id="cmd-list" role="listbox"></ul><div class="cmd-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div></div>`;
  document.body.appendChild(cmd);
  cmd.addEventListener('mousedown', e => { if (e.target === cmd) closeCmd(); });
  $('cmd-in').addEventListener('input', () => { cmdSel = 0; paintCmd(); });
  $('cmd-in').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdSel = Math.min(cmdItems.length - 1, cmdSel + 1); paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdSel = Math.max(0, cmdSel - 1); paintSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdSel); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
  });
  $('cmd-list').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) runCmd(+li.dataset.i); });
}
function gather(q) {
  const d = ctx.data(), has = (...f) => !q || f.join(' ').toLowerCase().includes(q), out = [];
  const rn = id => (d.rooms.find(r => r.id === id) || {}).name || '';
  const add = (g, icon, title, sub, fn) => out.push({ g, icon, title, sub, fn });
  PAGES.filter(p => has(p[2], 'go to page')).forEach(p => add('Pages', p[1], p[2], 'Go to page', () => ctx.go(p[0])));
  if (!q) [['modal-room', '➕', 'Add a room'], ['modal-tenant', '➕', 'Add a tenant'], ['modal-reading', '➕', 'Add a meter reading'], ['modal-billing', '🧾', 'Generate a bill'], ['modal-complaint', '📝', 'Log a complaint or note']].forEach(a => add('Quick actions', a[1], a[2], 'Action', () => ctx.openNew(a[0])));
  if (!q) add('Quick actions', '💾', 'Download full backup', 'Action', () => window.downloadBackup && window.downloadBackup());
  if (q) {
    d.rooms.filter(r => has(r.name, r.desc, r.floor, r.status)).slice(0, 6).forEach(r => add('Rooms', '🚪', r.name, `${r.status || ''}${r.floor ? ' · Floor ' + r.floor : ''} · ${kes(r.rent)}/mo`, () => ctx.openRoom(r.id)));
    d.tenants.filter(t => has(t.name, t.phone, t.email, t.idNum, rn(t.roomId))).slice(0, 6).forEach(t => add('Tenants', '👤', t.name, `${rn(t.roomId) || 'No room'}${t.phone ? ' · ' + t.phone : ''}`, () => t.roomId ? ctx.openRoom(t.roomId) : ctx.go('tenants')));
    d.bills.filter(b => has(b.month, monthLabel(b.month), rn(b.roomId), b.paid ? 'paid' : 'unpaid')).slice(0, 6).forEach(b => add('Bills', '🧾', `${rn(b.roomId) || 'Room'} · ${monthLabel(b.month)}`, `${kes(b.total)} · ${b.paid ? 'Paid' : 'Unpaid'}`, () => b.roomId ? ctx.openRoom(b.roomId) : ctx.go('billing')));
    d.complaints.filter(c => has(c.subject, c.body, c.type, rn(c.roomId))).slice(0, 6).forEach(c => add('Complaints', '📋', c.subject || '(no subject)', `${rn(c.roomId) || '—'} · ${c.type || ''} · ${c.status || ''}`, () => c.roomId ? ctx.openRoom(c.roomId) : ctx.go('complaints')));
  }
  return out;
}
function paintCmd() {
  const q = $('cmd-in').value.trim().toLowerCase(); cmdItems = gather(q);
  const ul = $('cmd-list'); let last = '', html = '';
  if (!cmdItems.length) html = '<li class="cmd-empty">Nothing found — try a room name, tenant, or month.</li>';
  cmdItems.forEach((it, i) => { if (it.g !== last) { html += `<li class="cmd-group" role="presentation">${esc(it.g)}</li>`; last = it.g; } html += `<li data-i="${i}" role="option" class="${i === cmdSel ? 'sel' : ''}"><span class="ci">${it.icon}</span><span class="ct"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span></li>`; });
  ul.innerHTML = html;
}
function paintSel() { document.querySelectorAll('#cmd-list li[data-i]').forEach(li => { const on = +li.dataset.i === cmdSel; li.classList.toggle('sel', on); if (on) li.scrollIntoView({ block: 'nearest' }); }); }
function runCmd(i) { const it = cmdItems[i]; if (!it) return; closeCmd(); it.fn(); }
export function openCmd() { if (!ctx) return; buildCmd(); cmd.style.display = 'flex'; $('cmd-in').value = ''; cmdSel = 0; paintCmd(); $('cmd-in').focus(); }
function closeCmd() { if (cmd) cmd.style.display = 'none'; }

/* ───────────────────────── Wiring ───────────────────────── */
export function initInsights(c) {
  ctx = c;
  const raw = ctx.user; ctx.user = () => { const u = raw(); return { first: firstName(u.authUser), building: u.building, cc: u.cc }; };
  const hc = $('health-card');
  if (hc) {
    hc.addEventListener('click', e => {
      const v = e.target.closest('[data-hview]'), s = e.target.closest('[data-hset]');
      if (v) { chartView = v.dataset.hview; LS.set('chartView', chartView); paintHealth(true); }
      else if (s) { chartSet = s.dataset.hset; LS.set('chartSet', chartSet); paintHealth(true); }
    });
    hc.addEventListener('mouseover', e => { const t = e.target.closest('[data-seg]'); if (t) hoverSeg(+t.dataset.seg, true); });
    hc.addEventListener('mouseout', e => { const t = e.target.closest('[data-seg]'); if (t) hoverSeg(+t.dataset.seg, false); });
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-cmdk]')) openCmd(); });
  document.addEventListener('keydown', e => {
    const app = $('appShell'); if (!app || app.style.display !== 'flex') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmd && cmd.style.display === 'flex' ? closeCmd() : openCmd(); }
    else if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); openCmd(); }
  });
  setInterval(() => { tick(); const n = new Date(); if (n.getSeconds() === 0 && $('hero') && $('hero').offsetParent) paintHero(); }, 1000);
}
