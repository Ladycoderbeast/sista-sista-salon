console.log("📦 app.js is loading...");

// Initialize IndexedDB
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

  document.getElementById("addClientForm")?.addEventListener("submit", function (e) {
    e.preventDefault();
    addClient();
  });

  updateRevenueTrend(db);
  checkUpcomingReservations();
  setInterval(() => checkUpcomingReservations(), 5 * 60 * 1000);

  const tx = db.transaction("services", "readonly");
  const store = tx.objectStore("services");
  const countRequest = store.count();
  countRequest.onsuccess = function () {
    if (countRequest.result === 0) seedServices();
    loadClients();
    updateDashboardStatsFromClients();
  };
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
   Add Client
   ========================= */
function addClient() {
  const name = document.getElementById("clientName").value.trim();
  const phone = document.getElementById("clientPhone").value.trim();
  const gender = document.getElementById("clientGender").value;
  const service = document.getElementById("clientService").value;
  const amount = document.getElementById("clientAmount").value.trim();
  const time = document.getElementById("clientTime").value.trim();
  const staff = document.getElementById("clientStaff")?.value.trim() || "";   // ✅ NEW
  const photoInput = document.getElementById("clientPhoto");
  const dateInput = document.getElementById("clientDate").value;
  const date = dateInput || localDateStr(); // local day
  const paymentMethod = document.getElementById("clientPaymentMethod")?.value || "Cash";

  // include staff in required fields
  if (!name || !phone || !gender || !service || !time || !staff) {
    showToast("Please fill in all required fields.");
    return;
  }

  const reader = new FileReader();
  reader.onload = function () {
    const photoData = reader.result;
    const client = {
      name, phone, gender, service,
      amount, date, time, photoData,
      paymentMethod,
      staff                        // ✅ save staff
    };

    const tx = db.transaction("clients", "readwrite");
    const store = tx.objectStore("clients");
    store.add(client);

    tx.oncomplete = () => {
      loadClients();
      renderClientList();
      updateClientStats();
      updateDashboardStatsFromClients();
      document.getElementById("addClientModal").style.display = "none";
      if (typeof BroadcastChannel !== "undefined") {
        new BroadcastChannel("dashboardChannel").postMessage("update");
      }
      showToast("Client saved successfully!");
      if (typeof BroadcastChannel !== "undefined") {
        new BroadcastChannel("dashboardChannel").postMessage("update");
      }
      document.getElementById("addClientForm")?.reset();
    };
  };

  if (photoInput.files.length > 0) {
    reader.readAsDataURL(photoInput.files[0]);
  } else {
    reader.onload({ target: { result: "" } });
  }
}


/* =========================
   Load Clients into Table
   ========================= */
function loadClients() {
  const tableBody = document.querySelector("#clientsTable tbody");
  const searchValue = document.getElementById("clientSearchInput")?.value.toLowerCase() || "";
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
      const matchesSearch =
  !searchValue ||                                  // allow empty query
  client.name.toLowerCase().includes(searchValue) ||
  client.phone.toLowerCase().includes(searchValue) ||
  client.service.toLowerCase().includes(searchValue) ||
  (client.staff || "").toLowerCase().includes(searchValue);  // <- add staff
      const matchesService = selectedService === "" || client.service === selectedService;

      if (matchesSearch && matchesService) {
        clients.push(client);
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${client.name}</td>
          <td>${client.phone}</td>
          <td>${client.gender}</td>
          <td><img src="${client.photoData}" alt="photo" style="width:40px;height:40px;border-radius:50%;cursor:pointer;" onclick="openFullImage(this.src)" /></td>
          <td>${client.service}</td>
          <td>${client.date}</td>
          <td>${client.time}</td>
          <td>${client.staff || "-"}</td>
          <td class="admin-only">${client.amount}</td>
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
  const todayStr = localDateStr(now); // local today
  const month = now.getMonth();
  const year = now.getFullYear();

  let todayVisits = 0;
  let revenue = 0;
  let todaySales = 0;
  const services = new Set();
  const uniqueClients = new Set();
  const weekly = Array(7).fill(0);

  store.openCursor().onsuccess = function (e) {
    const cursor = e.target.result;
    if (cursor) {
      const c = cursor.value;
      const visitDate = parseLocalDate(c.date);
      const key = `${c.name}_${c.phone}`;
      uniqueClients.add(key);

      // ✅ count distinct services
      if (c.service) services.add(c.service);

      // today
      if (c.date === todayStr) {
        todayVisits++;
        if (c.amount) todaySales += parseFloat(c.amount);
      }

      // this month revenue
      if (!isNaN(visitDate) && visitDate.getMonth() === month && visitDate.getFullYear() === year && c.amount) {
        revenue += parseFloat(c.amount);
      }

      // weekly chart bucket
      if (!isNaN(visitDate)) {
        weekly[visitDate.getDay()]++;
      }

      cursor.continue();
    } else {
      document.getElementById("totalClients").textContent = uniqueClients.size;
      document.getElementById("todaysVisits").textContent = todayVisits;
      document.getElementById("monthlyRevenue").textContent = `GHS ${revenue.toFixed(2)}`;
      document.getElementById("dailyRevenue").textContent = `GHS ${todaySales.toFixed(2)}`;
      document.getElementById("availableServices").textContent = services.size; // ✅ now correct

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
  document.getElementById("totalClientsCard").textContent = clients.length;
  document.getElementById("newClients").textContent = newCount;
  document.getElementById("returningClients").textContent = returningCount;
  document.getElementById("femaleClients").textContent = femaleCount;
  document.getElementById("maleClients").textContent = maleCount;
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
   Stubs
   ========================= */
function renderClientList() {}
function updateClientStats() {}
function exportClientsCSV() {}
function exportClientsPDF() {}
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

      // Fallback values
      const name = r.clientName || r.ClientName || "Unnamed Client";
      const time = r.time || "--:--";
      const date = r.date || "";
      const service = r.service || "No service";

      // Reliable local timestamp
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
      const list = document.getElementById("notificationList");

      if (alertList.length > 0) {
        badge.style.display = "inline-block";
        list.innerHTML = alertList.map(item => `<li>${item}</li>`).join("");
      } else {
        badge.style.display = "none";
        list.innerHTML = "<li>No upcoming reservations</li>";
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
