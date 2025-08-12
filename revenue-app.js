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
  updateRevenueSummary(); // Ensure this runs only after DB is ready
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
  const [yearStr, monthStr, dayStr] = record.date.split("-");
  const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  const recordYear = date.getFullYear();


        if (recordYear == year) {
          const dayKey = date.toLocaleDateString("en-CA"); // ✅ local format YYYY-MM-DD

          const weekKey = `${recordYear}-W${getWeekNumber(date)}`;
          const monthKey = `${recordYear}-${String(date.getMonth() + 1).padStart(2, "0")}`;

          daily[dayKey] = (daily[dayKey] || 0) + parseFloat(record.amount);
          weekly[weekKey] = (weekly[weekKey] || 0) + parseFloat(record.amount);
          monthly[monthKey] = (monthly[monthKey] || 0) + parseFloat(record.amount);
          yearlyTotal += parseFloat(record.amount);
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
  const table = document.getElementById("revenueTable").getElementsByTagName("tbody")[0];

  // Helper to get the latest date using actual date comparison
  const getLatestValue = (obj) => {
    const keys = Object.keys(obj);
    if (keys.length === 0) return 0;
    const latestKey = keys.sort((a, b) => new Date(b) - new Date(a))[0]; // newest date first
    return obj[latestKey];
  };

  const dailyTotal = getLatestValue(daily);
  const weeklyTotal = getLatestValue(weekly);
  const monthlyTotal = getLatestValue(monthly);

  table.innerHTML = `
    <tr><td>Daily Revenue</td><td>GHS ${dailyTotal.toFixed(2)}</td></tr>
    <tr><td>Weekly Revenue</td><td>GHS ${weeklyTotal.toFixed(2)}</td></tr>
    <tr><td>Monthly Revenue</td><td>GHS ${monthlyTotal.toFixed(2)}</td></tr>
    <tr><td>Yearly Revenue</td><td>GHS ${yearlyTotal.toFixed(2)}</td></tr>
  `;
}



function renderRevenueChart(daily, weekly, monthly, yearly, view) {
  const ctx = document.getElementById("monthlyRevenueChart").getContext("2d");
  if (window.revenueChart) {
    window.revenueChart.destroy();
  }

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
        label: "GHS",
        data,
        backgroundColor: "#000",
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
        }
      }
    }
  });
}

function getWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

document.getElementById("yearSelect").addEventListener("change", updateRevenueSummary);
document.getElementById("revenueView").addEventListener("change", updateRevenueSummary);

function exportRevenueCSV() {
  const rows = [["Category", "Amount"]];
  const table = document.getElementById("revenueTable").getElementsByTagName("tbody")[0];
  for (const row of table.rows) {
    const cols = Array.from(row.cells).map(cell => cell.innerText);
    rows.push(cols);
  }

  rows.push([]); // Blank row
  rows.push(["Generated", new Date().toLocaleString()]);

  const csvContent = rows.map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = "revenue-summary.csv";
  link.click();
}

function renderRevenueChart(daily, weekly, monthly, yearly, view) {
  const ctx = document.getElementById("monthlyRevenueChart").getContext("2d");
  if (window.revenueChart) {
    window.revenueChart.destroy();
  }

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
        label: "GHS",
        data,
        backgroundColor: "#000",
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#000',
          font: {
            weight: 'bold'
          },
          formatter: (value) => `GHS ${value.toFixed(2)}`
        },
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("exportCSV").addEventListener("click", exportRevenueCSV);

  document.getElementById("printButton").addEventListener("click", () => {
  console.log("Force print trigger");
  window.print();
});

  document.getElementById("exportPDF").addEventListener("click", function () {
    window.print(); // Or trigger html2pdf here later
  });
});

