let db, revenueConnection, revenueVersion = 0, revenueReady = false;
function openRevenueDatabase() {
  if (revenueConnection) return revenueConnection;
  revenueConnection = new Promise((resolve, reject) => {
    const request = indexedDB.open('SalonDB');
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('clients')) request.result.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
    };
    request.onerror = () => { revenueConnection = null; reject(request.error); };
    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => { db.close(); db = null; revenueConnection = null; };
      db.onclose = () => { db = null; revenueConnection = null; };
      resolve(db);
    };
  });
  return revenueConnection;
}
function setRevenueState(message) {
  document.getElementById('revenueStatus').textContent = message;
  revenueReady = false;
  for (const id of ['exportCSV', 'exportPDF', 'printButton']) document.getElementById(id).disabled = true;
  const tbody = document.querySelector('#revenueTable tbody');
  tbody.replaceChildren();
  const row = tbody.insertRow();
  const cell = row.insertCell(); cell.colSpan = 2; cell.textContent = message;
  if (window.revenueChart) { window.revenueChart.destroy(); window.revenueChart = null; }
}
async function updateRevenueSummary() {
  const version = ++revenueVersion;
  const reference = document.getElementById('revenueDate').value;
  setRevenueState('Loading revenue…');
  try {
    const totals = SalonRevenue.accumulator(reference);
    const connection = await openRevenueDatabase();
    if (version !== revenueVersion) return;
    await new Promise((resolve, reject) => {
      const tx = connection.transaction('clients', 'readonly');
      let calculationError;
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(calculationError || tx.error || new Error('Revenue could not be loaded.'));
      tx.objectStore('clients').openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor || version !== revenueVersion) return;
        try { totals.include(cursor.value); cursor.continue(); }
        catch (error) { calculationError = error; tx.abort(); }
      };
    });
    if (version !== revenueVersion) return;
    const select = document.getElementById('yearSelect');
    const years = new Set([...totals.years, new Date().getFullYear()]);
    for (let i = 1; i <= 3; i++) years.add(new Date().getFullYear() - i);
    select.replaceChildren();
    [...years].sort((a, b) => b - a).forEach(year => select.add(new Option(String(year), String(year))));
    select.value = String(totals.year);
    updateRevenueTable(totals);
    document.getElementById('revenueStatus').textContent = SalonRevenue.warning(totals.invalid);
    revenueReady = true;
    for (const id of ['exportCSV', 'exportPDF', 'printButton']) document.getElementById(id).disabled = false;
    renderRevenueChart(totals, document.getElementById('revenueView').value);
  } catch (error) {
    if (version === revenueVersion) setRevenueState(error.message || 'Could not load revenue. Please reopen the page.');
  }
}
function updateRevenueTable(totals) {
  const tbody = document.querySelector('#revenueTable tbody');
  tbody.replaceChildren();
  const rows = [
    [`Daily Revenue · ${totals.reference}`, totals.daily],
    [`Weekly Revenue · ${totals.start} to ${totals.end}`, totals.weekly],
    [`Monthly Revenue · ${totals.month}`, totals.monthly],
    [`Yearly Revenue · ${totals.year}`, totals.yearly]
  ];
  rows.forEach(([label, value]) => {
    const row = tbody.insertRow(); row.insertCell().textContent = label; row.insertCell().textContent = SalonRevenue.money(value);
  });
}
function renderRevenueChart(totals, view) {
  const notice = document.getElementById('revenueChartNotice');
  notice.textContent = `Chart includes records dated in ${totals.year}. Weekly bars group those records by Monday; the summary above includes the complete selected week, even across New Year.`;
  if (typeof Chart === 'undefined') { notice.textContent += ' Chart unavailable; the table totals are ready.'; return; }
  const buckets = view === 'daily' ? totals.days : view === 'weekly' ? totals.weeks : view === 'monthly' ? totals.months : { [totals.year]: totals.yearly };
  const keys = Object.keys(buckets).sort();
  const labels = view === 'weekly' ? keys.map(key => `Week of ${key}`) : keys;
  try {
    const plugins = typeof ChartDataLabels === 'undefined' ? [] : [ChartDataLabels];
    window.revenueChart = new Chart(document.getElementById('monthlyRevenueChart').getContext('2d'), {
      type: 'bar', data: { labels, datasets: [{ data: keys.map(key => buckets[key] / 100), backgroundColor: '#000', borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: { anchor: 'end', align: 'top', formatter: value => `GHS ${value.toFixed(2)}`, color: '#000' } }, scales: { y: { beginAtZero: true } } }, plugins
    });
  } catch (_) { notice.textContent += ' Chart unavailable; the table totals are ready.'; }
}
const dateInput = document.getElementById('revenueDate');
dateInput.value = SalonRevenue.dateKey();
document.getElementById('yearSelect').addEventListener('change', e => {
  dateInput.value = SalonRevenue.inYear(SalonRevenue.parseDate(dateInput.value) ? dateInput.value : SalonRevenue.dateKey(), Number(e.target.value));
  updateRevenueSummary();
});
dateInput.addEventListener('change', updateRevenueSummary);
document.getElementById('revenueView').addEventListener('change', updateRevenueSummary);
function exportRevenueCSV() {
  if (!revenueReady) return;
  const rows = [['Category', 'Amount'], ...Array.from(document.querySelectorAll('#revenueTable tbody tr'), row => Array.from(row.cells, cell => cell.textContent)),
    [], ['Generated', new Date().toLocaleString()], ['Note', document.getElementById('revenueStatus').textContent]];
  const csv = rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a'); link.href = url; link.download = 'revenue-summary.csv'; link.click(); URL.revokeObjectURL(url);
}
document.getElementById('exportCSV').addEventListener('click', exportRevenueCSV);
for (const id of ['printButton', 'exportPDF']) document.getElementById(id).addEventListener('click', () => { if (revenueReady) window.print(); });
window.addEventListener('salon:clients-updated', updateRevenueSummary);
window.addEventListener('pageshow', e => { if (e.persisted) updateRevenueSummary(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateRevenueSummary(); });
// Follow a changing local day only while the user is viewing today.
let lastLocalDay = SalonRevenue.dateKey();
setInterval(() => {
  if (document.hidden) return;
  const today = SalonRevenue.dateKey();
  if (today !== lastLocalDay) {
    if (dateInput.value === lastLocalDay) { dateInput.value = today; updateRevenueSummary(); }
    lastLocalDay = today;
  }
}, 30000);
updateRevenueSummary();
