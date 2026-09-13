const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..');
const code = name => fs.readFileSync(path.join(root, name), 'utf8');
const finish = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); });
async function setup(t) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://salon.test/notepad.html' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(root, 'revenue-math.js'), 'utf8'));
  w.indexedDB = new IDBFactory();
  let staff = true;
  w.SalonAccess = { requireStaff() { if (!staff) throw new Error('Staff sign-in required.'); return { username: 'Erica', role: 'staff' }; } };
  w.eval(code('visit-store.js'));
  const db = await w.SalonVisits.open();
  t.after(() => { db.close(); w.close(); });
  return { w, db, api: w.SalonVisits, setStaff(value) { staff = value; }, async records(store) {
    const tx = db.transaction(store); const req = tx.objectStore(store).getAll(); await finish(tx); return req.result;
  } };
}
const input = { name: 'New visitor', phone: '0240000000', services: ['Pedicure', 'Shampoo'], gender: 'Female' };
const approval = api => ({ ...input, date: api.localDate(), staff: 'Erica, Mary', amount: '150', paymentMethod: 'Mobile Money' });

test('pending, in-progress and cancelled visits never enter Clients; approval saves full compatible data once', async t => {
  const p = await setup(t);
  const id = await p.api.submit(input, 'one');
  assert.equal((await p.records('clients')).length, 0);
  assert.equal((await p.api.list())[0].status, 'pending');
  await p.api.changeStatus(id, 'in_progress');
  assert.equal((await p.records('clients')).length, 0);
  const ids = await Promise.all([p.api.approve(id, approval(p.api)), p.api.approve(id, approval(p.api))]);
  assert.equal(ids[0], ids[1]);
  const records = await p.records('clients');
  assert.equal(records.length, 1);
  assert.equal(records[0].staff, 'Erica, Mary');
  assert.deepEqual(records[0].services, input.services);
  assert.equal(records[0].amount, '150.00');
  assert.equal(records[0].approvedBy, 'Erica');
  assert.equal((await p.records('checkins'))[0].clientId, records[0].id);
  assert.equal((await p.api.list('completed')).length, 1);
  const cancelled = await p.api.submit(input, 'two');
  await p.api.changeStatus(cancelled, 'cancelled');
  await assert.rejects(p.api.approve(cancelled, approval(p.api)), /cannot be completed/);
  assert.equal((await p.records('clients')).length, 1);
});

test('retries of the same customer submission persist only one pending visit', async t => {
  const p = await setup(t);
  const ids = await Promise.all([p.api.submit(input, 'same'), p.api.submit(input, 'same')]);
  assert.equal(ids[0], ids[1]);
  assert.equal((await p.records('checkins')).length, 1);
});

test('customer cannot read the queue, approve or cancel; approval rejects incomplete or invalid payment details', async t => {
  const p = await setup(t);
  const id = await p.api.submit(input, 'one');
  p.setStaff(false);
  await assert.rejects(p.api.list(), /Staff sign-in/);
  await assert.rejects(p.api.approve(id, approval(p.api)), /Staff sign-in/);
  await assert.rejects(p.api.changeStatus(id, 'cancelled'), /Staff sign-in/);
  p.setStaff(true);
  for (const invalid of [{ amount: '' }, { amount: '-1' }, { amount: 'Infinity' }, { staff: '' }, { services: ['Help me choose'] }, { date: '2026-02-30' }]) {
    await assert.rejects(p.api.approve(id, { ...approval(p.api), ...invalid }), /Confirm/);
  }
  assert.equal((await p.records('clients')).length, 0);
  assert.equal((await p.records('checkins'))[0].status, 'pending');
});

test('a failed client insertion rolls back approval and leaves the pending visit intact', async t => {
  const p = await setup(t);
  const id = await p.api.submit(input, 'one');
  const tx = p.db.transaction('clients', 'readwrite');
  tx.objectStore('clients').add({ name: 'Conflict fixture', checkinId: id });
  await finish(tx);
  await assert.rejects(p.api.approve(id, approval(p.api)));
  assert.equal((await p.records('checkins'))[0].status, 'pending');
  assert.equal((await p.records('clients')).length, 1);
});

test('approved visits feed the real dashboard calculations; pending visits do not', async t => {
  const p = await setup(t);
  const a = await p.api.submit(input, 'one');
  await p.api.submit({ ...input, name: 'Waiting' }, 'two');
  p.w.document.body.innerHTML = ['totalClients','todaysVisits','monthlyRevenue','dailyRevenue','availableServices'].map(id => `<span id="${id}"></span>`).join('');
  p.w.createTransaction = async (name, mode) => p.db.transaction(name, mode);
  const app = code('app.js');
  p.w.eval(app.slice(app.indexOf('function localDateStr'), app.indexOf('async function updateRevenueTrend')));
  p.w.eval(app.slice(app.indexOf('async function updateDashboardStatsFromClients'), app.indexOf('window.updateDashboardStatsFromClients')));
  async function stats() {
    await p.w.updateDashboardStatsFromClients();
    const tx = p.db.transaction('clients'); tx.objectStore('clients').count(); await finish(tx);
  }
  await stats();
  assert.equal(p.w.document.getElementById('todaysVisits').textContent, '0');
  await p.api.approve(a, approval(p.api));
  await stats();
  assert.equal(p.w.document.getElementById('todaysVisits').textContent, '1');
  assert.equal(p.w.document.getElementById('totalClients').textContent, '1');
  assert.equal(p.w.document.getElementById('dailyRevenue').textContent, 'GHS 150.00');
  assert.equal(p.w.document.getElementById('monthlyRevenue').textContent, 'GHS 150.00');
});

test('staff queue displays submitted text safely and customer form has no private navigation', async t => {
  const p = await setup(t);
  await p.api.submit({ ...input, name: '<img src=x onerror=alert(1)>' }, 'markup');
  const page = new JSDOM(code('notepad.html'), { runScripts: 'outside-only', url: 'https://salon.test/notepad.html' });
  const w = page.window;
  t.after(() => w.close());
  w.SalonAccess = p.w.SalonAccess; w.SalonVisits = p.api;
  w.eval(code('notepad.js'));
  for (let i = 0; i < 30 && !w.document.querySelector('.visit-card'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(w.document.querySelector('.visit-card h3').textContent, /<img/);
  assert.equal(w.document.querySelector('.visit-card img'), null);
  const customer = new JSDOM(code('checkin.html'));
  assert.equal(customer.window.document.querySelectorAll('a, .sidebar, #visitQueue, #clientsTable').length, 0);
  customer.window.close();
});

test('customer submission clears personal details and survives reopening offline', async t => {
  const p = await setup(t);
  const page = new JSDOM(code('checkin.html'), { runScripts: 'outside-only', url: 'https://salon.test/checkin.html' });
  const w = page.window;
  t.after(() => w.close());
  w.SalonVisits = p.api;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.eval(code('checkin-services.js'));
  w.eval(code('checkin.js'));
  const form = w.document.getElementById('customerForm');
  for (let i = 0; i < 30 && form.querySelector('[type=submit]').disabled; i++) await new Promise(resolve => setTimeout(resolve, 5));
  form.elements.name.value = 'Offline visitor';
  form.elements.phone.value = '0201111111';
  form.querySelector('[name=services]').checked = true;
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 30 && !w.document.getElementById('customerConfirmation').textContent; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(form.elements.name.value, '');
  assert.equal(form.elements.phone.value, '');
  assert.match(w.document.getElementById('customerConfirmation').textContent, /pending/);
  assert.equal((await p.records('checkins')).length, 1);
  assert.equal((await p.records('clients')).length, 0);
  const reopened = new JSDOM('', { runScripts: 'outside-only', url: 'https://salon.test/notepad.html' });
  reopened.window.indexedDB = p.w.indexedDB;
  reopened.window.SalonAccess = p.w.SalonAccess;
  reopened.window.eval(code('visit-store.js'));
  const rows = await reopened.window.SalonVisits.list();
  assert.equal(rows[0].name, 'Offline visitor');
  assert.equal(rows[0].status, 'pending');
  (await reopened.window.SalonVisits.open()).close();
  reopened.window.close();
});

test('Reports counts approved multi-service visits and revenue, excludes pending entries', async t => {
  const p = await setup(t);
  const id = await p.api.submit(input, 'approved');
  await p.api.approve(id, approval(p.api));
  await p.api.submit({ ...input, name: 'Pending visitor' }, 'pending');
  const page = new JSDOM(code('reports.html'), { runScripts: 'outside-only', url: 'https://salon.test/reports.html' });
  const w = page.window;
  t.after(() => w.close());
  w.eval(code('revenue-math.js'));
  w.indexedDB = p.w.indexedDB;
  w.localStorage.setItem('loggedUser', JSON.stringify({ username: 'Admin', role: 'admin' }));
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  w.Chart = class {};
  const html = code('reports.html');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m => m[1].includes('let reportData'))[1];
  w.eval(script);
  for (let i = 0; i < 30 && !w.document.getElementById('reportTopService'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  const content = w.document.getElementById('reportCards').textContent;
  assert.match(content, /Total Clients1/);
  assert.match(content, /150\.00/);
  assert.equal(w.document.getElementById('reportTopService').textContent, 'Pedicure');
});

test('styled cancellation keeps a visit until confirmed and only shows success after saving', async t => {
  const dom = new JSDOM(code('notepad.html'), { runScripts: 'outside-only', url: 'https://salon.test/notepad.html' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(root, 'revenue-math.js'), 'utf8'));
  t.after(() => w.close());
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.SalonAccess = { requireStaff: () => ({ username: 'Erica' }) };
  const entry = { ...input, id: 1, status: 'pending', date: '2026-09-11', time: '10:00 AM' };
  let saves = 0, finishSave;
  w.SalonVisits = {
    list: async () => [entry],
    changeStatus: () => { saves++; return new Promise(resolve => { finishSave = resolve; }); }
  };
  w.eval(code('notepad.js'));
  await new Promise(resolve => setTimeout(resolve, 10));
  const cancel = [...w.document.querySelectorAll('.visit-actions button')].find(b => b.textContent === 'Cancel visit');
  cancel.click();
  w.document.getElementById('keepVisit').click();
  assert.equal(saves, 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  cancel.click();
  const yes = w.document.getElementById('confirmCancelVisit');
  yes.click(); yes.click();
  assert.equal(saves, 1);
  assert.equal(w.document.getElementById('visitToast').textContent, '');
  finishSave();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(w.document.getElementById('cancelVisitDialog').open, false);
  assert.match(w.document.getElementById('visitToast').textContent, /Visit cancelled/);
});
