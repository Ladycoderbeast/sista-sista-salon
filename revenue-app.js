// revenue-app.js
Chart.register(ChartDataLabels);

let db;
const request = indexedDB.open("SalonDB", 1);

request.onupgradeneeded = function (e) {
  db = e.target.result;
  if (!db.objectStoreNames.contains("clients")) {
    db.createObjectStore("clients", { keyPath: "id", autoIncrement: true });
  }
};

request.onsuccess = function (e) {
  db = e.target.result;
  updateRevenueSummary();
};

request.onerror = function (e) {
  console.error("Database error:", e.target.error);
};

function updateRevenueSummary() {
  const year = document.getElementById("yearSelect").value;
  const view = document.getElementById("revenueView").value;

  const transaction = db.transaction("clients", "readonly");
  const store = transaction.objectStore("clients");

  const daily = {};
  const weekly = {};
  const monthly = {};
  let yearlyTotal = 0;

  store.openCursor().onsuccess = function (event) {
    const cursor = event.target.result;
    if (cursor) {
      const record = cursor.value;

      if (record.amount && record.date) {
        const [y, m, d] = record.date.split("-");
        const date = new Date(+y, m - 1, +d);
        const recordYear = date.getFullYear();

        if (recordYear == year) {
          const dayKey = date.toISOString().split("T")[0];
          const weekKey = `${recordYear}-W${getWeekNumber(date)}`;
          const monthKey = `${recordYear}-${String(date.getMonth() + 1).padStart(2, "0")}`;

          daily[dayKey] = (daily[dayKey] || 0) + Number(record.amount);
          weekly[weekKey] = (weekly[weekKey] || 0) + Number(record.amount);
          monthly[monthKey] = (monthly[monthKey] || 0) + Number(record.amount);

          yearlyTotal += Number(record.amount);
        }
      }
      cursor.continue();
    } else {
      updateRevenueTable(daily, weekly, monthly, yearlyTotal);
      renderRevenueChart(daily, weekly, monthly, yearlyTotal, view);
    }
  };
}

function updateRevenueTable(daily, weekly, monthly, yearlyTotal) {
  const tbody = document
    .getElementById("revenueTable")
    .getElementsByTagName("tbody")[0];

  const todayKey = new Date().toISOString().split("T")[0];
  const now = new Date();
  const currentWeekKey = `${now.getFullYear()}-W${getWeekNumber(now)}`;
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const dailyTotal = daily[todayKey] || 0;
  const weeklyTotal = weekly[currentWeekKey] || 0;
  const monthlyTotal = monthly[currentMonthKey] || 0;

  tbody.innerHTML = `
    <tr><td>Daily Revenue</td><td>GHS ${dailyTotal.toFixed(2)}</td></tr>
    <tr><td>Weekly Revenue</td><td>GHS ${weeklyTotal.toFixed(2)}</td></tr>
    <tr><td>Monthly Revenue</td><td>GHS ${monthlyTotal.toFixed(2)}</td></tr>
    <tr><td>Yearly Revenue</td><td>GHS ${yearlyTotal.toFixed(2)}</td></tr>
  `;
}

function renderRevenueChart(daily, weekly, monthly, yearly, view) {
  const ctx = document.getElementById("monthlyRevenueChart").getContext("2d");

  if (window.revenueChart) window.revenueChart.destroy();

  let labels = [];
  let data = [];

  switch (view) {
    case "daily":
      labels = Object.keys(daily);
      data = Object.values(daily);
      break;
    case "weekly":
      labels = Object.keys(weekly);
      data = Object.values(weekly);
      break;
    case "monthly":
      labels = Object.keys(monthly);
      data = Object.values(monthly);
      break;
    case "yearly":
      labels = ["Total"];
      data = [yearly];
      break;
  }

  window.revenueChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: "#000",
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: {
          anchor: "end",
          align: "top",
          formatter: v => `GHS ${v.toFixed(2)}`,
          color: "#000",
          font: { weight: "bold" }
        },
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true }
      }
    },
    plugins: [ChartDataLabels]
  });
}

function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

document.getElementById("yearSelect").addEventListener("change", updateRevenueSummary);
document.getElementById("revenueView").addEventListener("change", updateRevenueSummary);

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("exportCSV").addEventListener("click", exportRevenueCSV);
  document.getElementById("printButton").addEventListener("click", () => window.print());
  document.getElementById("exportPDF").addEventListener("click", () => window.print());
});

function exportRevenueCSV() {
  const rows = [["Category", "Amount"]];
  const table = document.getElementById("revenueTable").querySelector("tbody");

  for (const row of table.rows) {
    rows.push([...row.cells].map(c => c.innerText));
  }

  rows.push([]);
  rows.push(["Generated", new Date().toLocaleString()]);

  const blob = new Blob([rows.map(r => r.join(",")).join("\n")], {
    type: "text/csv;charset=utf-8;"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "revenue-summary.csv";
  link.click();
}
