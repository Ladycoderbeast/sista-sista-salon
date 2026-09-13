const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'clients.html'), 'utf8');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const record = (name, date = today()) => ({ name, date, phone: name, gender: 'Female', services: ['Hair'], time: '10:00 AM', staff: 'Ama' });
const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });

async function setup(t, records = []) {
  const indexedDB = new IDBFactory();
  const old = await new Promise((resolve, reject) => {
    const req = indexedDB.open('SalonDB', 1);
    req.onupgradeneeded = () => {
      for (const name of ['clients', 'services', 'visits', 'reservations']) req.result.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = old.transaction(['clients', 'services'], 'readwrite');
  records.forEach(c => tx.objectStore('clients').add(c));
  tx.objectStore('services').add({ name: 'Existing service' });
  await done(tx);
  old.close();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://salon.test/clients.html' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(root, 'revenue-math.js'), 'utf8'));
  w.indexedDB = indexedDB;
  w.console = { log() {}, error() {} };
  w.showToast = () => {};
  w.document.querySelector('.client-list').scrollTo = () => {};
  const parts = [app.slice(0, app.indexOf('async function refreshAppData'))];
  parts.push(app.slice(app.indexOf('function localDateStr'), app.indexOf('function to24h')));
  parts.push(app.slice(app.indexOf('function getSelectedServices'), app.indexOf('// expose for inline onclick')));
  parts.push(app.slice(app.indexOf('function normalizeSearchText'), app.indexOf('/* =========================\n   Delete Client')));
  parts.push(app.slice(app.indexOf('function updateClientSummaryCards'), app.indexOf('/* =========================\n   Toast')));
  w.eval(parts.join('\n'));
  const filters = html.slice(html.indexOf('<!-- Page-local filtering'));
  w.eval(filters.slice(filters.indexOf('<script>') + 8, filters.indexOf('</script>')));
  const db = await w.openDatabase();
  t.after(() => { db.close(); dom.window.close(); });
  let loadPromise;
  const originalLoad = w.loadClients;
  w.loadClients = (...args) => loadPromise = originalLoad(...args);
  return {
    w, db,
    load: () => w.loadClients(),
    rows: () => [...w.document.querySelectorAll('#clientsTable tbody tr')],
    async scope(value) {
      const radio = w.document.getElementById(value === 'all' ? 'clientsScopeAll' : 'clientsScopeToday');
      radio.checked = true;
      radio.dispatchEvent(new w.Event('change'));
      await loadPromise;
    },
    async clear() { w.document.getElementById('clearCardFilter').click(); await loadPromise; },
    async add(c) { const tx = db.transaction('clients', 'readwrite'); tx.objectStore('clients').add(c); await done(tx); }
  };
}

test('upgrade preserves history and services; Today reads through the date index', async t => {
  const historical = Array.from({ length: 5000 }, (_, i) => record(`Old ${i}`, '2000-01-01'));
  const p = await setup(t, [...historical, record('Today')]);
  assert.equal(p.db.version, 3);
  const tx = p.db.transaction(['clients', 'services']);
  assert.ok(tx.objectStore('clients').indexNames.contains('date'));
  const count = tx.objectStore('clients').count();
  const services = tx.objectStore('services').getAll();
  await done(tx);
  assert.equal(count.result, 5001);
  assert.equal(services.result[0].name, 'Existing service');
  let reads = 0;
  const original = p.w.createTransaction;
  p.w.createTransaction = async (...args) => {
    const tx = await original(...args);
    const originalStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const store = originalStore(name);
      const index = store.index('date');
      const cursor = index.openCursor.bind(index);
      index.openCursor = (key, direction) => {
        assert.equal(key, today());
        const req = cursor(key, direction);
        req.addEventListener('success', () => { if (req.result) reads++; });
        return req;
      };
      store.index = () => index;
      store.openCursor = () => assert.fail('Today must not scan all records');
      return store;
    };
    return tx;
  };
  await p.load();
  assert.equal(reads, 1);
  assert.equal(p.rows().length, 1);
  assert.match(p.rows()[0].textContent, /Today/);
});

test('new records appear without switching scope; older refresh cannot duplicate them', async t => {
  const p = await setup(t, [record('Existing'), record('Old', '2000-01-01')]);
  await p.load();
  await p.add(record('New'));
  await Promise.all([p.load(), p.load()]);
  assert.equal(p.rows().length, 2);
  assert.match(p.rows()[0].textContent, /New/);
  await p.scope('all');
  assert.equal(p.rows().length, 3);
});

test('pagination limits DOM rows and keeps complete filtered export data', async t => {
  const p = await setup(t, Array.from({ length: 125 }, (_, i) => record(`Client ${i}`)));
  await p.load();
  assert.equal(p.rows().length, 50);
  assert.equal(p.w.filteredClientsView().length, 125);
  p.w.changeClientsPage(1);
  assert.match(p.rows()[0].textContent, /Client 74/);
  p.w.changeClientsPage(1);
  assert.equal(p.rows().length, 25);
  assert.equal(p.w.document.getElementById('clientsNext').disabled, true);
  p.w.document.getElementById('clientSearchInput').value = 'Client 124';
  await p.load();
  assert.equal(p.rows().length, 1);
  await p.clear();
  assert.equal(p.rows().length, 50);
  assert.equal(p.w.filteredClientsView().length, 125);
});

test('returning filter counts matches across page boundaries and handles legacy service', async t => {
  const records = Array.from({ length: 60 }, (_, i) => record(`Client ${i}`));
  records[59].phone = records[0].phone;
  records[59].services = undefined;
  records[59].service = 'Hair';
  const p = await setup(t, records);
  await p.load();
  p.w.document.querySelector('[data-card-filter="returning"]').click();
  assert.equal(p.rows().length, 2);
  assert.match(p.rows()[1].textContent, /Hair/);
});

test('rapid search typing triggers a single refresh', async t => {
  const p = await setup(t);
  let loads = 0;
  p.w.loadClients = () => { loads++; };
  p.w.scheduleClientsSearch();
  p.w.scheduleClientsSearch();
  p.w.scheduleClientsSearch();
  assert.equal(loads, 0);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(loads, 1);
});

test('dashboard calculations do not open the database on Clients', async t => {
  const p = await setup(t);
  p.w.eval(app.slice(app.indexOf('async function updateRevenueTrend'), app.indexOf('/* =========================\n   Services helpers')));
  p.w.eval(app.slice(app.indexOf('async function updateDashboardStatsFromClients'), app.indexOf('window.updateDashboardStatsFromClients')));
  p.w.createTransaction = () => assert.fail('unnecessary database scan');
  await p.w.updateRevenueTrend();
  await p.w.updateDashboardStatsFromClients();
});

test('photo preparation bounds dimensions, creates thumbnail and releases resources', async t => {
  const p = await setup(t);
  const sizes = [];
  let revoked = 0;
  p.w.URL.createObjectURL = () => 'blob:photo';
  p.w.URL.revokeObjectURL = () => revoked++;
  p.w.Image = class {
    naturalWidth = 4032; naturalHeight = 3024;
    set src(value) { this.onload(); }
  };
  const create = p.w.document.createElement.bind(p.w.document);
  p.w.document.createElement = tag => tag !== 'canvas' ? create(tag) : {
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toDataURL() { sizes.push([this.width, this.height]); return 'data:image/jpeg;base64,test'; }
  };
  const result = await p.w.prepareClientPhoto({});
  assert.deepEqual(sizes, [[1280, 960], [96, 72]]);
  assert.ok(result.photoThumbnail);
  assert.equal(revoked, 1);
  p.w.Image = class { set src(value) { this.onerror(); } };
  await assert.rejects(p.w.prepareClientPhoto({}), /Unsupported/);
  assert.equal(revoked, 2);
});

test('saving from the form commits once and refreshes Today with the new client first', async t => {
  const p = await setup(t, [record('Existing')]);
  p.w.updateDashboardStatsFromClients = () => {};
  const values = { clientName: 'Saved client', clientPhone: '0240000000', clientGender: 'Female', clientTime: '10:00 AM', clientStaff: 'Ama', clientDate: today() };
  for (const [id, value] of Object.entries(values)) p.w.document.getElementById(id).value = value;
  p.w.document.getElementById('clientServicesGroup').innerHTML = '<input type="checkbox" value="Hair" checked>';
  await Promise.all([p.w.addClient(), p.w.addClient()]);
  const tx = p.db.transaction('clients');
  const request = tx.objectStore('clients').getAll();
  await done(tx);
  assert.equal(request.result.length, 2);
  for (let i = 0; i < 50 && !p.rows()[0]?.textContent.includes('Saved client'); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.match(p.rows()[0].textContent, /Saved client/);
  assert.equal(p.w.document.getElementById('addClientModal').style.display, 'none');
});

test('PDF and print include all matching records beyond the current page', async t => {
  const p = await setup(t, Array.from({ length: 125 }, (_, i) => record(`Client ${i}`)));
  await p.load();
  Object.defineProperty(p.w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  let pdfRows;
  p.w.jspdf = { jsPDF: class { autoTable(options) { pdfRows = options.body; } save() {} } };
  const start = html.indexOf('  async function exportClientsPDF');
  p.w.eval(html.slice(start, html.indexOf('</script>', start)));
  await p.w.exportClientsPDF();
  assert.equal(pdfRows.length, 125);
  let printHTML;
  p.w.open = () => ({ document: { write(value) { printHTML = value; }, close() {} } });
  const printStart = app.indexOf('function printClientsTable');
  p.w.eval(app.slice(printStart, app.indexOf('/* ================================', printStart)));
  p.w.printClientsTable();
  const output = new JSDOM(printHTML);
  assert.equal(output.window.document.querySelectorAll('tbody tr').length, 125);
  output.window.close();
  assert.equal(p.rows().length, 50);
});
