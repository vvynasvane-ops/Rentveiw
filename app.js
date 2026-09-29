/* ═══════════════════════════════════════════════════════════════
   RentReview · app.js
   Application logic (ES module) — Firebase Auth + Firestore,
   rooms, tenants, readings, billing, complaints, AI assistant.
   Loaded by index.html with <script type="module">.
   Settings live in firebase-config.js.
   ═══════════════════════════════════════════════════════════════ */
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import {
    getFirestore, collection, getDocs, addDoc, setDoc, deleteDoc, updateDoc,
    doc, getDoc, query, orderBy, onSnapshot, serverTimestamp
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
  import {
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signOut, updateProfile,
    GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

  import { firebaseConfig } from "./firebase-config.js";
  // ─────────────────────────────────────────────────────────────────────────

  const app  = initializeApp(firebaseConfig);
  const db   = getFirestore(app);
  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();

  // ── Per-account scoping ──────────────────────────────────────────────────
  // Every landlord gets their own isolated ledger: all data lives under
  // /users/{uid}/<collection>/<docId>. Nobody can see or touch another
  // account's rooms, tenants, bills, readings or complaints.
  let currentUser     = null;   // firebase auth user object
  let buildingName    = '';     // this account's building name
  let countryCode     = '254';  // default dialing code used to auto-format tenant phone numbers (Kenya)
  let liveUnsub       = [];     // active onSnapshot unsubscribe fns

  function uidPath() {
    if (!currentUser) throw new Error('Not signed in');
    return ['users', currentUser.uid];
  }

  // ── Firestore helpers (scoped to the signed-in user) ─────────────────────
  async function getCol(col, ...qArgs) {
    const base = collection(db, ...uidPath(), col);
    const q = qArgs.length ? query(base, ...qArgs) : base;
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async function addDoc2(col, data)     { return await addDoc(collection(db, ...uidPath(), col), data); }
  async function setDoc2(col, id, data) { return await setDoc(doc(db, ...uidPath(), col, id), data); }
  async function delDoc(col, id)        { return await deleteDoc(doc(db, ...uidPath(), col, id)); }
  async function updDoc(col, id, data)  { return await updateDoc(doc(db, ...uidPath(), col, id), data); }

  // Live (auto-updating) subscription — keeps `target` array in sync with
  // Firestore in real time and re-renders whenever anything changes.
  function watchCol(col, sortKey, onChange) {
    const base = collection(db, ...uidPath(), col);
    const unsub = onSnapshot(base, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (sortKey) list.sort((a,b) => (''+(a[sortKey]||'')).localeCompare(''+(b[sortKey]||'')));
      onChange(list);
    }, err => console.error('watchCol', col, err));
    liveUnsub.push(unsub);
    return unsub;
  }
  function stopAllWatches() { liveUnsub.forEach(u=>{ try{u();}catch(e){} }); liveUnsub = []; }

  // ── Phone number recognition ─────────────────────────────────────────────
  // The only input we require from the tenant record is a phone number in
  // whatever format the landlord typed it (local "07xx…", "+254 7xx…",
  // "254 7xx…", with spaces/dashes/brackets). This turns that into a clean
  // international MSISDN (digits only, country code, no leading 0/+),
  // using the account's default country code for local-format numbers.
  function normalizePhone(raw) {
    if (!raw) return null;
    let d = String(raw).replace(/[^\d+]/g, '');   // strip everything but digits and +
    if (d.startsWith('+')) d = d.slice(1);
    if (d.startsWith('00')) d = d.slice(2);        // international dial-out prefix
    if (d.startsWith('0')) d = countryCode + d.slice(1);   // local format -> country code
    else if (!d.startsWith(countryCode) && d.length <= 10) d = countryCode + d; // bare local number, no leading 0
    return /^\d{8,15}$/.test(d) ? d : null;
  }

  // ── AI Prefs (localStorage) ──────────────────────────────────────────────
  const AI_DEFAULTS = {
    apiKey:       "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",
    model:        "llama-3.3-70b-versatile",
    temperature:  0.7,
    maxTokens:    1024,
    systemPrompt: "You are Rent Review AI — an intelligent property management assistant embedded inside the Rent Review web app used by a Kenyan landlord. Your knowledge is strictly limited to the property data provided in each message. Do not invent tenants, rooms, bills, or any figures not present in the data. Be concise, direct, and practical. Use KES for currency. When answering, cite specific room names, tenant names, or months from the data. If the data does not contain enough information to answer, say so clearly."
  };
  const AVAILABLE_MODELS = [
    "llama-3.3-70b-versatile",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "gemma2-9b-it"
  ];
  const AiPrefs = {
    get: (k)    => { try { return JSON.parse(localStorage.getItem('rr_ai_'+k)) ?? AI_DEFAULTS[k]; } catch(e){ return AI_DEFAULTS[k]; } },
    set: (k, v) => { try { localStorage.setItem('rr_ai_'+k, JSON.stringify(v)); } catch(e){} },
    reset: ()   => { Object.keys(AI_DEFAULTS).forEach(k => localStorage.removeItem('rr_ai_'+k)); }
  };

  // ── State ────────────────────────────────────────────────────────────────
  let rooms = [], tenants = [], readings = [], bills = [], complaints = [];
  let currentPage = 'dashboard';
  let editTarget  = null;
  let aiSnapshot  = null;          // cached property data for AI
  let chatHistory = [];            // [{role,content}]

  // ── Boot ─────────────────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    if (publicSlipId) { renderPublicSlipPage(publicSlipId); return; }
    document.getElementById('authEmailBtn').addEventListener('click', doEmailAuth);
    document.getElementById('authGoogleBtn').addEventListener('click', doGoogleAuth);
    document.getElementById('authPass').addEventListener('keydown', e => { if(e.key==='Enter') doEmailAuth(); });
    document.getElementById('authSwitchLink').addEventListener('click', toggleAuthMode);
    document.getElementById('authForgotLink').addEventListener('click', doForgotPassword);
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.nav));
    });
    document.getElementById('logoutBtn').addEventListener('click', doLogout);
    document.getElementById('onbBtn').addEventListener('click', saveOnboarding);
    const bi = document.getElementById('brandInput');
    bi.addEventListener('keydown', e => { if(e.key==='Enter') commitBrandEdit(true); else if(e.key==='Escape') commitBrandEdit(false); });
    bi.addEventListener('blur', () => commitBrandEdit(true));

    // AI chat input enter key
    document.getElementById('aiInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }
    });

    // AI Settings — populate model dropdown
    const ms = document.getElementById('ais-model');
    AVAILABLE_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = m;
      ms.appendChild(opt);
    });
  });

  // ── Auth ─────────────────────────────────────────────────────────────────
  // Every landlord signs up with an email + password of their own choosing
  // (or one tap via Google) and lands in a private ledger tied to their
  // account — nobody else can read or write into it.
  let authMode = 'signin'; // 'signin' | 'signup'

  // A tenant opening a shared ?slip=<id> link never needs to sign in — it's
  // a read-only public page, so we skip the whole auth flow for that visit.
  const publicSlipId = new URLSearchParams(location.search).get('slip');

  onAuthStateChanged(auth, async (user) => {
    if (publicSlipId) return; // public slip page handles itself, see boot section
    stopAllWatches();
    if (user) {
      currentUser = user;
      await enterAccount(user);
    } else {
      currentUser = null;
      showAuthScreen();
    }
  });

  function toggleAuthMode(e) {
    if (e) e.preventDefault();
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    renderAuthMode();
  }
  function renderAuthMode() {
    const isSignup = authMode === 'signup';
    document.getElementById('authTitle').textContent = isSignup ? 'Create your account' : 'Welcome back';
    document.getElementById('authSub').textContent = isSignup
      ? 'Set up your own building ledger in seconds'
      : 'Sign in to manage your building';
    document.getElementById('authEmailBtn').textContent = isSignup ? 'Create Account' : 'Sign In';
    document.getElementById('authSwitchLink').textContent = isSignup ? 'Already have an account? Sign in' : "New here? Create an account";
    document.getElementById('authForgotLink').style.display = isSignup ? 'none' : 'block';
    document.getElementById('authError').style.display = 'none';
  }

  async function doEmailAuth() {
    const email = val('authEmail'), pass = document.getElementById('authPass').value;
    const err = document.getElementById('authError');
    err.style.display = 'none';
    if (!email || !pass) { err.textContent = 'Enter both email and password.'; err.style.display='block'; return; }
    if (pass.length < 6) { err.textContent = 'Password must be at least 6 characters.'; err.style.display='block'; return; }
    const btn = document.getElementById('authEmailBtn'); btn.disabled = true;
    try {
      if (authMode === 'signup') await createUserWithEmailAndPassword(auth, email, pass);
      else await signInWithEmailAndPassword(auth, email, pass);
      document.getElementById('authPass').value = '';
    } catch(e) {
      err.textContent = friendlyAuthError(e);
      err.style.display = 'block';
    }
    btn.disabled = false;
  }

  async function doGoogleAuth() {
    const err = document.getElementById('authError');
    err.style.display = 'none';
    try { await signInWithPopup(auth, googleProvider); }
    catch(e) { err.textContent = friendlyAuthError(e); err.style.display = 'block'; }
  }

  async function doForgotPassword(e) {
    if (e) e.preventDefault();
    const email = val('authEmail');
    const err = document.getElementById('authError');
    if (!email) { err.textContent = 'Enter your email above first, then click "Forgot password".'; err.style.display='block'; return; }
    try { await sendPasswordResetEmail(auth, email); showToast('Password reset email sent'); }
    catch(e2) { err.textContent = friendlyAuthError(e2); err.style.display = 'block'; }
  }

  function friendlyAuthError(e) {
    const code = e?.code || '';
    const map = {
      'auth/email-already-in-use': 'That email already has an account — try signing in instead.',
      'auth/invalid-email':        'That email address looks invalid.',
      'auth/weak-password':        'Password is too weak — use at least 6 characters.',
      'auth/user-not-found':       'No account found with that email.',
      'auth/wrong-password':       'Incorrect password.',
      'auth/invalid-credential':   'Incorrect email or password.',
      'auth/too-many-requests':    'Too many attempts — please wait a moment and try again.',
      'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    };
    return map[code] || (e.message || 'Something went wrong — please try again.');
  }

  function doLogout() { stopAllWatches(); signOut(auth); }

  function showAuthScreen() {
    document.getElementById('loginScreen').style.display='flex';
    document.getElementById('appShell').style.display='none';
    document.getElementById('onboardScreen').style.display='none';
    renderAuthMode();
  }

  // After sign-in, load (or create) this account's building profile.
  async function enterAccount(user) {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists() || !snap.data().buildingName) {
      // First time in — ask for the building name before showing the app.
      document.getElementById('loginScreen').style.display='none';
      document.getElementById('appShell').style.display='none';
      document.getElementById('onboardScreen').style.display='flex';
      setVal('onbName', snap.exists() ? (snap.data().buildingName||'') : '');
      setVal('onbCountryCode', snap.exists() ? (snap.data().countryCode||'254') : '254');
      return;
    }
    buildingName = snap.data().buildingName;
    countryCode  = snap.data().countryCode || '254';
    showApp();
  }

  async function saveOnboarding() {
    const name = val('onbName');
    const cc = (val('onbCountryCode')||'254').replace(/\D/g,'') || '254';
    if (!name) { showToast('Please enter a building name','error'); return; }
    const btn = document.getElementById('onbBtn'); btn.disabled = true;
    try {
      await setDoc(doc(db, 'users', currentUser.uid), {
        buildingName: name,
        countryCode: cc,
        email: currentUser.email || '',
        createdAt: serverTimestamp()
      }, { merge: true });
      buildingName = name; countryCode = cc;
      showApp();
    } catch(e) { showToast(e.message,'error'); }
    btn.disabled = false;
  }

  // Settings: lets the landlord fix the building name / country code later
  // (e.g. if tenant numbers are being mis-formatted for SMS/WhatsApp).
  window.openSettings = function() {
    setVal('setName', buildingName); setVal('setCountryCode', countryCode);
    openModal('modal-settings');
  };
  window.saveSettings = async function() {
    const name = val('setName');
    const cc = (val('setCountryCode')||'254').replace(/\D/g,'') || '254';
    if (!name) { showToast('Building name required','error'); return; }
    try {
      await setDoc(doc(db,'users',currentUser.uid), { buildingName:name, countryCode:cc }, { merge:true });
      buildingName = name; countryCode = cc;
      document.querySelectorAll('.brand-name').forEach(el=>el.textContent = buildingName || 'RentReview');
      showToast('Settings saved'); closeModal('modal-settings');
    } catch(e) { showToast(e.message,'error'); }
  };

  // Inline rename: click ✎ beside the building name, Enter saves, Esc cancels.
  window.editBuildingName = function() {
    const bi = document.getElementById('brandInput');
    document.getElementById('brandName').style.display = 'none';
    document.getElementById('brandEditBtn').style.display = 'none';
    bi.style.display = 'block'; bi.value = buildingName || ''; bi.focus(); bi.select();
  };
  async function commitBrandEdit(save) {
    const bi = document.getElementById('brandInput');
    if (bi.style.display !== 'block') return;
    bi.style.display = 'none';
    document.getElementById('brandName').style.display = '';
    document.getElementById('brandEditBtn').style.display = '';
    const name = bi.value.trim();
    if (!save || !name || name === buildingName) return;
    try {
      await setDoc(doc(db,'users',currentUser.uid), { buildingName:name }, { merge:true });
      buildingName = name;
      document.querySelectorAll('.brand-name').forEach(el=>el.textContent = buildingName);
      showToast('Building name updated');
    } catch(e) { showToast(e.message,'error'); }
  }

  function showApp() {
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('onboardScreen').style.display='none';
    document.getElementById('appShell').style.display='flex';
    document.querySelectorAll('.brand-name').forEach(el=>el.textContent = buildingName || 'RentReview');
    document.getElementById('topbar-account-email').textContent = currentUser.email || '';
    startLiveSync();
    navigate('dashboard');
  }

  // Real-time sync: rooms/tenants/readings/bills/complaints auto-update the
  // moment anything changes, on this device or any other signed-in device.
  function startLiveSync() {
    watchCol('rooms', 'name', list => { rooms = list; rerenderCurrentPage(); });
    watchCol('tenants', 'name', list => { tenants = list; rerenderCurrentPage(); });
    watchCol('readings', 'date', list => { readings = list.reverse(); rerenderCurrentPage(); });
    watchCol('bills', 'month', list => { bills = list.reverse(); rerenderCurrentPage(); });
    watchCol('complaints', 'date', list => { complaints = list.reverse(); rerenderCurrentPage(); });
  }
  function rerenderCurrentPage() {
    if (currentPage === 'dashboard')     renderDashboard();
    else if (currentPage === 'rooms')    renderRoomsGrid();
    else if (currentPage === 'tenants')  renderTenantsTable();
    else if (currentPage === 'readings') { populateRoomFilter('readings-room-filter',readings); filterReadings(); }
    else if (currentPage === 'billing')  { populateRoomFilter('bills-room-filter',bills); filterBills(); }
    else if (currentPage === 'complaints') filterComplaints();
    else if (currentPage === 'room-detail' && activeRoomId) renderRoomDetail(activeRoomId);
    populateRoomSelect('tf-roomId'); populateRoomSelect('rdf-roomId');
    populateRoomSelect('bf-roomId'); populateRoomSelect('cf-roomId');
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  let activeRoomId = null; // the room currently "opened" (its own scoped environment)

  function navigate(page, opts) {
    currentPage = page;
    document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav===page));
    document.querySelectorAll('.page').forEach(p => p.style.display = p.id==='page-'+page ? 'block' : 'none');
    document.getElementById('sidebar').classList.remove('open');
    const titles = { dashboard:'Dashboard', rooms:'Rooms', tenants:'Tenants', readings:'Meter Readings', billing:'Billing', complaints:'Complaints & Notes', ai:'AI Assistant', 'room-detail':'Room' };
    document.getElementById('topbar-title').textContent = titles[page] || page;
    if (page !== 'room-detail') activeRoomId = null;
    loadPage(page, opts);
  }

  async function loadPage(page, opts) {
    setLoading(page, true);
    try {
      switch(page) {
        case 'dashboard':  renderDashboard();  break;
        case 'rooms':      renderRoomsGrid();       break;
        case 'tenants':    populateRoomSelect('tf-roomId'); renderTenantsTable();     break;
        case 'readings':   populateRoomSelect('rdf-roomId'); populateRoomFilter('readings-room-filter',readings); filterReadings();    break;
        case 'billing':    setupBillingForm(); populateRoomFilter('bills-room-filter',bills); setDefaultMonth(); filterBills();    break;
        case 'complaints': populateRoomSelect('cf-roomId'); populateRoomFilter('complaints-room-filter',complaints); filterComplaints();  break;
        case 'ai':         await initAiPage();      break;
        case 'room-detail':
          activeRoomId = opts && opts.roomId ? opts.roomId : activeRoomId;
          renderRoomDetail(activeRoomId);
          break;
      }
    } catch(e) { showToast('Firebase error: '+e.message,'error'); console.error(e); }
    setLoading(page, false);
  }
  window.openRoom = function(id) { navigate('room-detail', { roomId: id }); };
  window.backToRooms = function() { navigate('rooms'); };

  function setLoading(page, on) {
    const el = document.querySelector(`#page-${page} .page-loader`);
    if (el) el.style.display = on ? 'flex' : 'none';
  }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  function renderDashboard() {
    const occupied=rooms.filter(r=>r.status==='occupied').length;
    const vacant=rooms.filter(r=>r.status==='vacant').length;
    const maintenance=rooms.filter(r=>r.status==='maintenance').length;
    const revenue=bills.filter(b=>b.paid).reduce((s,b)=>s+(b.total||0),0);
    const pending=bills.filter(b=>!b.paid);
    const openComp=complaints.filter(c=>c.status!=='resolved').length;
    document.getElementById('stat-rooms').textContent      = rooms.length;
    document.getElementById('stat-occupied').textContent   = occupied;
    document.getElementById('stat-vacant').textContent     = vacant;
    document.getElementById('stat-maintenance').textContent= maintenance;
    document.getElementById('stat-revenue').textContent    = 'KES '+revenue.toLocaleString('en-KE',{minimumFractionDigits:0});
    document.getElementById('stat-pending-count').textContent = pending.length;
    document.getElementById('stat-complaints').textContent = openComp;
    document.getElementById('stat-tenants').textContent    = tenants.length;
    const ul = document.getElementById('pending-list');
    if(pending.length===0){ ul.innerHTML='<li class="empty-item">✓ All bills settled</li>'; }
    else { ul.innerHTML=pending.slice(0,8).map(b=>{ const room=rooms.find(r=>r.id===b.roomId); return `<li class="pending-item"><span class="pi-room">${room?room.name:'Unknown'} <span class="pi-month">${b.month||''}</span></span><span class="pi-amt">KES ${(b.total||0).toLocaleString('en-KE',{minimumFractionDigits:0})}</span><button class="btn-xs btn-green" onclick="markPaid('${b.id}')">Mark Paid</button></li>`; }).join(''); }
    const cl=document.getElementById('complaints-preview');
    const openList=complaints.filter(c=>c.status!=='resolved').slice(0,5);
    if(openList.length===0){ cl.innerHTML='<li class="empty-item">No open issues</li>'; }
    else { cl.innerHTML=openList.map(c=>{ const room=rooms.find(r=>r.id===c.roomId); return `<li class="pending-item"><span class="pi-room">${room?room.name:'—'} <span class="pi-month tag-${c.type}">${c.type}</span></span><span class="comp-subject">${c.subject||''}</span><span class="status-badge status-${c.status}">${c.status}</span></li>`; }).join(''); }
  }
  // Marking a bill PAID is the trigger point that locks its final readings
  // in as the next bill's starting point for that room — this is what
  // keeps the reading chain trustworthy: a bill isn't "official" until
  // it's paid, so drafts/unpaid corrections can never poison the baseline.
  async function markBillPaidAndCarryForward(billId) {
    const b = bills.find(x=>x.id===billId);
    await updDoc('bills', billId, { paid:true });
    if (b) {
      await updDoc('rooms', b.roomId, {
        lastWaterReading: b.waterFinal,
        lastPowerReading: b.powerFinal,
        lastBillMonth: b.month
      });
    }
  }
  window.markPaid = async function(billId) {
    try { await markBillPaidAndCarryForward(billId); showToast('Marked as paid — reading baseline carried forward'); }
    catch(e){ showToast(e.message,'error'); }
  };

  // ── ROOMS ─────────────────────────────────────────────────────────────────
  // Each room is an independent, self-contained environment: its own
  // readings, bills, tenant, complaint history and PDF catalog. The only
  // way to see that history is to open the room itself.
  function renderRoomsGrid() {
    const grid = document.getElementById('rooms-grid');
    if(rooms.length===0){ grid.innerHTML='<div class="empty-state"><div class="empty-icon">🏠</div><p>No rooms yet. Add your first room.</p></div>'; return; }
    grid.innerHTML=rooms.map(r=>`
      <div class="room-card" onclick="openRoom('${r.id}')">
        <div class="room-card-header"><span class="room-name">${r.name}</span><span class="status-badge status-${r.status}">${r.status}</span></div>
        <div class="room-meta">${r.floor?`<span>Floor ${r.floor}</span>`:''} ${r.desc?`<span>${r.desc}</span>`:''}</div>
        <div class="room-rates">
          <div class="rate-pill">🏠 KES ${(r.rent||0).toLocaleString()}/mo</div>
          <div class="rate-pill">💧 ${r.waterRate||0}/unit</div>
          <div class="rate-pill">⚡ ${r.powerRate||0}/kWh</div>
        </div>
        ${r.paymentDesc?`<div class="room-notes">${r.paymentDesc}</div>`:''}
        <div class="card-actions" onclick="event.stopPropagation()">
          <button class="btn-sm btn-secondary" onclick="openRoom('${r.id}')">Open</button>
          <button class="btn-sm btn-secondary" onclick="editRoom('${r.id}')">Edit</button>
          <button class="btn-sm btn-danger" onclick="deleteRoom('${r.id}','${r.name}')">Delete</button>
        </div>
      </div>`).join('');
  }

  // ── ROOM DETAIL (independent room environment) ──────────────────────────
  function renderRoomDetail(roomId) {
    const r = rooms.find(x=>x.id===roomId);
    const el = document.getElementById('room-detail-content');
    if (!r) { el.innerHTML = '<div class="empty-state"><p>Room not found.</p></div>'; return; }
    document.getElementById('topbar-title').textContent = r.name;
    const tenant = tenants.find(t=>t.roomId===r.id);
    const roomReadings = readings.filter(x=>x.roomId===r.id);
    const roomBills = bills.filter(x=>x.roomId===r.id);
    const roomComplaints = complaints.filter(x=>x.roomId===r.id);
    const pdfCount = roomBills.filter(b=>b.pdfDataUrl).length;

    el.innerHTML = `
      <div class="room-detail-header">
        <div>
          <h1 class="page-title">${r.name} <span class="status-badge status-${r.status}">${r.status}</span></h1>
          <div class="room-meta">${r.floor?`<span>Floor ${r.floor}</span>`:''} ${r.desc?`<span>${r.desc}</span>`:''}</div>
        </div>
        <div class="card-actions">
          <button class="btn-sm btn-secondary" onclick="editRoom('${r.id}')">Edit Room</button>
          <button class="btn-primary" onclick="backToRooms()">← All Rooms</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Monthly Rent</div><div class="stat-value accent" style="font-size:16px">KES ${(r.rent||0).toLocaleString()}</div></div>
        <div class="stat-card"><div class="stat-label">Water / Power Rate</div><div class="stat-value" style="font-size:16px">${r.waterRate||0} / ${r.powerRate||0}</div></div>
        <div class="stat-card"><div class="stat-label">Baseline (last paid bill)</div><div class="stat-value" style="font-size:16px">💧${r.lastWaterReading ?? r.initWater ?? 0} ⚡${r.lastPowerReading ?? r.initPower ?? 0}</div></div>
        <div class="stat-card"><div class="stat-label">PDF Slips</div><div class="stat-value dim">${pdfCount}</div></div>
      </div>

      <div class="dash-card" style="margin-bottom:16px">
        <div class="dash-card-title">Tenant</div>
        ${tenant ? `<div class="room-notes"><strong>${tenant.name}</strong> · ${tenant.phone||'—'} · ${tenant.email||'—'}<br>Move-in: ${tenant.moveIn||'—'} · Lease end: ${tenant.leaseEnd||'—'}</div>
          <div class="card-actions"><button class="btn-sm btn-secondary" onclick="editTenant('${tenant.id}')">Edit Tenant</button></div>`
          : `<div class="room-notes">No tenant assigned to this room.</div><div class="card-actions"><button class="btn-sm btn-primary" onclick="openNewModal('modal-tenant');setVal('tf-roomId','${r.id}')">+ Assign Tenant</button></div>`}
      </div>

      <div class="dash-grid">
        <div class="dash-card">
          <div class="dash-card-title">Reading History (${roomReadings.length}) <button class="btn-xs btn-primary" style="float:right" onclick="openNewModal('modal-reading');setVal('rdf-roomId','${r.id}')">+ Add</button></div>
          <ul>${roomReadings.length? roomReadings.map(x=>`<li class="pending-item"><span class="pi-room">${x.date}</span><span class="num-cell">💧${x.water??'—'} ⚡${x.power??'—'}</span></li>`).join('') : '<li class="empty-item">No readings yet</li>'}</ul>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Complaints & Notes (${roomComplaints.length}) <button class="btn-xs btn-primary" style="float:right" onclick="openNewModal('modal-complaint');setVal('cf-roomId','${r.id}')">+ Add</button></div>
          <ul>${roomComplaints.length? roomComplaints.map(x=>`<li class="pending-item"><span class="pi-room">${x.subject} <span class="pi-month tag-${x.type}">${x.type}</span></span><span class="status-badge status-${x.status}">${x.status}</span></li>`).join('') : '<li class="empty-item">Nothing logged</li>'}</ul>
        </div>
      </div>

      <div class="dash-card" style="margin-top:16px">
        <div class="dash-card-title">Billing History & PDF Catalog (${roomBills.length}) <button class="btn-xs btn-primary" style="float:right" onclick="openNewModal('modal-billing');setVal('bf-roomId','${r.id}');bfRoomChanged()">+ Generate Bill</button></div>
        <div class="table-wrap">
          <table><thead><tr><th>Month</th><th>Total</th><th>Status</th><th>Slip / Send</th></tr></thead>
          <tbody>${roomBills.length? roomBills.map(b=>`<tr class="${b.paid?'row-paid':''}">
              <td>${b.month||'—'}</td>
              <td class="num-cell">KES ${(b.total||0).toLocaleString('en-KE',{minimumFractionDigits:2})}</td>
              <td><span class="status-badge status-${b.paid?'occupied':'unpaid'}">${b.paid?'Paid':'Unpaid'}</span></td>
              <td class="td-actions">${b.pdfDataUrl ? `<a class="btn-xs btn-secondary" href="${b.pdfDataUrl}" download="${(r.name||'room')}-${b.month||'bill'}.pdf">⬇ PDF</a>` : `<button class="btn-xs btn-secondary" onclick="generateBillPdf('${b.id}')">📄 PDF</button>`}<button class="btn-xs btn-sms" onclick="sendBillSms('${b.id}')" title="Send via SMS">📲 SMS</button><button class="btn-xs btn-whatsapp" onclick="sendBillWhatsApp('${b.id}')" title="Send via WhatsApp">💬 WA</button></td>
            </tr>`).join('') : '<tr><td colspan="4" class="empty-td">No bills yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }
  window.editRoom = function(id) {
    const r=rooms.find(x=>x.id===id); if(!r) return;
    editTarget=r;
    fillForm('room-form',{'rf-name':r.name,'rf-floor':r.floor,'rf-desc':r.desc,'rf-rent':r.rent,'rf-waterRate':r.waterRate,'rf-powerRate':r.powerRate,'rf-initWater':r.initWater,'rf-initPower':r.initPower,'rf-paymentDesc':r.paymentDesc,'rf-status':r.status});
    document.getElementById('room-form-title').textContent='Edit Room';
    openModal('modal-room');
  };
  window.deleteRoom = async function(id,name) {
    if(!confirm(`Delete room "${name}"?`)) return;
    try{ await delDoc('rooms',id); showToast('Room deleted'); }
    catch(e){ showToast(e.message,'error'); }
  };
  window.saveRoom = async function() {
    const name=val('rf-name'); if(!name){ showToast('Room name required','error'); return; }
    const data={name,floor:val('rf-floor'),desc:val('rf-desc'),rent:num('rf-rent'),waterRate:num('rf-waterRate'),powerRate:num('rf-powerRate'),initWater:num('rf-initWater'),initPower:num('rf-initPower'),paymentDesc:val('rf-paymentDesc'),status:val('rf-status')||'vacant'};
    // "Meter replaced" — the landlord is telling us the physical meter was
    // swapped, so the old carried-forward baseline no longer applies and
    // the new Initial Reading fields become the fresh baseline instead.
    if (document.getElementById('rf-meterReplaced')?.checked) {
      data.lastWaterReading = num('rf-initWater');
      data.lastPowerReading = num('rf-initPower');
      data.meterReplacedAt = new Date().toISOString();
    }
    try{
      if(editTarget) await setDoc2('rooms',editTarget.id,data); else await addDoc2('rooms',data);
      showToast(editTarget?'Room updated':'Room added'); closeModal('modal-room');
    }catch(e){ showToast(e.message,'error'); }
  };

  // ── TENANTS ───────────────────────────────────────────────────────────────
  function renderTenantsTable() {
    const tbody=document.getElementById('tenants-tbody');
    if(tenants.length===0){ tbody.innerHTML='<tr><td colspan="7" class="empty-td">No tenants yet.</td></tr>'; return; }
    tbody.innerHTML=tenants.map(t=>{ const room=rooms.find(r=>r.id===t.roomId); return `<tr><td><strong>${t.name}</strong><br><small class="text-dim">${t.idNum||''}</small></td><td>${room?room.name:'<em>Unassigned</em>'}</td><td>${t.phone||'—'}</td><td>${t.email||'—'}</td><td>${t.moveIn||'—'}</td><td>${t.leaseEnd||'—'}</td><td class="td-actions"><button class="btn-xs btn-secondary" onclick="editTenant('${t.id}')">Edit</button><button class="btn-xs btn-danger" onclick="deleteTenant('${t.id}','${t.name}')">Delete</button></td></tr>`; }).join('');
  }
  window.editTenant = function(id) {
    const t=tenants.find(x=>x.id===id); if(!t) return;
    editTarget=t;
    fillForm('tenant-form',{'tf-name':t.name,'tf-idNum':t.idNum,'tf-phone':t.phone,'tf-email':t.email,'tf-gender':t.gender,'tf-occupants':t.occupants,'tf-moveIn':t.moveIn,'tf-leaseEnd':t.leaseEnd,'tf-roomId':t.roomId,'tf-deposit':t.deposit,'tf-notes':t.notes});
    document.getElementById('tenant-form-title').textContent='Edit Tenant';
    openModal('modal-tenant');
  };
  window.deleteTenant = async function(id,name) {
    if(!confirm(`Remove tenant "${name}"?`)) return;
    try{ await delDoc('tenants',id); showToast('Tenant removed'); }
    catch(e){ showToast(e.message,'error'); }
  };
  window.saveTenant = async function() {
    const name=val('tf-name'); if(!name){ showToast('Name required','error'); return; }
    const data={name,idNum:val('tf-idNum'),phone:val('tf-phone'),email:val('tf-email'),gender:val('tf-gender'),occupants:parseInt(val('tf-occupants'))||1,moveIn:val('tf-moveIn'),leaseEnd:val('tf-leaseEnd'),roomId:val('tf-roomId'),deposit:num('tf-deposit'),notes:val('tf-notes')};
    try{
      if(editTarget) await setDoc2('tenants',editTarget.id,data); else await addDoc2('tenants',data);
      if(data.roomId) await updDoc('rooms',data.roomId,{status:'occupied'});
      showToast(editTarget?'Tenant updated':'Tenant added'); closeModal('modal-tenant');
    }catch(e){ showToast(e.message,'error'); }
  };

  // ── READINGS ──────────────────────────────────────────────────────────────
  function renderReadings(list) {
    const tbody=document.getElementById('readings-tbody');
    if(list.length===0){ tbody.innerHTML='<tr><td colspan="7" class="empty-td">No readings recorded.</td></tr>'; return; }
    tbody.innerHTML=list.map(r=>{ const room=rooms.find(x=>x.id===r.roomId); return `<tr><td>${r.date||'—'}</td><td>${room?room.name:'—'}</td><td class="num-cell">💧 ${r.water??'—'}</td><td class="num-cell">⚡ ${r.power??'—'}</td><td><span class="status-badge status-${r.rentStatus||'unpaid'}">${r.rentStatus||'—'}</span></td><td class="num-cell">${r.amountPaid?'KES '+r.amountPaid.toLocaleString():'—'}</td><td><button class="btn-xs btn-danger" onclick="deleteReading('${r.id}')">✕</button></td></tr>`; }).join('');
  }
  window.filterReadings = function() { const roomId=document.getElementById('readings-room-filter').value; renderReadings(roomId?readings.filter(r=>r.roomId===roomId):readings); };
  window.deleteReading = async function(id) {
    if(!confirm('Delete this reading?')) return;
    try{ await delDoc('readings',id); showToast('Deleted'); }
    catch(e){ showToast(e.message,'error'); }
  };
  window.saveReading = async function() {
    const roomId=val('rdf-roomId'),date=val('rdf-date');
    if(!roomId||!date){ showToast('Room and date required','error'); return; }
    const data={roomId,date,water:num('rdf-water'),power:num('rdf-power'),rentStatus:val('rdf-rentStatus')||'paid',amountPaid:num('rdf-amountPaid'),notes:val('rdf-notes')};
    try{ await addDoc2('readings',data); showToast('Reading saved'); closeModal('modal-reading'); }
    catch(e){ showToast(e.message,'error'); }
  };

  // ── BILLING ───────────────────────────────────────────────────────────────
  // Reading-consistency rule: once a bill is finalized, its Final Reading
  // becomes the locked default Initial Reading for that room's next bill —
  // so nothing gets typed twice and nothing drifts out of sync. The
  // "Meter replaced" checkbox on the room is the only way to override it.
  function setupBillingForm() {
    document.getElementById('bf-roomId').onchange = bfRoomChanged;
  }
  window.bfRoomChanged = function(){
    const room=rooms.find(r=>r.id===val('bf-roomId')); if(!room) return;
    setVal('bf-baseRent',room.rent); setVal('bf-waterRate',room.waterRate); setVal('bf-powerRate',room.powerRate);
    const hasBaseline = room.lastWaterReading!=null || room.lastPowerReading!=null;
    const wInit = hasBaseline ? (room.lastWaterReading ?? 0) : (room.initWater||0);
    const pInit = hasBaseline ? (room.lastPowerReading ?? 0) : (room.initPower||0);
    setVal('bf-waterInit', wInit); setVal('bf-powerInit', pInit);
    // Lock the carried-forward baseline to keep readings consistent bill to
    // bill — landlord can still unlock via "Meter replaced" on the room.
    document.getElementById('bf-waterInit').readOnly = true;
    document.getElementById('bf-powerInit').readOnly = true;
    document.getElementById('bf-baseline-note').textContent = hasBaseline
      ? '🔒 Carried forward from the last PAID bill for consistency. To change it, edit the room and check "Meter replaced".'
      : 'ℹ First bill for this room — using its Initial Reading.';
    setVal('bf-waterFinal',''); setVal('bf-powerFinal','');
    calculateBill();
  };
  function setDefaultMonth(){ const now=new Date(); setVal('bf-month',`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`); }
  window.calculateBill = function(){
    const wI=num('bf-waterInit'),wF=num('bf-waterFinal'),pI=num('bf-powerInit'),pF=num('bf-powerFinal');
    const wR=num('bf-waterRate'),pR=num('bf-powerRate'),rent=num('bf-baseRent');
    const wUsed=Math.max(0,wF-wI),pUsed=Math.max(0,pF-pI),wCost=wUsed*wR,pCost=pUsed*pR,total=rent+wCost+pCost;
    document.getElementById('bill-preview').style.display='block';
    document.getElementById('bp-water').textContent=`Water: ${wI} → ${wF}  (${wUsed.toFixed(2)} units × ${wR}) = KES ${wCost.toFixed(2)}`;
    document.getElementById('bp-power').textContent=`Power: ${pI} → ${pF}  (${pUsed.toFixed(2)} kWh × ${pR}) = KES ${pCost.toFixed(2)}`;
    document.getElementById('bp-rent').textContent=`Rent: KES ${rent.toFixed(2)}`;
    document.getElementById('bp-total').textContent=`Total: KES ${total.toFixed(2)}`;
    document.getElementById('saveBillBtn').disabled=false;
  };
  window.saveBill = async function(){
    const roomId=val('bf-roomId'),month=val('bf-month');
    if(!roomId){ showToast('Select a room','error'); return; }
    if(!month){ showToast('Month required','error'); return; }
    const wI=num('bf-waterInit'),wF=num('bf-waterFinal'),pI=num('bf-powerInit'),pF=num('bf-powerFinal');
    const wR=num('bf-waterRate'),pR=num('bf-powerRate'),rent=num('bf-baseRent');
    const wUsed=Math.max(0,wF-wI),pUsed=Math.max(0,pF-pI),wCost=wUsed*wR,pCost=pUsed*pR;
    const data={roomId,month,rent,waterInit:wI,waterFinal:wF,waterUsed:wUsed,waterRate:wR,waterCost:wCost,powerInit:pI,powerFinal:pF,powerUsed:pUsed,powerRate:pR,powerCost:pCost,total:rent+wCost+pCost,paid:false,createdAt:new Date().toISOString()};
    try{
      await addDoc2('bills',data);
      // The reading baseline does NOT move yet — it only carries forward
      // once this bill is marked Paid (see markBillPaidAndCarryForward),
      // so an unpaid or since-corrected bill can never poison next month's
      // starting reading.
      showToast('Bill saved'); closeModal('modal-billing');
    }
    catch(e){ showToast(e.message,'error'); }
  };
  window.togglePaid = async function(id,current){
    try{
      if (!current) { await markBillPaidAndCarryForward(id); showToast('Marked paid — reading baseline carried forward'); }
      else { await updDoc('bills',id,{paid:false}); showToast('Marked unpaid'); }
    }catch(e){ showToast(e.message,'error'); }
  };
  window.deleteBill = async function(id){ if(!confirm('Delete this bill?')) return; try{ await delDoc('bills',id); showToast('Deleted'); }catch(e){ showToast(e.message,'error'); } };

  // ── OFFICIAL PDF PAYMENT SLIP ────────────────────────────────────────────
  // Builds the formal invoice/statement layout with jsPDF from a flat
  // "meta" object, so the exact same renderer works both for the
  // landlord's own in-app PDF and for the public slip page a tenant opens
  // from an SMS/WhatsApp link (see buildInvoicePdf below).
  function buildInvoicePdf(meta) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const marginX = 48;
    let y = 56;

    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(20,20,20);
    doc.text(meta.buildingName || 'RentReview', marginX, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(100,100,100);
    doc.text('Official Payment Statement', marginX, y+16);
    doc.setFontSize(9);
    if (meta.issuedBy) doc.text(`Issued by ${meta.issuedBy}`, pageW-marginX, y-4, { align:'right' });
    doc.text(`Generated: ${meta.generatedAt || new Date().toLocaleString('en-KE')}`, pageW-marginX, y+10, { align:'right' });
    y += 30;
    doc.setDrawColor(180,180,180); doc.line(marginX, y, pageW-marginX, y);
    y += 26;

    doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20,20,20);
    doc.text('PAYMENT INVOICE', marginX, y); y += 22;
    doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(40,40,40);
    const metaLeft = [
      ['Room', meta.roomName || '—'],
      ['Billing Month', meta.month || '—'],
      ['Status', meta.paid ? 'PAID' : 'PENDING'],
    ];
    const metaRight = [
      ['Tenant', meta.tenantName || '—'],
      ['Phone', meta.tenantPhone || '—'],
      ['Email', meta.tenantEmail || '—'],
    ];
    let my = y;
    metaLeft.forEach(([k,v])=>{ doc.setFont('helvetica','bold'); doc.text(k+':', marginX, my); doc.setFont('helvetica','normal'); doc.text(String(v), marginX+90, my); my+=16; });
    let my2 = y;
    metaRight.forEach(([k,v])=>{ doc.setFont('helvetica','bold'); doc.text(k+':', marginX+280, my2); doc.setFont('helvetica','normal'); doc.text(String(v), marginX+350, my2); my2+=16; });
    y = Math.max(my,my2) + 18;

    const col = [marginX, marginX+230, marginX+330, marginX+430];
    doc.setFillColor(30,30,30); doc.rect(marginX, y, pageW-2*marginX, 22, 'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('Item', col[0]+8, y+15); doc.text('Detail', col[1], y+15); doc.text('Rate', col[2], y+15); doc.text('Amount (KES)', pageW-marginX-8, y+15, { align:'right' });
    y += 22;
    doc.setTextColor(30,30,30); doc.setFont('helvetica','normal');
    const rows = [
      ['Rent', '—', '—', (meta.rent||0)],
      ['Water', `${meta.waterInit??0} → ${meta.waterFinal??0}  (${(meta.waterUsed||0).toFixed(2)} units)`, String(meta.waterRate||0), (meta.waterCost||0)],
      ['Power', `${meta.powerInit??0} → ${meta.powerFinal??0}  (${(meta.powerUsed||0).toFixed(2)} kWh)`, String(meta.powerRate||0), (meta.powerCost||0)],
    ];
    rows.forEach((r,i)=>{
      const ry = y + i*22 + 15;
      if (i%2===1) { doc.setFillColor(245,245,245); doc.rect(marginX, y+i*22, pageW-2*marginX, 22, 'F'); }
      doc.text(r[0], col[0]+8, ry); doc.text(r[1], col[1], ry); doc.text(r[2], col[2], ry);
      doc.text(Number(r[3]).toLocaleString('en-KE',{minimumFractionDigits:2}), pageW-marginX-8, ry, { align:'right' });
    });
    y += rows.length*22 + 6;
    doc.setDrawColor(180,180,180); doc.line(marginX, y, pageW-marginX, y); y += 20;

    doc.setFont('helvetica','bold'); doc.setFontSize(13);
    doc.text('TOTAL DUE', marginX, y);
    doc.text(`KES ${(meta.total||0).toLocaleString('en-KE',{minimumFractionDigits:2})}`, pageW-marginX-8, y, { align:'right' });
    y += 34;

    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(90,90,90);
    doc.text(meta.paymentDesc || 'Please settle this amount by the agreed due date.', marginX, y);
    y += 40;
    doc.setDrawColor(210,210,210); doc.line(marginX, y, pageW-marginX, y); y += 16;
    doc.setFontSize(8.5); doc.setTextColor(140,140,140);
    doc.text(`${meta.buildingName || 'RentReview'} · Generated automatically via RentReview · This is a system-generated statement.`, marginX, y);
    return doc;
  }

  function billToMeta(b, room, tenant) {
    return {
      buildingName, roomName: room?room.name:null, tenantName: tenant?tenant.name:null,
      tenantPhone: tenant?tenant.phone:null, tenantEmail: tenant?tenant.email:null,
      month: b.month, paid: !!b.paid, rent: b.rent||0,
      waterInit: b.waterInit, waterFinal: b.waterFinal, waterUsed: b.waterUsed, waterRate: b.waterRate, waterCost: b.waterCost||0,
      powerInit: b.powerInit, powerFinal: b.powerFinal, powerUsed: b.powerUsed, powerRate: b.powerRate, powerCost: b.powerCost||0,
      total: b.total||0, paymentDesc: room?.paymentDesc, issuedBy: currentUser?.email,
    };
  }

  // ── SHAREABLE SLIP LINK (no Firebase Storage needed) ─────────────────────
  // Instead of uploading a PDF file anywhere, we publish just the bill's
  // display data to a public Firestore doc (small, text-only) and hand out
  // a link back into this same app: rentreview.html?slip=<id>. Opening
  // that link — no sign-in required — shows the tenant a clean invoice
  // page and lets *their own browser* generate and download the PDF on
  // the spot via jsPDF. Nothing is ever hosted or stored as a file.
  async function ensureShareLink(billId) {
    const b = bills.find(x=>x.id===billId);
    if (!b) throw new Error('Bill not found');
    const room = rooms.find(r=>r.id===b.roomId);
    const tenant = tenants.find(t=>t.roomId===b.roomId);
    const meta = billToMeta(b, room, tenant);
    meta.generatedAt = new Date().toLocaleString('en-KE');
    meta.ownerUid = currentUser.uid;
    try {
      await setDoc(doc(db,'publicSlips',billId), meta, { merge:true });
    } catch(e) {
      console.error('publicSlips write failed', e);
      throw new Error('Could not publish the shareable slip — check the publicSlips Firestore rule (see setup notes).');
    }
    const shareUrl = `${location.origin}${location.pathname}?slip=${billId}`;
    const dataUrl = buildInvoicePdf(meta).output('datauristring');
    await updDoc('bills', billId, { pdfDataUrl:dataUrl, shareUrl, pdfGeneratedAt:new Date().toISOString() });
    return { dataUrl, shareUrl };
  }

  window.generateBillPdf = async function(billId) {
    try { await ensureShareLink(billId); showToast('Slip ready ✓'); }
    catch(e) { console.error(e); showToast(e.message, 'error'); }
  };

  // ── SEND SLIP VIA SMS / WHATSAPP ─────────────────────────────────────────
  // The only thing we need from the account is the tenant's phone number —
  // everything else (link, message wording, country-code formatting) is
  // automatic. SMS uses the standard "sms:" URI scheme (opens the phone's
  // native Messages app pre-filled); WhatsApp uses the official wa.me
  // click-to-chat link. Both are native browser/OS behaviour — no paid
  // SMS gateway, no file storage, nothing that can silently break.
  function billMessageText(b, room, tenant, shareUrl) {
    const who = tenant?.name ? `Hi ${tenant.name},` : 'Hi,';
    return `${who} here is your ${b.month||''} rent statement for ${room?room.name:'your room'} at ${buildingName||'RentReview'}. `
         + `Total due: KES ${(b.total||0).toLocaleString('en-KE',{minimumFractionDigits:2})}. `
         + `View/download your slip: ${shareUrl}`;
  }

  async function resolveSendTarget(billId) {
    const b = bills.find(x=>x.id===billId); if(!b) throw new Error('Bill not found');
    const room = rooms.find(r=>r.id===b.roomId);
    const tenant = tenants.find(t=>t.roomId===b.roomId);
    if (!tenant)            throw new Error('No tenant assigned to this room yet');
    if (!tenant.phone)      throw new Error('No phone number on file for this tenant');
    const phone = normalizePhone(tenant.phone);
    if (!phone)             throw new Error(`Couldn't recognize "${tenant.phone}" as a valid phone number`);
    return { b, room, tenant, phone };
  }

  window.sendBillSms = async function(billId) {
    try {
      const { b, room, tenant, phone } = await resolveSendTarget(billId);
      showToast('Preparing slip…');
      const { shareUrl } = await ensureShareLink(billId);
      const text = billMessageText(b, room, tenant, shareUrl);
      // iOS and Android use different separators for a pre-filled SMS body —
      // this is the well-known, widely-used compatibility trick.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const sep = isIOS ? '&' : '?';
      window.location.href = `sms:${phone}${sep}body=${encodeURIComponent(text)}`;
    } catch(e) { showToast(e.message, 'error'); }
  };

  window.sendBillWhatsApp = async function(billId) {
    try {
      const { b, room, tenant, phone } = await resolveSendTarget(billId);
      showToast('Preparing slip…');
      const { shareUrl } = await ensureShareLink(billId);
      const text = billMessageText(b, room, tenant, shareUrl);
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
    } catch(e) { showToast(e.message, 'error'); }
  };

  // ── PUBLIC SLIP PAGE ──────────────────────────────────────────────────────
  // Reached via ?slip=<billId> with no sign-in. Reads the one sanitized
  // public doc for that bill and renders a clean, mobile-friendly invoice
  // the tenant can view, print, or download as a PDF generated right in
  // their own browser.
  async function renderPublicSlipPage(slipId) {
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('onboardScreen').style.display='none';
    document.getElementById('appShell').style.display='none';
    const el = document.getElementById('slipScreen');
    el.style.display='flex';
    el.innerHTML = `<div class="slip-box"><div class="slip-loading">Loading your statement…</div></div>`;
    let meta;
    try {
      const snap = await getDoc(doc(db,'publicSlips',slipId));
      if (!snap.exists()) throw new Error('not found');
      meta = snap.data();
    } catch(e) {
      el.innerHTML = `<div class="slip-box"><div class="slip-logo">⚠️</div><h2>Statement not found</h2><p class="slip-sub">This link may have expired or is no longer available. Please contact your landlord for an updated statement.</p></div>`;
      return;
    }
    window.__slipMeta = meta; // used by the Download button below
    el.innerHTML = `
      <div class="slip-box">
        <div class="slip-header">
          <div>
            <div class="slip-brand">${meta.buildingName || 'RentReview'}</div>
            <div class="slip-sub">Official Payment Statement</div>
          </div>
          <span class="status-badge status-${meta.paid?'occupied':'unpaid'}">${meta.paid?'PAID':'PENDING'}</span>
        </div>
        <div class="slip-meta">
          <div><span>Room</span><b>${meta.roomName||'—'}</b></div>
          <div><span>Tenant</span><b>${meta.tenantName||'—'}</b></div>
          <div><span>Billing Month</span><b>${meta.month||'—'}</b></div>
          <div><span>Generated</span><b>${meta.generatedAt||'—'}</b></div>
        </div>
        <table class="slip-table">
          <thead><tr><th>Item</th><th>Detail</th><th>Rate</th><th style="text-align:right">Amount (KES)</th></tr></thead>
          <tbody>
            <tr><td>Rent</td><td>—</td><td>—</td><td class="num-cell">${(meta.rent||0).toLocaleString('en-KE',{minimumFractionDigits:2})}</td></tr>
            <tr><td>Water</td><td>${meta.waterInit??0} → ${meta.waterFinal??0} (${(meta.waterUsed||0).toFixed(2)} units)</td><td>${meta.waterRate||0}</td><td class="num-cell">${(meta.waterCost||0).toLocaleString('en-KE',{minimumFractionDigits:2})}</td></tr>
            <tr><td>Power</td><td>${meta.powerInit??0} → ${meta.powerFinal??0} (${(meta.powerUsed||0).toFixed(2)} kWh)</td><td>${meta.powerRate||0}</td><td class="num-cell">${(meta.powerCost||0).toLocaleString('en-KE',{minimumFractionDigits:2})}</td></tr>
          </tbody>
        </table>
        <div class="slip-total"><span>Total Due</span><b>KES ${(meta.total||0).toLocaleString('en-KE',{minimumFractionDigits:2})}</b></div>
        ${meta.paymentDesc ? `<div class="slip-note">${meta.paymentDesc}</div>` : ''}
        <div class="slip-actions">
          <button class="btn-primary" onclick="downloadSlipPdf()">⬇ Download PDF</button>
          <button class="btn-secondary" onclick="window.print()">🖨 Print</button>
        </div>
        <div class="slip-footer">Powered by RentReview</div>
      </div>`;
  }
  window.downloadSlipPdf = function() {
    const meta = window.__slipMeta; if (!meta) return;
    const filename = `${(meta.roomName||'room')}-${meta.month||'bill'}.pdf`.replace(/\s+/g,'-');
    buildInvoicePdf(meta).save(filename);
  };

  function renderBills(list){
    const tbody=document.getElementById('bills-tbody');
    if(list.length===0){ tbody.innerHTML='<tr><td colspan="8" class="empty-td">No bills yet.</td></tr>'; return; }
    tbody.innerHTML=list.map(b=>{
      const room=rooms.find(r=>r.id===b.roomId);
      const pdfCell = b.pdfDataUrl
        ? `<a class="btn-xs btn-secondary" href="${b.pdfDataUrl}" download="${(room?room.name:'room')}-${b.month||'bill'}.pdf">⬇ PDF</a>`
        : `<button class="btn-xs btn-secondary" onclick="generateBillPdf('${b.id}')">📄 PDF</button>`;
      return `<tr class="${b.paid?'row-paid':''}"><td>${b.month||'—'}</td><td>${room?room.name:'—'}</td><td class="num-cell">KES ${(b.waterCost||0).toFixed(2)}</td><td class="num-cell">KES ${(b.powerCost||0).toFixed(2)}</td><td class="num-cell">KES ${(b.rent||0).toFixed(2)}</td><td class="num-cell total-cell">KES ${(b.total||0).toLocaleString('en-KE',{minimumFractionDigits:2})}</td><td class="td-actions"><button class="btn-xs ${b.paid?'btn-secondary':'btn-green'}" onclick="togglePaid('${b.id}',${b.paid})">${b.paid?'Paid ✓':'Mark Paid'}</button>${pdfCell}<button class="btn-xs btn-sms" onclick="sendBillSms('${b.id}')" title="Send via SMS">📲 SMS</button><button class="btn-xs btn-whatsapp" onclick="sendBillWhatsApp('${b.id}')" title="Send via WhatsApp">💬 WA</button><button class="btn-xs btn-danger" onclick="deleteBill('${b.id}')">✕</button></td></tr>`;
    }).join('');
  }
  window.filterBills = function(){ const roomId=document.getElementById('bills-room-filter').value; renderBills(roomId?bills.filter(b=>b.roomId===roomId):bills); };

  // ── COMPLAINTS ────────────────────────────────────────────────────────────
  function renderComplaints(list){
    const grid=document.getElementById('complaints-grid');
    if(list.length===0){ grid.innerHTML='<div class="empty-state"><div class="empty-icon">📋</div><p>No items logged.</p></div>'; return; }
    grid.innerHTML=list.map(c=>{ const room=rooms.find(r=>r.id===c.roomId); return `<div class="complaint-card type-${c.type}"><div class="complaint-header"><span class="tag-${c.type} comp-type-badge">${c.type}</span><span class="status-badge status-${c.status}">${c.status}</span><span class="comp-date">${c.date||''}</span></div><div class="comp-room">${room?room.name:'—'}</div><div class="comp-subject">${c.subject||''}</div><div class="comp-body">${c.body||''}</div><div class="card-actions">${c.status!=='resolved'?`<button class="btn-sm btn-green" onclick="resolveComplaint('${c.id}')">Resolve</button>`:''}<button class="btn-sm btn-danger" onclick="deleteComplaint('${c.id}')">Delete</button></div></div>`; }).join('');
  }
  window.filterComplaints = function(){
    const roomId=document.getElementById('complaints-room-filter').value;
    const status=document.getElementById('complaints-status-filter').value;
    let list=complaints;
    if(roomId) list=list.filter(c=>c.roomId===roomId);
    if(status) list=list.filter(c=>c.status===status);
    renderComplaints(list);
  };
  window.resolveComplaint = async function(id){ try{ await updDoc('complaints',id,{status:'resolved'}); showToast('Marked resolved'); }catch(e){ showToast(e.message,'error'); } };
  window.deleteComplaint  = async function(id){ if(!confirm('Delete this entry?')) return; try{ await delDoc('complaints',id); showToast('Deleted'); }catch(e){ showToast(e.message,'error'); } };
  window.saveComplaint = async function(){
    const subject=val('cf-subject'); if(!subject){ showToast('Subject required','error'); return; }
    const data={roomId:val('cf-roomId'),type:val('cf-type')||'complaint',subject,body:val('cf-body'),status:'open',date:new Date().toISOString().slice(0,10)};
    try{ await addDoc2('complaints',data); showToast('Logged'); closeModal('modal-complaint'); }
    catch(e){ showToast(e.message,'error'); }
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  AI PAGE
  // ═══════════════════════════════════════════════════════════════════════

  async function initAiPage() {
    updateModelBadge();
    if (!document.getElementById('ai-messages').children.length) {
      appendAiBubble("Hello! I'm your Rent Review AI agent. I have full access to all your property data — rooms, tenants, bills, meter readings, and complaints. What would you like to know?");
      await prefetchAiData();
    }
  }

  async function prefetchAiData() {
    setAiThinking(true);
    try {
      const [r,t,b,rd,c] = await Promise.all([
        getCol('rooms',orderBy('name')),
        getCol('tenants',orderBy('name')),
        getCol('bills',orderBy('month','desc')),
        getCol('readings',orderBy('date','desc')),
        getCol('complaints',orderBy('date','desc'))
      ]);
      aiSnapshot = { rooms:r, tenants:t, bills:b, readings:rd, complaints:c };
      setAiThinking(false);
      appendAiBubble(`✓ Property data loaded — ${r.length} rooms · ${t.length} tenants · ${b.length} bills · ${rd.length} readings · ${c.length} complaints.\n\nAsk me anything!`);
    } catch(e) {
      setAiThinking(false);
      appendAiBubble('⚠ Could not load property data: ' + e.message);
    }
  }

  window.sendAiMessage = async function() {
    const input = document.getElementById('aiInput');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    appendUserBubble(q);
    setAiThinking(true);
    document.getElementById('ai-send-btn').disabled = true;

    if (!aiSnapshot) {
      try {
        const [r,t,b,rd,c] = await Promise.all([
          getCol('rooms',orderBy('name')),
          getCol('tenants',orderBy('name')),
          getCol('bills',orderBy('month','desc')),
          getCol('readings',orderBy('date','desc')),
          getCol('complaints',orderBy('date','desc'))
        ]);
        aiSnapshot = { rooms:r, tenants:t, bills:b, readings:rd, complaints:c };
      } catch(e) {
        setAiThinking(false);
        document.getElementById('ai-send-btn').disabled=false;
        appendAiBubble('⚠ Could not load data: '+e.message);
        return;
      }
    }

    const propertyContext = buildPromptString(aiSnapshot);
    const userMessage = `=== PROPERTY DATA ===\n${propertyContext}\n=== END DATA ===\n\nQuestion: ${q}`;

    // Add to chat history (keep last 6 turns to save tokens)
    chatHistory.push({ role:'user', content: userMessage });
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

    try {
      const answer = await callGroq(chatHistory);
      chatHistory.push({ role:'assistant', content: answer });
      setAiThinking(false);
      document.getElementById('ai-send-btn').disabled=false;
      appendAiBubble(answer);
    } catch(e) {
      setAiThinking(false);
      document.getElementById('ai-send-btn').disabled=false;
      appendAiBubble('⚠ '+e.message);
    }
  };

  async function callGroq(messages) {
    const apiKey = AiPrefs.get('apiKey');
    if (!apiKey) throw new Error('No API key set. Go to AI Settings to add your Groq key.');
    const body = {
      model:       AiPrefs.get('model'),
      max_tokens:  AiPrefs.get('maxTokens'),
      temperature: AiPrefs.get('temperature'),
      messages: [
        { role:'system', content: AiPrefs.get('systemPrompt') },
        ...messages
      ]
    };
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+apiKey.trim() },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      throw new Error('Groq error '+res.status+': '+msg);
    }
    return data.choices[0].message.content.trim();
  }

  function buildPromptString(snap) {
    let sb = '';
    sb += `ROOMS (${snap.rooms.length}):\n`;
    snap.rooms.forEach(r => {
      sb += `  - [${r.id}] ${r.name} | Floor:${r.floor||''} | Rent:${r.rent||0} | Status:${r.status} | WaterRate:${r.waterRate||0} PowerRate:${r.powerRate||0}\n`;
    });
    sb += `\nTENANTS (${snap.tenants.length}):\n`;
    snap.tenants.forEach(t => {
      sb += `  - [${t.id}] ${t.name} | Phone:${t.phone||''} | Room:${t.roomId||''} | Move-in:${t.moveIn||''} | Lease-end:${t.leaseEnd||''} | Deposit:${t.deposit||0} | Occupants:${t.occupants||1}\n`;
    });
    let totalRevenue=0, totalPending=0;
    sb += `\nBILLS (${snap.bills.length}):\n`;
    snap.bills.forEach(b => {
      sb += `  - Room:${b.roomId} | Month:${b.month} | Rent:${b.rent||0} | Water:${b.waterCost||0} | Power:${b.powerCost||0} | Total:${b.total||0} | Paid:${b.paid?'YES':'NO'}\n`;
      if(b.paid) totalRevenue+=(b.total||0); else totalPending+=(b.total||0);
    });
    sb += `  SUMMARY: Collected revenue=${totalRevenue.toFixed(0)} | Outstanding=${totalPending.toFixed(0)}\n`;
    sb += `\nMETER READINGS (${snap.readings.length}):\n`;
    snap.readings.slice(0,20).forEach(r => {
      sb += `  - Room:${r.roomId} | Date:${r.date} | Water:${r.water||0} | Power:${r.power||0} | Rent-status:${r.rentStatus||''}\n`;
    });
    if(snap.readings.length>20) sb += `  ... (${snap.readings.length-20} older readings omitted)\n`;
    sb += `\nCOMPLAINTS/NOTES (${snap.complaints.length}):\n`;
    snap.complaints.forEach(c => {
      sb += `  - [${c.id}] Room:${c.roomId||''} | Type:${c.type} | Subject:${c.subject} | Status:${c.status} | Date:${c.date}\n`;
      if(c.body) sb += `    Body: ${c.body}\n`;
    });
    return sb;
  }

  window.clearAiChat = function() {
    document.getElementById('ai-messages').innerHTML = '';
    chatHistory = [];
    appendAiBubble("Chat cleared. Hello again! I'm your Rent Review AI agent. What would you like to know about your property?");
  };

  window.refreshAiData = async function() {
    aiSnapshot = null;
    chatHistory = [];
    appendAiBubble('♻ Refreshing property data…');
    await prefetchAiData();
  };

  function appendUserBubble(text) {
    const msgs = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = 'chat-bubble user-bubble';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function appendAiBubble(text) {
    const msgs = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = 'chat-bubble ai-bubble';
    // Basic markdown-ish: bold, line breaks
    div.innerHTML = text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
      .replace(/\n/g,'<br>');
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setAiThinking(on) {
    document.getElementById('ai-thinking').style.display = on ? 'flex' : 'none';
  }

  function updateModelBadge() {
    const badge = document.getElementById('ai-model-badge');
    if (!badge) return;
    const model = AiPrefs.get('model');
    const short = model.length > 20 ? model.substring(0,20)+'…' : model;
    badge.textContent = '⚡ ' + short;
  }

  // ── AI SETTINGS ───────────────────────────────────────────────────────────
  window.openAiSettings = function() {
    // Load current values into form
    setVal('ais-apikey', AiPrefs.get('apiKey'));
    document.getElementById('ais-model').value = AiPrefs.get('model');
    const temp = AiPrefs.get('temperature');
    document.getElementById('ais-temp').value = Math.round(temp*100);
    document.getElementById('ais-temp-label').textContent = temp.toFixed(2);
    const tokens = AiPrefs.get('maxTokens');
    const step = Math.max(0, Math.min(31, Math.round(tokens/128)-1));
    document.getElementById('ais-tokens').value = step;
    document.getElementById('ais-tokens-label').textContent = (step+1)*128;
    setVal('ais-prompt', AiPrefs.get('systemPrompt'));
    document.getElementById('ais-test-result').style.display = 'none';
    // mask key
    document.getElementById('ais-apikey').type = 'password';
    document.getElementById('ais-toggle-key').textContent = '👁';
    openModal('modal-ai-settings');
  };

  window.saveAiSettings = function() {
    const key    = val('ais-apikey');
    const model  = document.getElementById('ais-model').value;
    const temp   = parseInt(document.getElementById('ais-temp').value)/100;
    const tokens = (parseInt(document.getElementById('ais-tokens').value)+1)*128;
    const prompt = val('ais-prompt');
    if(!key)   { showToast('API key cannot be empty','error'); return; }
    if(!prompt){ showToast('System prompt cannot be empty','error'); return; }
    AiPrefs.set('apiKey', key);
    AiPrefs.set('model',  model);
    AiPrefs.set('temperature', temp);
    AiPrefs.set('maxTokens',   tokens);
    AiPrefs.set('systemPrompt', prompt);
    updateModelBadge();
    showToast('AI settings saved ✓');
    closeModal('modal-ai-settings');
  };

  window.resetAiDefaults = function() {
    if(!confirm('Reset all AI settings to defaults?')) return;
    AiPrefs.reset();
    openAiSettings(); // reload form
    showToast('Settings reset to defaults');
  };

  window.toggleKeyVisible = function() {
    const el  = document.getElementById('ais-apikey');
    const btn = document.getElementById('ais-toggle-key');
    if(el.type==='password'){ el.type='text';  btn.textContent='🙈'; }
    else                    { el.type='password'; btn.textContent='👁'; }
  };

  window.pasteApiKey = async function() {
    try {
      const text = await navigator.clipboard.readText();
      setVal('ais-apikey', text.trim());
      showToast('Key pasted from clipboard');
    } catch(e) { showToast('Could not read clipboard','error'); }
  };

  window.clearApiKey = function() {
    if(!confirm('Clear the saved API key?')) return;
    setVal('ais-apikey','');
    showToast('Key cleared');
  };

  window.testApiKey = async function() {
    const key = val('ais-apikey');
    if(!key){ showToast('Enter an API key first','error'); return; }
    const btn = document.getElementById('ais-test-btn');
    const result = document.getElementById('ais-test-result');
    btn.disabled=true; btn.textContent='Testing…';
    result.style.display='none';
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key.trim()},
        body:JSON.stringify({model:AI_DEFAULTS.model,max_tokens:10,temperature:0.1,messages:[{role:'system',content:'You are a test assistant.'},{role:'user',content:'Reply with exactly: KEY_OK'}]})
      });
      const data=await res.json();
      if(res.ok){
        result.textContent='✓ Connection successful!';
        result.className='test-result success';
      } else {
        result.textContent='✗ '+( data?.error?.message||res.status);
        result.className='test-result error';
      }
    } catch(e) {
      result.textContent='✗ Network error: '+e.message;
      result.className='test-result error';
    }
    result.style.display='block';
    btn.disabled=false; btn.textContent='Test Connection';
  };

  // Temperature + Tokens sliders
  window.onTempChange = function(v) {
    document.getElementById('ais-temp-label').textContent = (v/100).toFixed(2);
  };
  window.onTokensChange = function(v) {
    document.getElementById('ais-tokens-label').textContent = ((parseInt(v)+1)*128);
  };

  // ── Quick-ask suggestions ─────────────────────────────────────────────────
  window.askSuggestion = function(q) {
    document.getElementById('aiInput').value = q;
    sendAiMessage();
  };

  // ── Shared UI helpers ─────────────────────────────────────────────────────
  function val(id)    { return (document.getElementById(id)||{}).value?.trim()||''; }
  function num(id)    { return parseFloat(val(id))||0; }
  function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v??''; }
  function fillForm(fId,map){ Object.entries(map).forEach(([id,v])=>setVal(id,v)); }

  function populateRoomSelect(id) {
    const sel=document.getElementById(id); if(!sel) return;
    const cur=sel.value;
    sel.innerHTML='<option value="">— Select room —</option>'+rooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
    if(cur) sel.value=cur;
  }
  function populateRoomFilter(id,data) {
    const sel=document.getElementById(id); if(!sel) return;
    const ids=[...new Set(data.map(x=>x.roomId).filter(Boolean))];
    sel.innerHTML='<option value="">All rooms</option>'+ids.map(rid=>{ const room=rooms.find(r=>r.id===rid); return `<option value="${rid}">${room?room.name:rid}</option>`; }).join('');
  }

  function openModal(id) {
    document.getElementById(id).style.display='flex';
    const bp=document.getElementById('bill-preview'); if(bp) bp.style.display='none';
    const sb=document.getElementById('saveBillBtn');  if(sb) sb.disabled=true;
  }
  function closeModal(id) {
    document.getElementById(id).style.display='none';
    editTarget=null;
    document.querySelectorAll(`#${id} input:not([data-keep]),#${id} textarea:not([data-keep]),#${id} select:not([data-keep])`).forEach(el=>{
      if(el.tagName==='SELECT') el.selectedIndex=0;
      else if(el.type==='checkbox') el.checked=false;
      else el.value='';
    });
    const bn=document.getElementById('bf-baseline-note'); if(bn) bn.textContent='';
    const wi=document.getElementById('bf-waterInit'), pi=document.getElementById('bf-powerInit');
    if(wi) wi.readOnly=false; if(pi) pi.readOnly=false;
  }
  function showToast(msg,type='success') {
    const t=document.getElementById('toast');
    t.textContent=msg; t.className='toast toast-'+type;
    t.style.display='block';
    setTimeout(()=>{ t.style.display='none'; },3000);
  }

  window.openModal=openModal; window.closeModal=closeModal;
  window.saveRoom=saveRoom; window.saveTenant=saveTenant;
  window.saveReading=saveReading; window.saveBill=saveBill;
  window.saveComplaint=saveComplaint;
  window.filterReadings=filterReadings; window.filterBills=filterBills;
  window.filterComplaints=filterComplaints; window.calculateBill=calculateBill;
  window.toggleSidebar = function(){ document.getElementById('sidebar').classList.toggle('open'); };
  window.openNewModal = function(id) {
    editTarget=null;
    const titleMap={'modal-room':['room-form-title','Add Room'],'modal-tenant':['tenant-form-title','Add Tenant'],'modal-reading':['reading-form-title','Add Reading'],'modal-billing':['billing-form-title','Generate Bill'],'modal-complaint':['complaint-form-title','Log Entry']};
    const [tid,ttxt]=titleMap[id]||[];
    if(tid){ document.getElementById(tid).textContent=ttxt; }
    openModal(id);
  };
