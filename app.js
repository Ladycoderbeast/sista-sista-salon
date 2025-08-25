console.log("📦 app.js is loading...");

// =========================
// IndexedDB Setup
// =========================
let db;
let visitChart;
const request = indexedDB.open("SalonDB", 1);

request.onerror = function (e) {
  console.error("❌ IndexedDB failed to open:", e.target.error);
  alert("Failed to open database: " + e.target.error.message);
};

request.onupgradeneeded = function (e) {
  db = e.target.result;
  if (!db.objectStoreNames.contains("clients")) {
    db.createObjectStore("clients", { keyPath: "id", autoIncrement: true });
  }
  if (!db.objectStoreNames.contains("visits")) {
    db.createObjectStore("visits", { keyPath: "id", autoIncrement: true });
  }
  if (!db.objectStoreNames.contains("reservations")) {
    db.createObjectStore("reservations", { keyPath: "id", autoIncrement: true });
  }
  if (!db.objectStoreNames.contains("services")) {
    db.createObjectStore("services", { keyPath: "id", autoIncrement: true });
  }
};

request.onsuccess = function (e) {
  db = e.target.result;

  // If you ever wrap the modal fields in a <form id="addClientForm">
  document.getElementById("addClientForm")?.addEventListener("submit", function (e) {
    e.preventDefault();
    addClient();
  });

  updateRevenueTrend(db);
  checkUpcomingReservations();
  setInterval(() => checkUpcomingReservations(), 5 * 60 * 1000);

  // Seed services store if empty (optional)
  const tx = db.transaction("services", "readonly");
  const store = tx.objectStore("services");
  const countRequest = store.count();
  countRequest.onsuccess = function () {
    if (countRequest.result === 0) seedServices();
    loadClients();
    updateDashboardStatsFromClients();
  };

  // Cross-tab updates
  if (typeof BroadcastChannel !== "undefined") {
    const dashCh = new BroadcastChannel("dashboardChannel");
    dashCh.onmessage = (msg) => {
      if (msg === "update") {
        loadClients();
        updateDashboardStatsFromClients();
      }
    };
  }
};

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
function updateRevenueTrend(db) {
  const tx = db.transaction("clients", "readonly");
  const store = tx.objectStore("clients");

  const todayStr = localDateStr();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterdayStr = localDateStr(y);

  let todayTotal = 0;
  let yesterdayTotal = 0;

  store.openCursor().onsuccess = function (e) {
    const cursor = e.target.result;
    if (cursor) {
      const c = cursor.value;
      if (c.date === todayStr) {
        todayTotal += parseFloat(c.amount || 0);
      } else if (c.date === yesterdayStr) {
        yesterdayTotal += parseFloat(c.amount || 0);
      }
      cursor.continue();
    } else {
      const trendEl = document.getElementById("revenueTrend");
      if (!trendEl) return;

      if (yesterdayTotal === 0 && todayTotal > 0) {
        trendEl.textContent = "🔼 +100% from yesterday";
        trendEl.className = "trend-indicator up";
      } else if (yesterdayTotal === 0 && todayTotal === 0) {
        trendEl.textContent = "No revenue yet";
        trendEl.className = "trend-indicator";
      } else {
        const diff = todayTotal - yesterdayTotal;
        const percent = Math.abs((diff / yesterdayTotal) * 100).toFixed(1);
        if (diff > 0) {
          trendEl.textContent = `🔼 +${percent}% from yesterday`;
          trendEl.className = "trend-indicator up";
        } else if (diff < 0) {
          trendEl.textContent = `🔽 -${percent}% from yesterday`;
          trendEl.className = "trend-indicator down";
        } else {
          trendEl.textContent = "No change from yesterday";
          trendEl.className = "trend-indicator";
        }
      }
    }
  };
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
function addClient() {
  if (!db) {
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

  // require at least one service since UI is multi-select
  if (!name || !phone || !gender || services.length === 0 || !time || !staff) {
    showToast("Please fill in all required fields (including at least one service).");
    return;
  }

  const reader = new FileReader();
  reader.onload = function () {
    const photoData = reader.result || "";
    const client = {
      name,
      phone,
      gender,
      services,                 // ← stored as array
      amount,
      date,
      time,
      photoData,
      paymentMethod,
      staff
    };

    const tx = db.transaction("clients", "readwrite");
    const store = tx.objectStore("clients");
    store.add(client);

    tx.oncomplete = () => {
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

      if (typeof BroadcastChannel !== "undefined") {
        new BroadcastChannel("dashboardChannel").postMessage("update");
      }
      showToast("Client saved successfully!");
    };
  };

  if (photoInput?.files?.length > 0) {
    reader.readAsDataURL(photoInput.files[0]);
  } else {
    // trigger onload with empty data (no photo chosen)
    reader.onload({ target: { result: "" } });
  }
}

// expose for inline onclick in HTML
window.addClient = addClient;

/* =========================
   Load Clients into Table
   ========================= */
function loadClients() {
  const tableBody = document.querySelector("#clientsTable tbody");
  const searchValue = (document.getElementById("clientSearchInput")?.value || "").toLowerCase();
  const selectedService = document.getElementById("serviceFilter")?.value || "";
  if (!tableBody) return;
  tableBody.innerHTML = "";

  const tx = db.transaction("clients", "readonly");
  const store = tx.objectStore("clients");
  const clients = [];

  store.openCursor().onsuccess = function (e) {
    const cursor = e.target.result;
    if (cursor) {
      const client = cursor.value;
      const servicesArray = Array.isArray(client.services)
        ? client.services
        : (client.service ? [client.service] : []); // backward compat
      const servicesText = servicesArray.join(", ");

      const matchesSearch =
        !searchValue ||
        client.name.toLowerCase().includes(searchValue) ||
        client.phone.toLowerCase().includes(searchValue) ||
        servicesText.toLowerCase().includes(searchValue) ||
        (client.staff || "").toLowerCase().includes(searchValue);

      const matchesService =
        selectedService === "" || servicesArray.includes(selectedService);

      if (matchesSearch && matchesService) {
        clients.push({ ...client, servicesArray });

        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${client.name}</td>
          <td>${client.phone}</td>
          <td>${client.gender}</td>
          <td><img src="${client.photoData || ""}" alt="photo" style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer;" onclick="openFullImage(this.src)" /></td>
          <td>${servicesText || "-"}</td>
          <td>${client.date}</td>
          <td>${client.time}</td>
          <td>${client.staff || "-"}</td>
          <td class="admin-only">${client.amount || ""}</td>
          <td class="admin-only">${client.paymentMethod || "-"}</td>
          <td class="admin-only"><button onclick="deleteClient('${client.phone}')">Delete</button></td>`;
        tableBody.appendChild(row);
      }
      cursor.continue();
    } else {
      updateClientSummaryCards(clients);
    }
  };
}

/* =========================
   Delete Client
   ========================= */
function deleteClient(phone) {
  const tx = db.transaction("clients", "readwrite");
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
function updateDashboardStatsFromClients() {
  const tx = db.transaction("clients", "readonly");
  const store = tx.objectStore("clients");

  const now = new Date();
  const todayStr = localDateStr(now);
  const month = now.getMonth();
  const year = now.getFullYear();

  let todayVisits = 0;
  let revenue = 0;
  let todaySales = 0;
  const servicesSet = new Set();
  const uniqueClients = new Set();
  const weekly = Array(7).fill(0);

  store.openCursor().onsuccess = function (e) {
    const cursor = e.target.result;
    if (cursor) {
      const c = cursor.value;
      const visitDate = parseLocalDate(c.date);
      const key = `${c.name}_${c.phone}`;
      uniqueClients.add(key);

      const arr = Array.isArray(c.services) ? c.services : (c.service ? [c.service] : []);
      arr.forEach(s => s && servicesSet.add(s));

      if (c.date === todayStr) {
        todayVisits++;
        if (c.amount) todaySales += parseFloat(c.amount);
      }

      if (!isNaN(visitDate) && visitDate.getMonth() === month && visitDate.getFullYear() === year && c.amount) {
        revenue += parseFloat(c.amount);
      }

      if (!isNaN(visitDate)) {
        weekly[visitDate.getDay()]++;
      }

      cursor.continue();
    } else {
      const elTotalClients      = document.getElementById("totalClients");
      const elTodaysVisits      = document.getElementById("todaysVisits");
      const elMonthlyRevenue    = document.getElementById("monthlyRevenue");
      const elDailyRevenue      = document.getElementById("dailyRevenue");
      const elAvailableServices = document.getElementById("availableServices");

      if (elTotalClients)      elTotalClients.textContent      = uniqueClients.size;
      if (elTodaysVisits)      elTodaysVisits.textContent      = todayVisits;
      if (elMonthlyRevenue)    elMonthlyRevenue.textContent    = `GHS ${revenue.toFixed(2)}`;
      if (elDailyRevenue)      elDailyRevenue.textContent      = `GHS ${todaySales.toFixed(2)}`;
      if (elAvailableServices) elAvailableServices.textContent = servicesSet.size;

      if (typeof Chart !== "undefined") {
        const ctx = document.getElementById("visitTrendChart")?.getContext("2d");
        if (ctx) {
          if (visitChart) visitChart.destroy();
          visitChart = new Chart(ctx, {
            type: "line",
            data: {
              labels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
              datasets: [{
                data: weekly,
                backgroundColor: "rgba(170,38,38,0.1)",
                borderColor: "#aa2626",
                fill: true,
                tension: 0.4,
                pointRadius: 5
              }]
            },
            options: { plugins: { legend: { display: false } } }
          });
        }
      }
    }
  };
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
function exportClientsCSV() {
  const headers = [
    "Name","Phone","Gender","Services","Date","Time","Staff","Amount","Payment"
  ];
  const rows = [];

  const tx = db.transaction("clients", "readonly");
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
document.getElementById("clientSearchInput")?.addEventListener("input", loadClients);
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
  const tableHTML = table.outerHTML;
  const style = `
    <style>
      body { font-family: Arial; padding: 20px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
    </style>
  `;
  printWindow.document.write(`
    <html>
      <head><title>Print Clients</title>${style}</head>
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
function checkUpcomingReservations() {
  const tx = db.transaction("reservations", "readonly");
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
    const req = indexedDB.open("SalonDB", 1);
    req.onerror = () => resolve([]);
    req.onsuccess = (ev) => {
      const _db = ev.target.result;
      const tx = _db.transaction("reservations", "readonly");
      const store = tx.objectStore("reservations");
      const ga = store.getAll();
      ga.onsuccess = () => resolve(ga.result || []);
      ga.onerror   = () => resolve([]);
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
  if (typeof BroadcastChannel !== "undefined") {
    const resChannel = new BroadcastChannel("reservations");
    resChannel.onmessage = (event)=>{
      const msg = event.data;
      if (msg?.type === "update" && msg.from !== undefined) {
        loadTimelineHoursWithReservations();
      }
    };
  }

  // Global Share button (share all for the chosen date/today)
  const shareBtn = document.getElementById("shareTodayBtn");
  if (shareBtn) {
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
