/* RentReview · extras.js — theme, typography, About / Terms / Privacy / Contact pages */
(function () {
  'use strict';
  var D = document, R = D.documentElement, EMAIL = 'artyourtaste@gmail.com';
  var DEF = { theme: 'dark', font: 'inter', size: 'md', weight: '400' };
  var FONTS = [
    ['inter', 'Modern Sans', 'Inter', 'Clean & neutral'],
    ['lora', 'Classic Serif', 'Lora', 'Warm & bookish'],
    ['nunito', 'Friendly Round', 'Nunito', 'Soft & approachable'],
    ['mono', 'Ledger Mono', 'JetBrains Mono', 'Numbers line up neatly'],
    ['grotesk', 'Bold Grotesk', 'Space Grotesk', 'Modern with personality']
  ];
  var mq = matchMedia('(prefers-color-scheme: dark)');
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} }
  function pref(k) { return ls('rr_' + k) || DEF[k]; }
  function resolved() { var t = pref('theme'); return t === 'auto' ? (mq.matches ? 'dark' : 'light') : t; }

  function apply() {
    var dark = resolved() === 'dark';
    R.dataset.theme = resolved(); R.dataset.font = pref('font'); R.dataset.size = pref('size');
    R.style.setProperty('--fw', pref('weight'));
    var m = D.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0F1117' : '#F4F6FB';
    D.querySelectorAll('[data-theme-icon]').forEach(function (e) {
      e.textContent = dark ? '☀️' : '🌙';
      e.parentNode.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    });
    D.querySelectorAll('[data-pref]').forEach(function (b) { b.classList.toggle('on', pref(b.dataset.pref) === b.dataset.val); });
  }
  function set(k, v) { ls('rr_' + k, v); apply(); }

  function seg(key, items) {
    return '<div class="seg">' + items.map(function (x) {
      return '<button type="button" data-pref="' + key + '" data-val="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function renderPanel() {
    var el = D.getElementById('appearance-panel'); if (!el) return;
    el.innerHTML =
      '<div class="ap-label">Theme</div>' + seg('theme', [['light', '☀️ Light'], ['dark', '🌙 Dark'], ['auto', '🖥 Auto']]) +
      '<div class="ap-label">Font family</div><div class="font-grid">' + FONTS.map(function (f) {
        return '<button type="button" class="font-card" data-pref="font" data-val="' + f[0] + '"><b>' + f[1] + '</b><span>' + f[3] + '</span></button>';
      }).join('') + '</div>' +
      '<div class="ap-label">Text size</div>' + seg('size', [['sm', 'Small'], ['md', 'Default'], ['lg', 'Large'], ['xl', 'XL']]) +
      '<div class="ap-label">Text weight</div>' + seg('weight', [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium']]) +
      '<div class="ap-preview">Room A1 · rent paid <b>KES 12,500.00</b><br><small>The quick brown fox jumps over the lazy dog</small></div>' +
      '<div class="ap-note">Applied instantly and remembered on this device.</div>' +
      '<button type="button" class="btn-sm btn-secondary" data-reset-look>↺ Reset look</button>';
    el.querySelectorAll('.font-card').forEach(function (c, i) { c.style.fontFamily = "'" + FONTS[i][2] + "', sans-serif"; });
    apply();
  }

  /* ───────── Info pages ───────── */
  var MAIL = '<a href="mailto:' + EMAIL + '">' + EMAIL + '</a>';
  function sec(n, t, plain, body) {
    return '<section class="doc-sec" id="s' + n + '"><h3><i>' + n + '</i>' + t + '</h3>' + (plain ? '<p class="plain">In plain English: ' + plain + '</p>' : '') + body + '</section>';
  }
  function cards(list) {
    return '<div class="cards">' + list.map(function (c) { return '<div class="icard"><div class="ic">' + c[0] + '</div><b>' + c[1] + '</b><p>' + c[2] + '</p></div>'; }).join('') + '</div>';
  }
  var UPDATED = 'Last updated: 29 September 2026';

  var PAGES = {
    about: ['About', function () {
      return '<section class="hero"><div class="orb"></div><div class="hero-emoji">🏠</div><h1>Rent, without the rummaging.</h1>' +
        '<p>RentReview is a calm little ledger for landlords — rooms, tenants, meters, bills and complaints in one tidy place, made for the way rent really works day to day.</p></section>' +
        cards([
          ['🚪', 'Rooms that remember', 'Every room keeps its own history of rent, readings and notes.'],
          ['🔢', 'Meters, sorted', 'Log water and power readings; units and costs are worked out for you.'],
          ['🧾', 'Slips in a tap', 'Turn bills into neat PDF slips and share by SMS, WhatsApp or link.'],
          ['📋', 'Complaints & notes', 'Log issues, follow them to resolved, never lose a promise.'],
          ['🤖', 'An AI that knows your ledger', 'Ask “who hasn’t paid?” and get answers from your own data.'],
          ['🎨', 'Yours to style', 'Light or dark, five typefaces, and your building’s name on top.']
        ]) +
        '<h2>How it works</h2><ol class="steps"><li><b>Name your building</b><span>It appears on your dashboard and on every tenant slip — rename it any time with the ✎ beside the name.</span></li>' +
        '<li><b>Add rooms &amp; tenants</b><span>Set rents and meter rates once; RentReview remembers them.</span></li>' +
        '<li><b>Read, bill, share</b><span>Enter the month’s readings, generate the bill, send the slip. Done.</span></li></ol>' +
        '<div class="note-card">✨ Made with care by a small independent team. Got an idea, a bug, or a kind word? <a href="#contact" data-info="contact">Say hello →</a></div>';
    }],

    terms: ['Terms & Conditions', function () {
      return '<section class="hero slim"><div class="hero-emoji">📜</div><h1>Terms &amp; Conditions</h1><p>The ground rules for using RentReview — kept as readable as we can make them. <em>' + UPDATED + '</em></p></section>' +
        sec(1, 'Agreeing to these terms', 'using RentReview means you accept these rules.', '<p>By creating an account or using RentReview you agree to these Terms and our <a href="#privacy" data-info="privacy">Privacy Policy</a>. If you don’t agree, please don’t use the service.</p>') +
        sec(2, 'What RentReview is', 'a record-keeping and billing helper, not an accountant or lawyer.', '<p>RentReview helps landlords track rooms, tenants, meter readings, bills and complaints. Figures are calculated from what you enter; you are responsible for checking they are right before billing anyone. Nothing in the app is legal, tax or financial advice.</p>') +
        sec(3, 'Your account', 'keep your login safe; you’re responsible for what happens under it.', '<p>You sign in with email and password or Google. Keep your credentials private and tell us at once if you suspect misuse. You must be 18 or older, and give accurate information.</p>') +
        sec(4, 'Your data and your tenants’ data', 'your records stay yours — and you must handle tenants’ details lawfully.', '<p>You own the information you enter. You promise you have the right to store your tenants’ details (such as names, phone numbers and ID numbers) and to share slips with them, and that you will follow applicable data-protection law, including Kenya’s Data Protection Act, 2019.</p>') +
        sec(5, 'Acceptable use', 'don’t misuse it, break it, or use it to harass people.', '<p>Do not use RentReview for anything unlawful, to harass or discriminate against tenants, to attempt to access other users’ data, to disrupt the service, or to upload malicious content.</p>') +
        sec(6, 'AI Assistant', 'AI answers can be wrong — double-check before acting.', '<p>The AI Assistant uses a third-party AI provider with an API key you supply. Answers may be incomplete or inaccurate and are not professional advice. You are responsible for your key and for any usage charges the provider makes.</p>') +
        sec(7, 'Shared slips', 'anyone with a slip link can see that slip.', '<p>When you share a slip by link, its contents are stored in a page that anyone holding the link can open without signing in. Only share links with the intended tenant. A shared slip is a snapshot; it does not update itself if you later change your records.</p>') +
        sec(8, 'Availability and changes', 'we try to keep it running, but can’t promise it never breaks.', '<p>RentReview is provided “as is” and “as available”. Features may change, and the service may be interrupted for maintenance or reasons outside our control. Keep your own copies of anything critical. We may update these Terms; continued use after an update means you accept it.</p>') +
        sec(9, 'Limits of liability', 'we’re not liable for indirect losses.', '<p>To the fullest extent the law allows, RentReview and its makers are not liable for indirect or consequential loss, lost rent, or losses arising from errors in data you entered or from third-party services. Nothing here limits liability that cannot lawfully be limited.</p>') +
        sec(10, 'Governing law', 'Kenyan law applies.', '<p>These Terms are governed by the laws of the Republic of Kenya, and disputes will be handled by its courts, unless mandatory law says otherwise.</p>') +
        sec(11, 'Contact', 'questions? Write to us.', '<p>' + MAIL + '</p>');
    }],

    privacy: ['Privacy', function () {
      return '<section class="hero slim"><div class="hero-emoji">🔒</div><h1>Privacy Policy</h1><p>What RentReview stores, where it lives, and how you stay in control. <em>' + UPDATED + '</em></p></section>' +
        cards([
          ['🗂️', 'What we hold', 'Your account email, building name and the records you enter.'],
          ['☁️', 'Where it lives', 'In Google Firebase, in a private space tied to your account.'],
          ['👀', 'Who sees it', 'You. Plus anyone you send a slip link to, and the services listed below.'],
          ['🎛️', 'Your control', 'Edit or delete records any time, or ask us to erase your account.']
        ]) +
        sec(1, 'What we collect', '', '<p><b>Account:</b> email address and sign-in details (via Firebase Authentication, or Google sign-in). <b>Building:</b> building name and country dialing code. <b>Records you enter:</b> rooms, rents and rates; tenants’ names, ID/passport numbers, phone numbers, emails, gender, occupants, deposits and notes; meter readings; bills and payment status; complaints and notes. We do not run advertising or analytics trackers of our own.</p>') +
        sec(2, 'How it’s used', '', '<p>Only to run the app for you: showing your records, calculating bills, generating PDF slips (built in your browser) and powering the features you switch on. We don’t sell your data.</p>') +
        sec(3, 'Services that touch your data', '', '<p><b>Google Firebase</b> (Authentication and Firestore) stores your account and records. <b>Groq</b> receives a copy of your property data — rooms, tenants, bills, readings, complaints — and your question, only when you use the AI Assistant, using your own API key. <b>cdnjs</b> (jsPDF library) and <b>Google Fonts</b> serve code and typefaces, so they see your IP address when the page loads. Each has its own privacy policy.</p>') +
        sec(4, 'Shared slips', '', '<p>Sharing a slip publishes a snapshot — building, room, tenant name, tenant phone and email, month, amounts, payment notes and your account email as issuer — to a page anyone with the link can open. Treat links like you would a printed statement.</p>') +
        sec(5, 'On your device', '', '<p>Your browser stores your look preferences (theme, font, size, weight) and your AI settings, including your API key. These stay on that device; clear your browser data to remove them.</p>') +
        sec(6, 'Keeping and deleting data', '', '<p>Records stay until you delete them in the app. To erase your whole account and its data, email ' + MAIL + ' from your account address.</p>') +
        sec(7, 'Your rights', '', '<p>Under Kenya’s Data Protection Act, 2019 you may ask to access, correct or delete your personal data, and to object to certain processing. Email us and we’ll help. If you’re a tenant, contact your landlord first — they decide what is stored about you.</p>') +
        sec(8, 'Security', '', '<p>Data travels over HTTPS and is protected by Firebase security rules. No system is perfectly secure, so please use a strong, unique password.</p>') +
        sec(9, 'Children', '', '<p>RentReview is for adults. It is not directed at anyone under 18.</p>') +
        sec(10, 'Changes and contact', '', '<p>If this policy changes, the date above changes. Questions: ' + MAIL + '</p>');
    }],

    contact: ['Contact', function () {
      var faq = [
        ['How do I rename my building?', 'Tap the ✎ next to the building name at the top of the sidebar, type the new name and press Enter. You can also change it under ⚙ Settings. Slips you already shared keep the old name until you share them again.'],
        ['Can I use dark mode?', 'Yes — use the ☀️/🌙 button, or open ⚙ Settings for Light, Dark or Auto plus five font styles.'],
        ['How do I delete my data?', 'Delete records inside the app any time. To erase your entire account, email us from your account address.']
      ].map(function (f) { return '<details><summary>' + f[0] + '</summary><p>' + f[1] + '</p></details>'; }).join('');
      return '<section class="hero slim"><div class="orb"></div><div class="hero-emoji">💌</div><h1>Let’s talk.</h1><p>Questions, ideas, bugs or a friendly hello — we read every message.</p></section>' +
        '<div class="contact-grid"><div class="mail-card"><div class="ic">✉️</div><b>Email us</b><a class="mail-big" href="mailto:' + EMAIL + '">' + EMAIL + '</a>' +
        '<button type="button" class="btn-sm btn-secondary" data-copy>📋 Copy address</button></div>' +
        '<div class="form-card"><b>Or write it here</b><div class="chips" id="c-topics">' +
        ['💡 Idea', '🐞 Bug', '❓ Question', '👋 Hello'].map(function (t, i) { return '<button type="button" class="chip' + (i === 2 ? ' on' : '') + '">' + t + '</button>'; }).join('') + '</div>' +
        '<input id="c-name" placeholder="Your name" autocomplete="name"/><textarea id="c-msg" rows="5" placeholder="Tell us what’s on your mind…"></textarea>' +
        '<button type="button" class="btn-primary" data-send>Open in my email app ✈️</button><div class="ap-note">This opens your email app with the message ready to send.</div></div></div>' +
        '<h2>Quick answers</h2><div class="faq">' + faq + '</div>';
    }]
  };

  var shell, body, current = null;
  function build() {
    if (shell) return;
    shell = D.createElement('div'); shell.id = 'infoScreen'; shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true');
    shell.innerHTML = '<header class="info-top"><button type="button" class="btn-sm btn-secondary" data-info-close>← Back</button>' +
      '<span class="info-brand">🏠 RentReview</span><button type="button" class="btn-icon" data-theme-toggle><span data-theme-icon></span></button></header>' +
      '<nav class="info-tabs">' + Object.keys(PAGES).map(function (k) { return '<a href="#' + k + '" data-info="' + k + '">' + PAGES[k][0] + '</a>'; }).join('') + '</nav>' +
      '<main id="info-body"></main><footer class="info-foot">© ' + new Date().getFullYear() + ' RentReview · ' + MAIL + '</footer>';
    D.body.appendChild(shell); body = shell.querySelector('#info-body');
  }
  function openInfo(key) {
    if (!PAGES[key]) return;
    build(); current = key; body.innerHTML = '<article class="doc">' + PAGES[key][1]() + '</article>';
    shell.querySelectorAll('.info-tabs a').forEach(function (a) { a.classList.toggle('on', a.dataset.info === key); });
    shell.style.display = 'block'; shell.scrollTop = 0; D.body.style.overflow = 'hidden';
    D.title = PAGES[key][0] + ' · RentReview'; apply();
    if (location.hash !== '#' + key) history.pushState(null, '', '#' + key);
  }
  function closeInfo(silent) {
    if (!shell || shell.style.display !== 'block') return;
    shell.style.display = 'none'; D.body.style.overflow = ''; D.title = 'RentReview'; current = null;
    if (!silent && PAGES[location.hash.slice(1)]) history.pushState(null, '', location.pathname + location.search);
  }

  D.addEventListener('click', function (e) {
    var t = e.target, b;
    if ((b = t.closest('[data-pref]'))) return set(b.dataset.pref, b.dataset.val);
    if ((b = t.closest('[data-info]'))) { e.preventDefault(); return openInfo(b.dataset.info); }
    if (t.closest('[data-info-close]')) return closeInfo();
    if (t.closest('[data-theme-toggle]')) return set('theme', resolved() === 'dark' ? 'light' : 'dark');
    if (t.closest('[data-reset-look]')) { Object.keys(DEF).forEach(function (k) { try { localStorage.removeItem('rr_' + k); } catch (x) {} }); return apply(); }
    if ((b = t.closest('#c-topics .chip'))) { D.querySelectorAll('#c-topics .chip').forEach(function (c) { c.classList.remove('on'); }); return b.classList.add('on'); }
    if (t.closest('[data-copy]')) {
      var btn = t.closest('[data-copy]');
      (navigator.clipboard ? navigator.clipboard.writeText(EMAIL) : Promise.reject()).then(function () { btn.textContent = '✓ Copied!'; }, function () { btn.textContent = EMAIL; });
      return;
    }
    if (t.closest('[data-send]')) {
      var topic = (D.querySelector('#c-topics .chip.on') || {}).textContent || 'Message', name = D.getElementById('c-name').value.trim(), msg = D.getElementById('c-msg').value.trim();
      location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('RentReview · ' + topic.replace(/^\S+\s/, '')) +
        '&body=' + encodeURIComponent(msg + (name ? '\n\n— ' + name : ''));
    }
  });
  D.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeInfo(); });
  window.addEventListener('hashchange', function () { var k = location.hash.slice(1); PAGES[k] ? openInfo(k) : closeInfo(true); });
  mq.addEventListener && mq.addEventListener('change', apply);

  window.RR = { openInfo: openInfo, setPref: set };
  renderPanel(); apply();
  if (PAGES[location.hash.slice(1)]) openInfo(location.hash.slice(1));
})();
