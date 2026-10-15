/* ═══════════════════════════════════════════════════════════════
   Rentveiw · slip.js
   Builds the tenant payment slip — both the downloadable PDF (jsPDF)
   and the public web statement page. Pure functions: give them a flat
   "meta" object and they return a PDF doc / an HTML string.

   Why this file exists: the old slip wrote "0 → 5" with an arrow glyph
   that jsPDF's built-in Helvetica cannot draw, which produced the
   garbled, overlapping readings. Everything here is drawn with plain
   ASCII text plus vector shapes (arrows, bars, QR), so it can never
   garble, whatever the tenant or building name contains.
   ═══════════════════════════════════════════════════════════════ */

// ── tiny helpers ─────────────────────────────────────────────────────────
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const money = v => {
  const [i, d] = n(v).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + d;
};
const qty = v => n(v).toFixed(2);
const rd  = v => { const x = n(v); return Number.isInteger(x) ? String(x) : String(+x.toFixed(2)); };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const isYM = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
export const monthLabel = ym => isYM(ym) ? `${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}` : (ym || '-');
const monthShort = ym => isYM(ym) ? MONTHS[+ym.slice(5) - 1] : (ym || '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Keep only characters Helvetica (WinAnsi) can really draw.
export function pdfSafe(s) {
  return String(s ?? '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2192/g, '->').replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2007\u2009\u200A\u202F]/g, ' ')
    .replace(/[^\x20-\x7E\u00A1-\u00FF]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ── data helpers (used by app.js to assemble the meta object) ───────────
export function makeSlipNo(bill, roomName) {
  const ym  = String(bill.month || '').replace(/\D/g, '');
  const rm  = pdfSafe(roomName || 'RM').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'RM';
  const tag = String(bill.id || '').slice(-4).toUpperCase() || '0000';
  return `RV-${ym}-${rm}-${tag}`;
}

// Last few months of usage for one room, oldest -> newest, current bill last.
export function usageHistory(allBills, bill, max = 5) {
  if (!bill || !bill.month) return [];
  const map = new Map();
  (allBills || []).filter(x => x.roomId === bill.roomId && x.month && x.month <= bill.month)
                  .forEach(x => map.set(x.month, x));
  map.set(bill.month, bill);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-max)
    .map(([m, x]) => ({ m, w: +n(x.waterUsed).toFixed(2), p: +n(x.powerUsed).toFixed(2) }));
}

export function trend(cur, prev) {
  cur = n(cur); prev = n(prev);
  if (prev <= 0) return { dir: cur > 0 ? 'new' : 'flat', pct: 0 };
  const pct = (cur - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return { dir: 'flat', pct: 0 };
  return { dir: pct > 0 ? 'up' : 'down', pct };
}
const trendWords = (t, prevLabel) =>
  t.dir === 'up'   ? `Up ${Math.round(t.pct)}% vs ${prevLabel}` :
  t.dir === 'down' ? `Down ${Math.round(Math.abs(t.pct))}% vs ${prevLabel}` :
  t.dir === 'new'  ? `No usage in ${prevLabel}` : `Same as ${prevLabel}`;

// The "how to pay" steps, shared by the PDF and the web page.
export function paySteps(meta) {
  const p = meta.pay || {}, amt = `KES ${money(meta.total)}`;
  const ref = p.mpesaAccount || meta.roomName || 'your room';
  const steps = [];
  const num = String(p.mpesaNumber || '').trim();
  if (num && p.mpesaType === 'paybill')
    steps.push({ lead: 'Pay by M-Pesa Paybill', text: `Open M-Pesa, choose Lipa na M-Pesa, then Pay Bill. Business number: ${num}. Account number: ${ref}.` });
  else if (num && p.mpesaType === 'till')
    steps.push({ lead: 'Pay by M-Pesa Till', text: `Open M-Pesa, choose Lipa na M-Pesa, then Buy Goods and Services. Till number: ${num}.` });
  else if (num && p.mpesaType === 'send')
    steps.push({ lead: 'Pay by M-Pesa Send Money', text: `Open M-Pesa, choose Send Money. Phone number: ${num}.` });
  if (p.bankName || p.bankAccountNo)
    steps.push({ lead: 'Or pay by bank transfer', text: `${p.bankName ? 'Bank: ' + p.bankName + '. ' : ''}${p.bankAccountName ? 'Account name: ' + p.bankAccountName + '. ' : ''}${p.bankAccountNo ? 'Account number: ' + p.bankAccountNo + '. ' : ''}Use ${meta.slipNo || ref} as the reference.` });
  if (!steps.length)
    steps.push({ lead: 'Pay your landlord', text: `Use the payment method you agreed with your landlord and quote ${ref} as the reference.` });
  steps.push({ lead: 'Enter the amount and keep your proof', text: `Pay exactly ${amt} for ${monthLabel(meta.month)}. Save the confirmation message as your proof of payment.${p.note ? ' ' + p.note : ''}` });
  return steps;
}

// ── QR (vector, so the PDF stays tiny) ───────────────────────────────────
function drawQr(doc, text, x, y, size, ink) {
  try {
    if (typeof globalThis.qrcode !== 'function' || !text) return false;
    const qr = globalThis.qrcode(0, 'M'); qr.addData(String(text)); qr.make();
    const cnt = qr.getModuleCount(), quiet = 2, cell = size / (cnt + quiet * 2);
    doc.setFillColor(255, 255, 255); doc.rect(x, y, size, size, 'F');
    doc.setFillColor(...ink);
    for (let r = 0; r < cnt; r++) for (let c = 0; c < cnt; c++)
      if (qr.isDark(r, c)) doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.2, cell + 0.2, 'F');
    return true;
  } catch (e) { console.warn('QR skipped', e); return false; }
}

// ═════════════════════════════════════════════════════════════════════════
//  PDF
// ═════════════════════════════════════════════════════════════════════════
export function buildInvoicePdf(meta) {
  const lib = globalThis.jspdf;
  if (!lib || !lib.jsPDF) throw new Error('The PDF tool did not load — check your internet connection and refresh the page.');
  meta = meta || {};
  const doc = new lib.jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 40, CW = W - 2 * M, BOTTOM = H - 52;

  const INK = [20, 27, 45], MUTE = [100, 109, 128], LINE = [222, 227, 236], SOFT = [244, 246, 251];
  const NAVY = [22, 30, 58], BRAND = [58, 92, 224];
  const WATER = [30, 136, 229], WATER_T = [225, 240, 252], POWER = [226, 140, 8], POWER_T = [254, 243, 219];
  const GREEN = [16, 150, 105], AMBER = [217, 119, 6], RED = [214, 64, 64];

  const fill = c => doc.setFillColor(c[0], c[1], c[2]);
  const strk = c => doc.setDrawColor(c[0], c[1], c[2]);
  const ink  = c => doc.setTextColor(c[0], c[1], c[2]);
  const font = (st, sz) => { doc.setFont('helvetica', st); doc.setFontSize(sz); };
  const T = pdfSafe;
  const put = (s, x, y, o) => doc.text(T(s), x, y, o);
  const fit = (s, w) => {
    s = T(s); if (doc.getTextWidth(s) <= w) return s;
    while (s.length > 1 && doc.getTextWidth(s + '...') > w) s = s.slice(0, -1);
    return s + '...';
  };
  const wrap = (s, w) => doc.splitTextToSize(T(s), w);
  const arrow = (x1, x2, y, c) => {
    strk(c); doc.setLineWidth(1.2); doc.line(x1, y, x2 - 4, y);
    fill(c); doc.triangle(x2, y, x2 - 6, y - 3.5, x2 - 6, y + 3.5, 'F');
  };
  const tri = (x, y, dir, c) => {            // small trend triangle
    fill(c);
    if (dir === 'up')   doc.triangle(x, y - 6, x - 3.5, y, x + 3.5, y, 'F');
    if (dir === 'down') doc.triangle(x, y, x - 3.5, y - 6, x + 3.5, y - 6, 'F');
    if (dir === 'flat') doc.rect(x - 3.5, y - 4, 7, 2, 'F');
    if (dir === 'new')  doc.rect(x - 3.5, y - 4, 7, 2, 'F');
  };
  let y = 0;
  const room = () => meta.roomName || '-';
  const unitsW = 'units', unitsP = 'kWh';

  // ── header band ──
  fill(NAVY); doc.rect(0, 0, W, 80, 'F');
  fill(BRAND); doc.rect(0, 80, W, 3, 'F');
  font('bold', 22); ink([255, 255, 255]); put(fit(meta.buildingName || 'Rentveiw', 330), M, 40);
  font('normal', 9.5); ink([180, 190, 215]); put('OFFICIAL PAYMENT STATEMENT', M, 56);
  font('normal', 8.5); put(`Generated ${meta.generatedAt || new Date().toLocaleString('en-KE')}`, M, 69);
  const paid = !!meta.paid;
  font('bold', 9); const pill = paid ? 'PAID' : 'PENDING', pw = doc.getTextWidth(pill) + 26;
  fill(paid ? GREEN : AMBER); doc.roundedRect(W - M - pw, 18, pw, 20, 10, 10, 'F');
  ink([255, 255, 255]); put(pill, W - M - pw / 2, 31.5, { align: 'center' });
  font('normal', 8.5); ink([180, 190, 215]);
  put(`Statement no. ${meta.slipNo || '-'}`, W - M, 54, { align: 'right' });
  if (meta.issuedBy) put(`Issued by ${fit(meta.issuedBy, 220)}`, W - M, 67, { align: 'right' });
  y = 83 + 20;

  const section = (title, sub) => {
    fill(BRAND); doc.rect(M, y - 9, 3, 12, 'F');
    font('bold', 10.5); ink(INK); const tt = title.toUpperCase(); put(tt, M + 10, y);
    if (sub) { const tw = doc.getTextWidth(tt); font('normal', 8.5); ink(MUTE); put(sub, M + 10 + tw + 8, y); }
    y += 14;
  };
  const room_need = h => { if (y + h > BOTTOM) { doc.addPage(); y = M + 6; } };

  // ── tenant / room card ──
  fill(SOFT); strk(LINE); doc.setLineWidth(0.6); doc.roundedRect(M, y - 6, CW, 58, 4, 4, 'FD');
  const cols = [M + 14, M + 14 + CW / 3, M + 14 + 2 * CW / 3], cw = CW / 3 - 20;
  const cell = (label, value, cx, cy) => {
    font('normal', 7); ink(MUTE); put(label.toUpperCase(), cx, cy);
    font('bold', 10.5); ink(INK); put(fit(value || '-', cw), cx, cy + 13);
  };
  cell('Tenant', meta.tenantName, cols[0], y + 6);   cell('Room', room(), cols[1], y + 6);
  cell('Billing month', monthLabel(meta.month), cols[2], y + 6);
  cell('Phone', meta.tenantPhone, cols[0], y + 33);  cell('Email', meta.tenantEmail, cols[1], y + 33);
  cell('Payment terms', meta.paymentDesc || 'As agreed', cols[2], y + 33);
  y += 68;

  // ── meter readings ──
  room_need(140);
  section('Meter readings', 'what the meters showed this month');
  const cardW = (CW - 14) / 2, cardH = 104;
  const meter = (x, o) => {
    fill([255, 255, 255]); strk(LINE); doc.setLineWidth(0.8); doc.rect(x, y, cardW, cardH, 'FD');
    fill(o.color); doc.rect(x, y, cardW, 20, 'F');
    font('bold', 8.5); ink([255, 255, 255]); put(o.title, x + 10, y + 13.5);
    font('normal', 8); put(`Rate: KES ${money(o.rate)} per ${o.unit === 'units' ? 'unit' : o.unit}`, x + cardW - 10, y + 13.5, { align: 'right' });
    const inner = cardW - 20, gap = 20, bw = (inner - 2 * gap) / 3, by = y + 28, bh = 38;
    const bx = i => x + 10 + i * (bw + gap);
    const box = (i, label, value, tint, vc) => {
      fill(tint); doc.rect(bx(i), by, bw, bh, 'F');
      font('bold', 6.5); ink(MUTE); put(label, bx(i) + bw / 2, by + 11, { align: 'center' });
      font('bold', 13); ink(vc); put(fit(value, bw - 6), bx(i) + bw / 2, by + 28, { align: 'center' });
    };
    box(0, 'PREVIOUS', rd(o.init), SOFT, INK);
    box(1, 'CURRENT', rd(o.fin), SOFT, INK);
    box(2, 'USED', qty(o.used), o.tint, o.color);
    arrow(bx(0) + bw + 3, bx(1) - 3, by + bh / 2, MUTE);
    strk(LINE); doc.setLineWidth(0.8); doc.line(bx(1) + bw + gap / 2, by + 4, bx(1) + bw + gap / 2, by + bh - 4);
    font('normal', 8); ink(MUTE);
    put(fit(`Used = Current - Previous = ${rd(o.fin)} - ${rd(o.init)} = ${qty(o.used)} ${o.unit}`, inner), x + 10, y + 82);
    font('bold', 9); ink(INK);
    put(fit(`${qty(o.used)} ${o.unit} x KES ${money(o.rate)} = KES ${money(o.cost)}`, inner), x + 10, y + 96);
  };
  meter(M, { title: 'WATER METER', unit: unitsW, color: WATER, tint: WATER_T, init: meta.waterInit, fin: meta.waterFinal, used: meta.waterUsed, rate: meta.waterRate, cost: meta.waterCost });
  meter(M + cardW + 14, { title: 'POWER METER', unit: unitsP, color: POWER, tint: POWER_T, init: meta.powerInit, fin: meta.powerFinal, used: meta.powerUsed, rate: meta.powerRate, cost: meta.powerCost });
  y += cardH + 18;

  // ── charges ──
  room_need(150);
  section('Charges', 'what you are paying for');
  fill(NAVY); doc.rect(M, y, CW, 20, 'F');
  font('bold', 9); ink([255, 255, 255]);
  put('Item', M + 10, y + 14); put('How it was worked out', M + 100, y + 14); put('Amount (KES)', W - M - 10, y + 14, { align: 'right' });
  y += 20;
  const rows = [
    ['Rent', 'Fixed monthly rent for ' + monthLabel(meta.month), meta.rent],
    ['Water', `${qty(meta.waterUsed)} ${unitsW} x ${money(meta.waterRate)} per unit`, meta.waterCost],
    ['Power', `${qty(meta.powerUsed)} ${unitsP} x ${money(meta.powerRate)} per ${unitsP}`, meta.powerCost],
  ];
  rows.forEach((r, i) => {
    if (i % 2 === 1) { fill(SOFT); doc.rect(M, y, CW, 21, 'F'); }
    font('bold', 9.5); ink(INK); put(r[0], M + 10, y + 14.5);
    font('normal', 9); ink(MUTE); put(fit(r[1], 280), M + 100, y + 14.5);
    font('normal', 10); ink(INK); put(money(r[2]), W - M - 10, y + 14.5, { align: 'right' });
    y += 21;
  });
  strk(LINE); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);
  y += 8;
  fill(paid ? GREEN : BRAND); doc.roundedRect(M, y, CW, 34, 4, 4, 'F');
  font('bold', 11); ink([255, 255, 255]); put(paid ? 'TOTAL PAID' : 'TOTAL DUE', M + 14, y + 22);
  font('bold', 16); put(`KES ${money(meta.total)}`, W - M - 14, y + 23, { align: 'right' });
  y += 34 + 16;

  // ── how to pay + QR ──
  const hasQr = !!meta.shareUrl && typeof globalThis.qrcode === 'function';
  const QR = 80, colW = hasQr ? CW - QR - 24 : CW;
  const stepsPay = paid ? [{ lead: 'Payment received', text: 'This statement is marked as paid. Thank you! Keep it for your records.' }] : paySteps(meta);
  font('normal', 8.5);
  const laid = stepsPay.map(s => ({ ...s, lines: wrap(s.text, colW - 30) }));
  const payH = laid.reduce((a, s) => a + 11 + s.lines.length * 10 + 7, 0);
  room_need(Math.max(payH, hasQr ? QR + 36 : 0) + 24);
  section(paid ? 'Thank you' : 'How to pay', paid ? '' : 'follow these steps');
  let py = y + 4;
  laid.forEach((s, i) => {
    fill(paid ? GREEN : BRAND); doc.circle(M + 9, py + 5, 8, 'F');
    font('bold', 9); ink([255, 255, 255]); put(paid ? 'OK' : String(i + 1), M + 9, py + 8, { align: 'center' });
    font('bold', 9.5); ink(INK); put(s.lead, M + 28, py + 8);
    font('normal', 8.5); ink(MUTE); doc.text(s.lines, M + 28, py + 19);
    py += 11 + s.lines.length * 10 + 7;
  });
  if (hasQr) {
    const qx = W - M - QR;
    fill(SOFT); strk(LINE); doc.setLineWidth(0.6); doc.roundedRect(qx - 8, y - 2, QR + 16, QR + 32, 4, 4, 'FD');
    drawQr(doc, meta.shareUrl, qx, y + 2, QR, INK);
    font('bold', 7.5); ink(INK); put('SCAN TO VIEW ONLINE', qx + QR / 2, y + QR + 13, { align: 'center' });
    font('normal', 6.8); ink(MUTE); put('Opens on your phone', qx + QR / 2, y + QR + 23, { align: 'center' });
  }
  y = Math.max(py, hasQr ? y + QR + 34 : py) + 4;

  // ── how it was worked out ──
  room_need(80);
  section('How your bill is worked out', 'three simple steps');
  const sw = (CW - 28) / 3;
  const steps3 = [
    ['Read the meters', 'The water and power meters are read at the start and end of the month. See the readings above.'],
    ['Find the units used', `Units = Current - Previous. Water: ${rd(meta.waterFinal)} - ${rd(meta.waterInit)} = ${qty(meta.waterUsed)}. Power: ${rd(meta.powerFinal)} - ${rd(meta.powerInit)} = ${qty(meta.powerUsed)}.`],
    ['Multiply, then add', `Charge = units x rate. Rent ${money(meta.rent)} + Water ${money(meta.waterCost)} + Power ${money(meta.powerCost)} = ${money(meta.total)}.`],
  ];
  let stepsH = 0;
  steps3.forEach((s, i) => {
    const x = M + i * (sw + 14);
    fill(BRAND); doc.circle(x + 9, y + 7, 8, 'F');
    font('bold', 9); ink([255, 255, 255]); put(String(i + 1), x + 9, y + 10, { align: 'center' });
    font('bold', 9.5); ink(INK); put(s[0], x + 24, y + 10);
    font('normal', 8.2); ink(MUTE);
    const lines = wrap(s[1], sw - 4); doc.text(lines, x + 2, y + 25);
    stepsH = Math.max(stepsH, 25 + lines.length * 10);
  });
  y += stepsH + 8;

  // ── usage trend ──
  const hist = Array.isArray(meta.history) ? meta.history.filter(h => h && h.m) : [];
  if (Array.isArray(meta.history)) room_need(100);
  if (!Array.isArray(meta.history)) { /* older shared slip without history: skip the section */ }
  else section('Usage trend', 'compared with your previous months');
  if (!Array.isArray(meta.history)) { /* nothing to draw */ }
  else if (hist.length < 2) {
    fill(SOFT); doc.roundedRect(M, y - 4, CW, 34, 4, 4, 'F');
    font('normal', 9); ink(MUTE); put('This is your first statement on record. From next month you will see how your usage compares here.', M + 14, y + 17);
    y += 34 + 14;
  } else {
    const prev = hist[hist.length - 2], cur = hist[hist.length - 1];
    const chart = (x, o) => {
      fill([255, 255, 255]); strk(LINE); doc.setLineWidth(0.8); doc.rect(x, y - 4, cardW, 88, 'FD');
      font('bold', 8.5); ink(INK); put(o.title, x + 10, y + 9);
      const t = trend(o.series[o.series.length - 1], o.series[o.series.length - 2]);
      const tc = t.dir === 'up' ? RED : t.dir === 'down' ? GREEN : MUTE;
      font('normal', 7.5); ink(tc);
      const words = trendWords(t, monthShort(prev.m) + (prev.m.slice(0, 4) !== cur.m.slice(0, 4) ? ' ' + prev.m.slice(0, 4) : ''));
      put(fit(words, cardW - 60), x + cardW - 10, y + 9, { align: 'right' });
      tri(x + cardW - 10 - doc.getTextWidth(fit(words, cardW - 60)) - 8, y + 9, t.dir, tc);
      const max = Math.max(...o.series, 0.0001), baseY = y + 67, maxH = 34;
      const k = o.series.length, bw = Math.min(30, (cardW - 40) / k - 10), span = bw + 12;
      const x0 = x + (cardW - (k * span - 12)) / 2;
      o.series.forEach((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0.6, v / max * maxH), bx = x0 + i * span, last = i === k - 1;
        fill(last ? o.color : o.tint); doc.rect(bx, baseY - h, bw, h, 'F');
        font(last ? 'bold' : 'normal', 7); ink(last ? INK : MUTE);
        put(qty(v), bx + bw / 2, baseY - h - 3, { align: 'center' });
        font('normal', 7); ink(MUTE); put(monthShort(hist[i].m), bx + bw / 2, baseY + 9, { align: 'center' });
      });
      strk(LINE); doc.setLineWidth(0.6); doc.line(x + 10, baseY, x + cardW - 10, baseY);
    };
    chart(M, { title: 'Water used (units)', color: WATER, tint: [170, 210, 245], series: hist.map(h => n(h.w)) });
    chart(M + cardW + 14, { title: 'Power used (kWh)', color: POWER, tint: [247, 205, 130], series: hist.map(h => n(h.p)) });
    y += 88 + 12;
  }

  // ── footers on every page ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    strk(LINE); doc.setLineWidth(0.6); doc.line(M, H - 44, W - M, H - 44);
    font('normal', 7.5); ink([140, 148, 165]);
    put(fit(`${meta.buildingName || 'Rentveiw'} - Generated automatically via Rentveiw - This is a system-generated statement.`, CW - 70), M, H - 30);
    put(`Page ${p} of ${pages}`, W - M, H - 30, { align: 'right' });
  }
  return doc;
}

// ═════════════════════════════════════════════════════════════════════════
//  Public web page (the tenant opens this from the SMS / WhatsApp link)
// ═════════════════════════════════════════════════════════════════════════
export function slipPageHtml(meta) {
  meta = meta || {};
  const paid = !!meta.paid;
  const meterCard = (cls, icon, label, unit, o) => `
    <div class="sl-meter ${cls}">
      <div class="sl-meter-h"><b>${icon} ${label}</b><span>KES ${money(o.rate)} per ${unit === 'units' ? 'unit' : unit}</span></div>
      <div class="sl-readings">
        <div><span>Previous</span><b>${esc(rd(o.init))}</b></div><i>&#8594;</i>
        <div><span>Current</span><b>${esc(rd(o.fin))}</b></div>
        <div class="sl-used"><span>Used</span><b>${qty(o.used)}</b></div>
      </div>
      <div class="sl-formula">Used = Current &minus; Previous = ${esc(rd(o.fin))} &minus; ${esc(rd(o.init))} = <b>${qty(o.used)} ${unit}</b></div>
      <div class="sl-formula">${qty(o.used)} ${unit} &times; KES ${money(o.rate)} = <b>KES ${money(o.cost)}</b></div>
    </div>`;

  const hist = Array.isArray(meta.history) ? meta.history.filter(h => h && h.m) : [];
  const bars = (key, cls, unit, title) => {
    const s = hist.map(h => n(h[key])), max = Math.max(...s, 0.0001);
    const t = trend(s[s.length - 1], s[s.length - 2]);
    const arrow = t.dir === 'up' ? '&#9650;' : t.dir === 'down' ? '&#9660;' : '&#9644;';
    return `<div class="sl-chart ${cls}">
      <div class="sl-chart-h"><b>${title}</b><span class="sl-tr sl-tr-${t.dir}">${arrow} ${esc(trendWords(t, monthShort(hist[hist.length - 2].m)))}</span></div>
      <div class="sl-bars">${s.map((v, i) => `<div class="sl-bar${i === s.length - 1 ? ' now' : ''}"><em>${qty(v)}</em><i style="height:${Math.max(v > 0 ? 4 : 1, v / max * 100)}%"></i><span>${esc(monthShort(hist[i].m))}</span></div>`).join('')}</div>
    </div>`;
  };
  const trendBlock = hist.length < 2
    ? `<div class="sl-hint">This is your first statement on record. From next month you will see how your usage compares here.</div>`
    : `<div class="sl-charts">${bars('w', 'sl-w', 'units', 'Water used (units)')}${bars('p', 'sl-p', 'kWh', 'Power used (kWh)')}</div>`;

  const steps = paid ? [{ lead: 'Payment received', text: 'This statement is marked as paid. Thank you! Keep it for your records.' }] : paySteps(meta);

  return `
    <div class="slip-box slip-v2">
      <div class="slip-header">
        <div><div class="slip-brand">${esc(meta.buildingName || 'Rentveiw')}</div><div class="slip-sub">Official Payment Statement</div>
          <div class="slip-sub">Statement no. ${esc(meta.slipNo || '-')}</div></div>
        <span class="status-badge status-${paid ? 'occupied' : 'unpaid'}">${paid ? 'PAID' : 'PENDING'}</span>
      </div>
      <div class="slip-meta">
        <div><span>Room</span><b>${esc(meta.roomName || '-')}</b></div>
        <div><span>Tenant</span><b>${esc(meta.tenantName || '-')}</b></div>
        <div><span>Billing month</span><b>${esc(monthLabel(meta.month))}</b></div>
        <div><span>Payment terms</span><b>${esc(meta.paymentDesc || 'As agreed')}</b></div>
      </div>

      <h3 class="sl-h">Meter readings</h3>
      <div class="sl-meters">
        ${meterCard('sl-w', '&#128167;', 'Water meter', 'units', { init: meta.waterInit, fin: meta.waterFinal, used: meta.waterUsed, rate: meta.waterRate, cost: meta.waterCost })}
        ${meterCard('sl-p', '&#9889;', 'Power meter', 'kWh', { init: meta.powerInit, fin: meta.powerFinal, used: meta.powerUsed, rate: meta.powerRate, cost: meta.powerCost })}
      </div>

      <h3 class="sl-h">Charges</h3>
      <table class="slip-table">
        <thead><tr><th>Item</th><th>How it was worked out</th><th style="text-align:right">Amount (KES)</th></tr></thead>
        <tbody>
          <tr><td>Rent</td><td>Fixed monthly rent</td><td class="num-cell">${money(meta.rent)}</td></tr>
          <tr><td>Water</td><td>${qty(meta.waterUsed)} units &times; ${money(meta.waterRate)}</td><td class="num-cell">${money(meta.waterCost)}</td></tr>
          <tr><td>Power</td><td>${qty(meta.powerUsed)} kWh &times; ${money(meta.powerRate)}</td><td class="num-cell">${money(meta.powerCost)}</td></tr>
        </tbody>
      </table>
      <div class="slip-total sl-total-${paid ? 'paid' : 'due'}"><span>${paid ? 'Total paid' : 'Total due'}</span><b>KES ${money(meta.total)}</b></div>

      <h3 class="sl-h">How your bill is worked out</h3>
      <ol class="sl-calc">
        <li><b>Read the meters.</b> They are read at the start and end of the month.</li>
        <li><b>Find the units used.</b> Units = Current &minus; Previous.</li>
        <li><b>Multiply, then add.</b> Charge = units &times; rate. Rent ${money(meta.rent)} + Water ${money(meta.waterCost)} + Power ${money(meta.powerCost)} = <b>${money(meta.total)}</b>.</li>
      </ol>

      ${Array.isArray(meta.history) ? `<h3 class="sl-h">Usage trend</h3>
      ${trendBlock}` : ''}

      <h3 class="sl-h">${paid ? 'Thank you' : 'How to pay'}</h3>
      <ol class="sl-pay">${steps.map(s => `<li><b>${esc(s.lead)}.</b> ${esc(s.text)}</li>`).join('')}</ol>

      <div class="slip-actions">
        <button class="btn-primary" onclick="downloadSlipPdf()">&#11015; Download PDF</button>
        <button class="btn-secondary" onclick="window.print()">&#128424; Print</button>
      </div>
      <div class="slip-footer">Generated ${esc(meta.generatedAt || '')} &middot; Powered by Rentveiw</div>
    </div>`;
}
