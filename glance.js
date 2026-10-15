/* ═══════════════════════════════════════════════════════════════
   Rentveiw · glance.js
   "At a glance" diagrams that fit any screen without scrolling sideways:
   · Building board  — one colour-coded tile per room (paid / unpaid / overdue / vacant…)
   · Payment matrix  — rooms × last months, a ✓ / ✕ grid you can read in one look
   · Reading board   — latest water & power reading for every room
   Every state uses a symbol as well as a colour, so it is readable by
   colour-blind users and in bright sunlight. Pure render functions; app.js
   calls renderGlance() whenever data changes.
   ═══════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = n => String(n).padStart(2, '0');
const ym = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const short = m => /^\d{4}-\d{2}$/.test(m) ? MONTHS[+m.slice(5) - 1] || m : String(m || '');
const compact = n => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); };
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });

let ctx = null, showAllRows = false;

const STATES = {
  paid:   { sym: '✓', label: 'Paid' },
  due:    { sym: '●', label: 'Unpaid' },
  late:   { sym: '!', label: 'Overdue' },
  none:   { sym: '·', label: 'No bill' },
  vacant: { sym: '–', label: 'Vacant' },
  fix:    { sym: '🔧', label: 'Maintenance' },
};

function roomState(r, d, cur) {
  if (r.status === 'maintenance') return { k: 'fix' };
  if (r.status !== 'occupied') return { k: 'vacant' };
  const bs = d.bills.filter(b => b.roomId === r.id && b.month).sort((a, b) => b.month.localeCompare(a.month));
  const late = bs.find(b => !b.paid && b.month < cur);
  if (late) return { k: 'late', amt: late.total };
  if (!bs.length) return { k: 'none' };
  return bs[0].paid ? { k: 'paid', amt: bs[0].total } : { k: 'due', amt: bs[0].total };
}

function monthsBack(n) {
  const now = new Date(), out = [];
  for (let i = n - 1; i >= 0; i--) out.push(ym(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}
function cellState(bills, roomId, m, cur) {
  const bs = bills.filter(b => b.roomId === roomId && b.month === m);
  if (!bs.length) return 'none';
  if (bs.every(b => b.paid)) return 'paid';
  return m < cur ? 'late' : 'due';
}

/* ── Building board ── */
function paintBoard() {
  const el = $('board-card'); if (!el || !ctx) return;
  const d = ctx.data(), cur = ym(new Date()), rooms = [...d.rooms].sort(byName);
  if (!rooms.length) { el.innerHTML = '<div class="dash-card-title">Building at a glance</div><div class="empty-item">Add rooms to see your building here</div>'; return; }
  const tiles = rooms.map(r => ({ r, s: roomState(r, d, cur) }));
  const counts = {}; tiles.forEach(t => counts[t.s.k] = (counts[t.s.k] || 0) + 1);
  const order = ['paid', 'due', 'late', 'none', 'vacant', 'fix'];
  el.innerHTML = `<div class="dash-card-title">Building at a glance <span class="gl-sub">tap a room to open it</span></div>
    <div class="gl-key">${order.filter(k => counts[k]).map(k => `<span class="gl-chip gl-${k}"><b>${STATES[k].sym}</b>${counts[k]} ${STATES[k].label}</span>`).join('')}</div>
    <div class="gl-board">${tiles.map(({ r, s }) => {
      const tn = d.tenants.find(t => t.roomId === r.id);
      const sub = s.k === 'fix' ? 'Repairs' : s.k === 'vacant' ? 'Vacant' : (tn && tn.name ? String(tn.name).split(' ')[0] : STATES[s.k].label);
      return `<button type="button" class="gl-tile gl-${s.k}" data-room="${esc(r.id)}" aria-label="Room ${esc(r.name)}: ${STATES[s.k].label}${s.amt ? ', KES ' + Math.round(s.amt) : ''}">
        <span class="gl-sym">${STATES[s.k].sym}</span><b>${esc(r.name || '?')}</b><small>${esc(sub)}</small>${s.amt ? `<em>${compact(s.amt)}</em>` : ''}</button>`;
    }).join('')}</div>`;
}

/* ── Payment matrix ── */
function paintMatrix(el, title) {
  if (!el || !ctx) return;
  const d = ctx.data(), cur = ym(new Date());
  const width = el.clientWidth || window.innerWidth, n = width < 330 ? 4 : 6, months = monthsBack(n);
  const rows = [...d.rooms].filter(r => r.status === 'occupied' || d.bills.some(b => b.roomId === r.id && months.includes(b.month))).sort(byName);
  if (!rows.length) { el.innerHTML = `<div class="dash-card-title">${title}</div><div class="empty-item">No billed rooms yet</div>`; return; }
  const LIMIT = 12, shown = showAllRows ? rows : rows.slice(0, LIMIT);
  const cells = shown.map(r => `<button type="button" class="gl-mx-room" data-room="${esc(r.id)}" title="${esc(r.name)}">${esc(r.name || '?')}</button>` +
    months.map(m => { const k = cellState(d.bills, r.id, m, cur); return `<span class="gl-c gl-${k}" role="img" aria-label="${esc(r.name)} ${short(m)}: ${STATES[k].label}" title="${esc(r.name)} · ${short(m)} · ${STATES[k].label}">${STATES[k].sym}</span>`; }).join('')).join('');
  el.innerHTML = `<div class="dash-card-title">${title}</div>
    <div class="gl-mx" style="--cols:${n}"><span></span>${months.map(m => `<span class="gl-mh${m === cur ? ' now' : ''}">${short(m)}</span>`).join('')}${cells}</div>
    <div class="gl-key gl-key-s"><span class="gl-chip gl-paid"><b>✓</b>Paid</span><span class="gl-chip gl-due"><b>●</b>Unpaid</span><span class="gl-chip gl-late"><b>!</b>Overdue</span><span class="gl-chip gl-none"><b>·</b>No bill</span></div>
    ${rows.length > LIMIT ? `<button type="button" class="gl-more" data-more>${showAllRows ? 'Show fewer rooms' : `Show all ${rows.length} rooms`}</button>` : ''}`;
}

/* ── Reading board ── */
function paintReadings() {
  const el = $('reading-board'); if (!el || !ctx) return;
  const d = ctx.data(), rooms = [...d.rooms].sort(byName), last = {};
  d.readings.forEach(x => { if (x.roomId && x.date && (!last[x.roomId] || x.date > last[x.roomId].date)) last[x.roomId] = x; });
  const list = rooms.filter(r => last[r.id]);
  if (!list.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<div class="dash-card-title">Latest readings <span class="gl-sub">per room</span></div>
    <div class="gl-rd">${list.map(r => { const x = last[r.id]; return `<button type="button" class="gl-rd-tile" data-room="${esc(r.id)}">
      <b>${esc(r.name)}</b><span class="w">💧 ${esc(x.water ?? '—')}</span><span class="p">⚡ ${esc(x.power ?? '—')}</span><small>${esc(x.date)}</small></button>`; }).join('')}</div>`;
}

export function renderGlance() {
  try {
    paintBoard();
    paintMatrix($('matrix-card'), 'Payments · last months');
    paintMatrix($('bill-matrix'), 'Payments · last months');
    paintReadings();
  } catch (e) { console.warn('glance render skipped', e); }
}

export function initGlance(c) {
  ctx = c;
  document.addEventListener('click', e => {
    const room = e.target.closest('[data-room]'); if (room && room.closest('.gl-board,.gl-mx,.gl-rd')) { ctx.openRoom(room.dataset.room); return; }
    if (e.target.closest('[data-more]')) { showAllRows = !showAllRows; renderGlance(); }
  });
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderGlance, 200); });
}
