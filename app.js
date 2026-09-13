console.log("📦 app.js is loading...");

// =========================
// IndexedDB Setup
// =========================
const DB_NAME = "SalonDB";
const DB_VERSION = 3;
let db;
let visitChart;
let dbPromise = null;
let appInitDone = false;
let reservationsIntervalId = null;
let dashboardChannel = null;
let reservationsChannel = null;
let resumeReconnectPromise = null;

function handleAppError(context, error, { toastMessage } = {}) {
  console.error(`❌ ${context}:`, error);
  if (toastMessage && typeof showToast === "function") {
    showToast(toastMessage);
  }
}

function attachDbLifecycle(connection) {
  connection.onversionchange = () => {
    try { connection.close(); } catch {}
    if (db === connection) db = null;
    dbPromise = null;
  };

  if ("onclose" in connection) {
    connection.onclose = () => {
      if (db === connection) db = null;
      dbPromise = null;
    };
  }
}

function openDatabase(forceReopen = false) {
  if (forceReopen && db) {
    try { db.close(); } catch {}
    db = null;
    dbPromise = null;
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      showToast("Please close other salon tabs and reopen the app to finish updating.");
    };

    request.onerror = function (e) {
      const error = e.target.error;
      dbPromise = null;
      handleAppError("IndexedDB failed to open", error, {
        toastMessage: "Database could not be opened. Please reopen the app."
      });
      reject(error);
    };

    request.onupgradeneeded = function (e) {
      const upgradeDb = e.target.result;
      if (!upgradeDb.objectStoreNames.contains("clients")) {
        upgradeDb.createObjectStore("clients", { keyPath: "id", autoIncrement: true });
      }
      const clientsStore = e.target.transaction.objectStore("clients");
      if (!clientsStore.indexNames.contains("date")) {
        clientsStore.createIndex("date", "date", { unique: false });
      }
      if (!clientsStore.indexNames.contains("checkinId")) {
        clientsStore.createIndex("checkinId", "checkinId", { unique: true });
      }
      if (!upgradeDb.objectStoreNames.contains("checkins")) {
        upgradeDb.createObjectStore("checkins", { keyPath: "id", autoIncrement: true });
      }
      const checkinsStore = e.target.transaction.objectStore("checkins");
      if (!checkinsStore.indexNames.contains("status")) checkinsStore.createIndex("status", "status");
      if (!checkinsStore.indexNames.contains("submissionId")) checkinsStore.createIndex("submissionId", "submissionId", { unique: true });
      if (!upgradeDb.objectStoreNames.contains("visits")) {
        upgradeDb.createObjectStore("visits", { keyPath: "id", autoIncrement: true });
      }
      if (!upgradeDb.objectStoreNames.contains("reservations")) {
        upgradeDb.createObjectStore("reservations", { keyPath: "id", autoIncrement: true });
      }
      if (!upgradeDb.objectStoreNames.contains("services")) {
        upgradeDb.createObjectStore("services", { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = function (e) {
      db = e.target.result;
      attachDbLifecycle(db);
      resolve(db);
    };
  });

  return dbPromise;
}

function hasUsableDbConnection() {
  if (!db) return false;
  try {
    db.transaction("services", "readonly");
    return true;
  } catch {
    return false;
  }
}

async function ensureDbReady(forceReopen = false) {
  if (!forceReopen && hasUsableDbConnection()) return db;
  return openDatabase(forceReopen);
}

async function createTransaction(storeName, mode, context) {
  await ensureDbReady();

  try {
    return db.transaction(storeName, mode);
  } catch (error) {
    handleAppError(`${context} failed, retrying database connection`, error);
    await ensureDbReady(true);
    return db.transaction(storeName, mode);
  }
}

async function refreshAppData() {
  await Promise.allSettled([
    checkUpcomingReservations(),
    loadClients(),
    updateDashboardStatsFromClients()
  ]);

  if (typeof loadUpcomingReservations === "function" && db) {
    try {
      loadUpcomingReservations(db);
    } catch (error) {
      handleAppError("Refreshing upcoming reservations failed", error);
    }
  }
}

async function seedServicesIfNeeded() {
  try {
    const tx = await createTransaction("services", "readonly", "Checking services store");
    const store = tx.objectStore("services");
    const countRequest = store.count();

    countRequest.onsuccess = function () {
      if (countRequest.result === 0) seedServices();
    };
  } catch (error) {
    handleAppError("Checking services store failed", error);
  }
}

function initializeAppOnce() {
  if (appInitDone) return;
  appInitDone = true;

  document.getElementById("addClientForm")?.addEventListener("submit", function (e) {
    e.preventDefault();
    addClient();
  });

  if (!reservationsIntervalId) {
    reservationsIntervalId = window.setInterval(() => {
      checkUpcomingReservations();
    }, 5 * 60 * 1000);
  }

  if (!dashboardChannel && typeof BroadcastChannel !== "undefined") {
    dashboardChannel = new BroadcastChannel("dashboardChannel");
    dashboardChannel.onmessage = (event) => {
      if (event.data === "update") {
        loadClients();
        updateDashboardStatsFromClients();
      }
    };
  }
}

async function bootstrapApp({ forceReopen = false, source = "startup" } = {}) {
  try {
    await ensureDbReady(forceReopen);
    initializeAppOnce();
    await seedServicesIfNeeded();
    await refreshAppData();
  } catch (error) {
    handleAppError(`App bootstrap failed after ${source}`, error, {
      toastMessage: "The app lost its database connection. Please reopen the page if this keeps happening."
    });
  }
}

window.addEventListener("error", (event) => {
  handleAppError("Unhandled JavaScript error", event.error || event.message, {
    toastMessage: "Something went wrong. Please try that action again."
  });
});

window.addEventListener("unhandledrejection", (event) => {
  handleAppError("Unhandled promise rejection", event.reason, {
    toastMessage: "A background task failed. Please try again."
  });
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  if (!resumeReconnectPromise) {
    resumeReconnectPromise = bootstrapApp({ forceReopen: true, source: "pageshow" })
      .finally(() => { resumeReconnectPromise = null; });
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!resumeReconnectPromise) {
    resumeReconnectPromise = bootstrapApp({ forceReopen: true, source: "visibilitychange" })
      .finally(() => { resumeReconnectPromise = null; });
  }
});

window.addEventListener("online", () => {
  if (!resumeReconnectPromise) {
    resumeReconnectPromise = bootstrapApp({ forceReopen: true, source: "online" })
      .finally(() => { resumeReconnectPromise = null; });
  }
});

window.ensureSalonDbReady = ensureDbReady;
window.appBootstrapPromise = bootstrapApp();

/* =========================
   Local time helpers
   ========================= */
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`; // YYYY-MM-DD in LOCAL time
}

function to24h(t = "") {
  t = t.trim();
  if (/am|pm/i.test(t)) {
    const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return "00:00";
    let hh = parseInt(m[1], 10);
    const mm = m[2];
    const isPM = m[3].toUpperCase() === "PM";
    if (hh === 12 && !isPM) hh = 0;      // 12 AM -> 00
    if (hh < 12 && isPM) hh += 12;       // 1..11 PM -> +12
    return String(hh).padStart(2, "0") + ":" + mm;
  }
  return t; // already 24h or unexpected string; return as-is
}

function localTimestamp(dateStr = "", timeStr = "00:00") {
  const [y, m, d] = (dateStr || "").split("-").map(Number);
  const [H, M] = to24h(timeStr || "00:00").split(":").map(Number);
  if (!(y && m && d)) return 0;
  return new Date(y, m - 1, d, H || 0, M || 0, 0, 0).getTime(); // LOCAL timestamp
}

function parseLocalDate(dateStr) {
  // Parse "YYYY-MM-DD" as a LOCAL Date object (not UTC)
  const [y, m, d] = (dateStr || "").split("-").map(Number);
  if (!(y && m && d)) return new Date(NaN);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}


/* =========================
   Trend (local days)
   ========================= */
async function updateRevenueTrend() {
  if (!document.getElementById('revenueTrend')) return;
  return updateDashboardStatsFromClients();
}

/* =========================
   Services helpers (multi-select)
   ========================= */
function getSelectedServices() {
  const checks = document.querySelectorAll('#clientServicesGroup input[type="checkbox"]:checked');
  return Array.from(checks).map(cb => cb.value.trim()).filter(Boolean);
}

function clearSelectedServices() {
  document.querySelectorAll('#clientServicesGroup input[type="checkbox"]').forEach(cb => cb.checked = false);
}

/* =========================
   Add Client (multi-service) — FIXED
   ========================= */
// Keep uploads small enough for offline storage and use separate list thumbnails.
async function prepareClientPhoto(file) {
  if (!file) return { photoData: '', photoThumbnail: '' };
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Unsupported photo format'));
      image.src = url;
    });
    const resize = maxSide => {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.8);
      canvas.width = canvas.height = 0;
      return data;
    };
    return { photoData: resize(1280), photoThumbnail: resize(96) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

let clientSaveInProgress = false;

async function addClient() {
  if (clientSaveInProgress) return;
  try {
    await ensureDbReady();
  } catch {
    showToast("Database is initialising. Please try again in a moment.");
    return;
  }

  const name = document.getElementById("clientName")?.value.trim() || "";
  const phone = document.getElementById("clientPhone")?.value.trim() || "";
  const gender = document.getElementById("clientGender")?.value || "";
  const services = getSelectedServices(); // ← array from checkboxes
  const amount = document.getElementById("clientAmount")?.value.trim() || "";
  const time = document.getElementById("clientTime")?.value.trim() || "";
  const staff = document.getElementById("clientStaff")?.value.trim() || "";
  const photoInput = document.getElementById("clientPhoto");
  const dateInput = document.getElementById("clientDate")?.value || "";
  const date = dateInput || localDateStr(); // local day
  const paymentMethod = document.getElementById("clientPaymentMethod")?.value || "Cash";

  if (SalonRevenue.cents(amount) === null || !SalonRevenue.parseDate(date)) {
    showToast('Enter a valid date and a non-negative amount with at most two decimal places.');
    return;
  }

  // require at least one service since UI is multi-select
  if (!name || !phone || !gender || services.length === 0 || !time || !staff) {
    showToast("Please fill in all required fields (including at least one service).");
    return;
  }

  if (clientSaveInProgress) return;
  clientSaveInProgress = true;
  let photo;
  try {
    photo = await prepareClientPhoto(photoInput?.files?.[0]);
    await ensureDbReady();
  } catch (error) {
    clientSaveInProgress = false;
    handleAppError('Preparing client photo failed', error, {
      toastMessage: 'Could not prepare this photo. Try a JPEG or PNG photo, or save without a photo.'
    });
    return;
  }
  {
    const client = {
      name,
      phone,
      gender,
      services,                 // ← stored as array
      amount,
      date,
      time,
      ...photo,
      paymentMethod,
      staff
    };

    let tx;
    try {
      tx = db.transaction("clients", "readwrite");
      tx.objectStore("clients").add(client);
    } catch (error) {
      clientSaveInProgress = false;
      handleAppError("Creating client transaction failed", error, {
        toastMessage: "The database connection was lost. Please try again."
      });
      return;
    }
    tx.oncomplete = () => {
      clientSaveInProgress = false;
      loadClients();
      updateDashboardStatsFromClients();
      document.getElementById("addClientModal").style.display = "none";
      clearSelectedServices();

      // Clear inputs
      document.getElementById("clientName").value = "";
      document.getElementById("clientPhone").value = "";
      document.getElementById("clientGender").value = "";
      document.getElementById("clientAmount").value = "";
      document.getElementById("clientPaymentMethod").value = "";
      document.getElementById("clientDate").value = "";
      document.getElementById("clientTime").value = "";
      document.getElementById("clientStaff").value = "";
      if (photoInput) photoInput.value = "";

      dashboardChannel?.postMessage("update");
      showToast("Client saved successfully!");
    };

    tx.onerror = tx.onabort = () => {
      clientSaveInProgress = false;
      handleAppError("Saving client failed", tx.error, {
        toastMessage: "Client could not be saved. Please try again."
      });
    };
  }
}

// expose for inline onclick in HTML
window.addClient = addClient;

/* =========================
   Load Clients into Table
   ========================= */
   function normalizeSearchText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

let clientsLoadVersion = 0;
let clientsSearchTimer;
let clientsViewRecords = [];
let clientsPage = 0;
const CLIENTS_PAGE_SIZE = 50;

function clientsViewOptions() {
  return window.getClientsViewOptions?.() || { scope: 'today', card: 'total' };
}

function filteredClientsView() {
  const { card } = clientsViewOptions();
  const counts = new Map();
  clientsViewRecords.forEach(c => counts.set(c.phone, (counts.get(c.phone) || 0) + 1));
  return clientsViewRecords.filter(c => {
    if (card === 'female') return c.gender === 'Female';
    if (card === 'male') return c.gender === 'Male';
    if (card === 'new') return counts.get(c.phone) === 1;
    if (card === 'returning') return counts.get(c.phone) > 1;
    return true;
  });
}

function escapeClientHTML(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function clientExportCells(client) {
  return [client.name, client.phone, client.gender, '', client.servicesArray.join(', ') || '-',
    client.date, client.time, client.staff || '-', client.amount || '', client.paymentMethod || '-', ''];
}

function createClientRow(client, includePhoto = true) {
  const row = document.createElement('tr');
  row.innerHTML = clientExportCells(client).map((value, i) =>
    `<td${i >= 8 ? ' class="admin-only"' : ''}>${escapeClientHTML(value)}</td>`).join('');
  if (includePhoto && client.photoData) {
    const img = document.createElement('img');
    img.src = client.photoThumbnail || client.photoData;
    img.alt = 'Client photo';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = img.height = 40;
    img.style.cssText = 'border-radius:50%;object-fit:cover;cursor:pointer';
    img.onclick = () => openFullImage(client.photoData);
    row.children[3].appendChild(img);
  }
  if (includePhoto) {
    const button = document.createElement('button');
    button.textContent = 'Delete';
    button.onclick = () => deleteClient(client.phone);
    row.children[10].appendChild(button);
  }
  return row;
}

function renderClientsView(resetPage = true) {
  const tbody = document.querySelector('#clientsTable tbody');
  if (!tbody) return;
  if (resetPage) clientsPage = 0;
  const records = filteredClientsView();
  const lastPage = Math.max(0, Math.ceil(records.length / CLIENTS_PAGE_SIZE) - 1);
  clientsPage = Math.min(clientsPage, lastPage);
  const start = clientsPage * CLIENTS_PAGE_SIZE;
  const rows = document.createDocumentFragment();
  records.slice(start, start + CLIENTS_PAGE_SIZE).forEach(c => rows.appendChild(createClientRow(c)));
  tbody.replaceChildren(rows);
  const status = document.getElementById('clientsPageStatus');
  if (status) status.textContent = records.length
    ? `${start + 1}–${Math.min(start + CLIENTS_PAGE_SIZE, records.length)} of ${records.length} clients`
    : 'No clients found';
  const previous = document.getElementById('clientsPrevious');
  const next = document.getElementById('clientsNext');
  if (previous) previous.disabled = clientsPage === 0;
  if (next) next.disabled = clientsPage === lastPage;
  const badge = document.getElementById('activeCardFilter');
  const { scope, card } = clientsViewOptions();
  if (badge) badge.textContent = card === 'total' ? '' : `Filtered: ${card} (${scope})`;
}

function changeClientsPage(direction) {
  clientsPage = Math.max(0, clientsPage + direction);
  renderClientsView(false);
  document.querySelector('.client-list')?.scrollTo({ top: 0 });
}

function scheduleClientsSearch() {
  clearTimeout(clientsSearchTimer);
  ++clientsLoadVersion; // Invalidate a read started before the latest keystroke.
  clientsSearchTimer = setTimeout(() => loadClients(), 250);
}

async function loadClients() {
  if (!document.querySelector('#clientsTable tbody')) return;
  clearTimeout(clientsSearchTimer);
  const loadVersion = ++clientsLoadVersion;
  const search = normalizeSearchText(document.getElementById('clientSearchInput')?.value || '');
  const service = document.getElementById('serviceFilter')?.value || '';
  const { scope } = clientsViewOptions();
  const today = localDateStr();
  const tx = await createTransaction('clients', 'readonly', 'Loading clients');
  const store = tx.objectStore('clients');
  const clients = [];
  const source = scope === 'today' ? store.index('date') : store;

  return new Promise((resolve, reject) => {
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Loading clients was aborted'));
    source.openCursor(scope === 'today' ? today : null, 'prev').onsuccess = e => {
      if (loadVersion !== clientsLoadVersion) { resolve(); return; }
      const cursor = e.target.result;
      if (cursor) {
        const client = cursor.value;
        const servicesArray = Array.isArray(client.services) ? client.services : (client.service ? [client.service] : []);
        if ((!search || [client.name, client.phone, servicesArray.join(', '), client.staff]
          .some(value => normalizeSearchText(value).includes(search))) &&
          (!service || servicesArray.includes(service))) {
          clients.push({ ...client, servicesArray });
        }
        cursor.continue();
      } else {
        clientsViewRecords = clients;
        updateClientSummaryCards(clients);
        renderClientsView();
        resolve();
      }
    };
  });
}

/* =========================
   Delete Client
   ========================= */
async function deleteClient(phone) {
  const tx = await createTransaction("clients", "readwrite", "Deleting client");
  const store = tx.objectStore("clients");
  store.openCursor().onsuccess = function (e) {
    const cursor = e.target.result;
    if (cursor) {
      if (cursor.value.phone === phone) {
        store.delete(cursor.key);
        loadClients();
        updateDashboardStatsFromClients();
        return;
      }
      cursor.continue();
    }
  };
}

/* =========================
   Dashboard Stats (local)
   ========================= */
async function updateDashboardStatsFromClients() {
  if (!document.querySelector('#totalClients, #todaysVisits, #monthlyRevenue, #dailyRevenue, #availableServices, #visitTrendChart')) return;
  const version = (updateDashboardStatsFromClients.version || 0) + 1;
  updateDashboardStatsFromClients.version = version;
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  try {
    const totals = SalonRevenue.accumulator();
    const tx = await createTransaction('clients', 'readonly', 'Updating dashboard totals');
    await new Promise((resolve, reject) => {
      let calculationError;
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(calculationError || tx.error || new Error('Could not load dashboard totals.'));
      tx.objectStore('clients').openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor || version !== updateDashboardStatsFromClients.version) return;
        try { totals.include(cursor.value); cursor.continue(); }
        catch (error) { calculationError = error; tx.abort(); }
      };
    });
    if (version !== updateDashboardStatsFromClients.version) return;
    text('totalClients', totals.clients.size);
    text('todaysVisits', totals.todayVisits);
    text('monthlyRevenue', SalonRevenue.money(totals.monthly));
    text('dailyRevenue', SalonRevenue.money(totals.daily));
    text('availableServices', totals.services.size);
    text('dashboardRevenueNotice', SalonRevenue.warning(totals.invalid));
    text('revenueTrend', SalonRevenue.trend(totals.daily, totals.yesterday));
    const trend = document.getElementById('revenueTrend');
    if (trend) trend.className = 'trend-indicator' + (totals.daily > totals.yesterday ? ' up' : totals.daily < totals.yesterday ? ' down' : '');
    text('weeklyVisitRange', `${totals.start} to ${totals.end} · Monday–Sunday`);
    const canvas = document.getElementById('visitTrendChart');
    if (canvas && typeof Chart !== 'undefined') {
      try {
        if (visitChart) visitChart.destroy();
        visitChart = new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], datasets: [{
            data: totals.weeklyVisits, backgroundColor: 'rgba(170,38,38,0.1)', borderColor: '#aa2626',
            fill: true, tension: 0.4, pointRadius: 5
          }] },
          options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        });
      } catch (error) { console.error('Visit chart could not be drawn', error); }
    }
  } catch (error) {
    if (version !== updateDashboardStatsFromClients.version) return;
    for (const id of ['totalClients', 'todaysVisits', 'monthlyRevenue', 'dailyRevenue', 'availableServices']) text(id, '—');
    text('revenueTrend', 'Revenue could not be loaded.');
    text('dashboardRevenueNotice', error.message || 'Please reopen the page to retry.');
  }
}

window.updateDashboardStatsFromClients = updateDashboardStatsFromClients;

/* =========================
   Summary cards
   ========================= */
function updateClientSummaryCards(clients) {
  const phoneCount = {};
  let newCount = 0, returningCount = 0, femaleCount = 0, maleCount = 0;
  clients.forEach(client => {
    if (!phoneCount[client.phone]) {
      phoneCount[client.phone] = 1;
      newCount++;
    } else {
      returningCount++;
    }
    if (client.gender === "Female") femaleCount++;
    if (client.gender === "Male") maleCount++;
  });

  const elTotal   = document.getElementById("totalClientsCard");
  const elNew     = document.getElementById("newClients");
  const elReturn  = document.getElementById("returningClients");
  const elFemale  = document.getElementById("femaleClients");
  const elMale    = document.getElementById("maleClients");

  if (elTotal)  elTotal.textContent  = clients.length;
  if (elNew)    elNew.textContent    = newCount;
  if (elReturn) elReturn.textContent = returningCount;
  if (elFemale) elFemale.textContent = femaleCount;
  if (elMale)   elMale.textContent   = maleCount;
}

/* =========================
   Toast (single definition)
   ========================= */
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

/* =========================
   CSV Export
   ========================= */
async function exportClientsCSV() {
  const headers = [
    "Name","Phone","Gender","Services","Date","Time","Staff","Amount","Payment"
  ];
  const rows = [];

  const tx = await createTransaction("clients", "readonly", "Exporting clients CSV");
  const store = tx.objectStore("clients");

  store.openCursor().onsuccess = function (e) {
    const cursor = e.target.result;
    if (cursor) {
      const c = cursor.value;
      const servicesText = Array.isArray(c.services)
        ? c.services.join("; ")
        : (c.service || "");
      rows.push([
        c.name || "",
        c.phone || "",
        c.gender || "",
        servicesText,
        c.date || "",
        c.time || "",
        c.staff || "",
        c.amount || "",
        c.paymentMethod || ""
      ]);
      cursor.continue();
    } else {
      // Build CSV
      const escapeCSV = (val) => {
        const s = String(val ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
      };
      const csv = [headers.map(escapeCSV).join(",")]
        .concat(rows.map(r => r.map(escapeCSV).join(",")))
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sista_sista_clients.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };
}

/* =========================
   Optional stubs
   ========================= */
function renderClientList() {}
function updateClientStats() {}
function exportClientsPDF() {} // inline implementation lives in clients.html
function seedServices() {}

/* =========================
   Theme + role gating
   ========================= */
document.getElementById("clientSearchInput")?.addEventListener("input", scheduleClientsSearch);
document.getElementById("serviceFilter")?.addEventListener("change", loadClients);

const darkToggle = document.getElementById("toggleDark");
if (darkToggle) {
  darkToggle.addEventListener("change", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
  });
  window.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      document.body.classList.add("dark");
      darkToggle.checked = true;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const role = localStorage.getItem("role");
  if (role === "staff") {
    const revenueCard = document.getElementById("revenueCard");
    if (revenueCard) {
      revenueCard.style.display = "none";
    }
  }
});

/* =========================
   Print
   ========================= */
function printClientsTable() {
  const table = document.getElementById("clientsTable");
  if (!table) {
    alert("Client table not found.");
    return;
  }
  const printWindow = window.open('', '_blank');
  const exportTable = table.cloneNode(true);
  const exportRows = document.createDocumentFragment();
  filteredClientsView().forEach(c => exportRows.appendChild(createClientRow(c, false)));
  exportTable.querySelector('tbody').replaceChildren(exportRows);
  const tableHTML = exportTable.outerHTML;
  const style = `
    <style>
      body { font-family: Arial; padding: 20px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
    </style>
  `;
  printWindow.document.write(`
    <html data-salon-private>
      <head><title>Print Clients</title>${style}
        <style id="salon-access-shield">html{visibility:hidden!important}</style>
        <script src="${escapeClientHTML(new URL('auth.js', location.href).href)}"></script>
      </head>
      <body>
        <h2>Sista Sista Salon - Client List</h2>
        ${tableHTML}
        <script>
          window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

/* ================================
   Upcoming reservations notifier
   ================================ */
async function checkUpcomingReservations() {
  const tx = await createTransaction("reservations", "readonly", "Checking upcoming reservations");
  const store = tx.objectStore("reservations");

  const nowTime = Date.now();
  const alertList = [];

  store.openCursor().onsuccess = function (e) {
    const cursor = e.target.result;

    if (cursor) {
      const r = cursor.value;

      const name = r.clientName || r.ClientName || "Unnamed Client";
      const time = r.time || "--:--";
      const date = r.date || "";
      const service = r.service || (Array.isArray(r.services) ? r.services.join(", ") : "No service");

      const ts = Number.isFinite(r.timestamp)
        ? r.timestamp
        : localTimestamp(date, r.time || r.time24 || time);

      const diff = ts - nowTime;

      if (diff > 0 && diff <= 60 * 60 * 1000) {
        const displayTime = r.time || r.time24 || time;
        alertList.push(`${displayTime} - ${name} (${service})`);
      }

      cursor.continue();
    } else {
      const badge = document.getElementById("notificationBadge");
      const list  = document.getElementById("notificationList");

      if (!badge || !list) return;

      if (alertList.length > 0) {
        badge.style.display = "inline-block";
        list.innerHTML = alertList.map(item => `<li>${item}</li>`).join("");
      } else {
        badge.style.display = "none";
        list.innerHTML = "<li>No upcoming bookings</li>";
      }
    }
  };
}

// Toggle panel on bell click
document.addEventListener("DOMContentLoaded", () => {
  const bell = document.getElementById("notificationBell");
  const panel = document.getElementById("notificationPanel");
  bell?.addEventListener("click", () => {
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
});

/* =========================
   Reservations Timeline + Share (global & per-card)
   ========================= */

// Keep last list for sharing
let LAST_RESERVATIONS = [];
let TL_RENDER_TOKEN = 0;

// Utility to decode any '&amp;' that may have been stored
function decodeAmp(s = "") {
  return String(s).replace(/&amp;/g, "&");
}

// Read all reservations from IndexedDB
async function getAllReservations(){
  return new Promise((resolve)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = (event) => {
      handleAppError("Opening reservations database failed", event.target.error);
      resolve([]);
    };
    req.onsuccess = (ev) => {
      const _db = ev.target.result;
      attachDbLifecycle(_db);
      const tx = _db.transaction("reservations", "readonly");
      const store = tx.objectStore("reservations");
      const ga = store.getAll();
      ga.onsuccess = () => {
        const results = ga.result || [];
        try { _db.close(); } catch {}
        resolve(results);
      };
      ga.onerror   = () => {
        try { _db.close(); } catch {}
        resolve([]);
      };
    };
  });
}

// Build and open a mailto: link (robust + logs)
function mailtoOpen(subject, body, to = "") {
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  try {
    const a = document.createElement("a");
    a.href = href;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    console.warn("[share] anchor click failed:", e);
  }

  try {
    setTimeout(() => { window.location.href = href; }, 50);
  } catch (e) {
    console.warn("[share] location fallback failed:", e);
  }

  console.log("[share] attempted to open:", href, "If nothing opens, set a default email app on your OS.");
}

// Human-readable line for a reservation (for daily share)
function formatReservationLine(r, i){
  const t = r.time || r.time24 || "";
  const name = decodeAmp(r.clientName || "Unnamed Client");
  const phone = decodeAmp(r.phone || "");
  const svc = Array.isArray(r.services) ? r.services.join(", ") : (r.service || "");
  return `${i}. ${r.date} ${t} — ${name} (${phone}) — ${svc}`;
}

// Share all reservations for a date
async function shareReservationsForDate(dateStr){
  const all = await getAllReservations();
  const sorted = all
    .filter(r => r.date === dateStr)
    .sort((a,b)=>(a.time24 || to24h(a.time||"00:00")).localeCompare(b.time24 || to24h(b.time||"00:00")));

  if (!sorted.length){
    showToast("No reservations to share for " + dateStr);
    return;
  }

  const lines = sorted.map((r,i)=>formatReservationLine(r,i+1)).join("\n");
  const subject = `Reservations for ${dateStr} — Sista Sista Salon & Spa`;
  const body = `Hello,\n\nHere are the reservations for ${dateStr}:\n\n${lines}\n\n— Sent from Sista Sista Salon & Spa system`;
  mailtoOpen(subject, body);
}

// Idempotent timeline render (8AM–12AM) with per-card share icon
async function loadTimelineHoursWithReservations(){
  const myToken = ++TL_RENDER_TOKEN;

  const reservations = await getAllReservations();
  if (myToken !== TL_RENDER_TOKEN) return;

  LAST_RESERVATIONS = reservations;

  const timeline = document.getElementById("timelineHours");
  if (!timeline) return;

  // fresh grid
  timeline.innerHTML = "";
  for (let hour = 8; hour <= 24; hour++){
    const block = document.createElement("div");
    block.className = "hour-block";
    block.setAttribute("data-hour", hour);

    const label = document.createElement("strong");
    label.className = "time-label";
    label.textContent = (function formatHour(h){
      if(h===24||h===0) return "12 AM";
      if(h===12) return "12 PM";
      const ampm = h>12 ? "PM" : "AM";
      const h12 = h>12 ? h-12 : h;
      return `${h12} ${ampm}`;
    })(hour);

    block.appendChild(label);
    timeline.appendChild(block);
  }

  // paint cards with per-card share icon
  reservations.forEach(res=>{
    const h24 = res.time24 || to24h(res.time || "00:00");
    const hour = parseInt(h24.split(":")[0],10);
    const block = timeline.querySelector(`.hour-block[data-hour="${hour}"]`);
    if(!block) return;

    const clientName = decodeAmp(res.clientName || "Unnamed Client");
    const phone      = decodeAmp(res.phone || "");
    const svc        = Array.isArray(res.services) ? res.services.join(", ") : (res.service || "");

    const subj = `Reservation — ${clientName} on ${res.date} at ${res.time || h24}`;
    const body =
      `Client: ${clientName}\n` +
      `Phone: ${phone}\n` +
      `Service: ${svc}\n` +
      `Date: ${res.date || ""}\n` +
      `Time: ${res.time || h24}\n\n` +
      `— Sent from Sista Sista Salon & Spa system`;
    const mailto = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;

    const card = document.createElement("div");
    card.className = "reservation-card";
    card.innerHTML = `
      <strong>${clientName}</strong>
      <a href="${mailto}" class="share-one" title="Share via email" style="margin-left:8px;">
        <i class="fas fa-envelope"></i>
      </a><br>
      <i class="fas fa-phone"></i> ${phone}<br>
      <i class="fas fa-calendar"></i> ${res.date || ""} at ${(res.time || h24)}<br>
      <i class="fas fa-scissors"></i> ${svc}
    `;
    block.appendChild(card);
  });
}

// Broadcast updates & Share button wiring
function wireReservationsPage() {
  const timelineEl = document.getElementById("timelineHours");
  if (!timelineEl) return;

  // (Re)render now
  loadTimelineHoursWithReservations();

  // cross-tab refresh
  if (!reservationsChannel && typeof BroadcastChannel !== "undefined") {
    reservationsChannel = new BroadcastChannel("reservations");
    reservationsChannel.onmessage = (event)=>{
      const msg = event.data;
      if (msg?.type === "update" && msg.from !== undefined) {
        loadTimelineHoursWithReservations();
      }
    };
  }

  // Global Share button (share all for the chosen date/today)
  const shareBtn = document.getElementById("shareTodayBtn");
  if (shareBtn && !shareBtn.dataset.boundClick) {
    shareBtn.dataset.boundClick = "true";
    shareBtn.addEventListener("click", () => {
      const chosen =
        document.getElementById("shareDate")?.value ||
        document.getElementById("reservationDate")?.value ||
        localDateStr();
      console.log("[share] button clicked; chosen date =", chosen);
      shareReservationsForDate(chosen);
    });
  }
}

// Run once DOM is ready, and once the whole page is loaded (to override inline script render)
document.addEventListener("DOMContentLoaded", wireReservationsPage);
window.addEventListener("load", () => {
  // Final pass to ensure per-card share icons appear even if another script rendered earlier
  wireReservationsPage();
});

window.addEventListener("salon:clients-updated", refreshAppData);

let dashboardLocalDay = localDateStr();
if (document.getElementById('dailyRevenue')) {
  window.setInterval(() => {
    if (document.hidden) return;
    const today = localDateStr();
    if (today !== dashboardLocalDay) { dashboardLocalDay = today; updateDashboardStatsFromClients(); }
  }, 30000);
}
