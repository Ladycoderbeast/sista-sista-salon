const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const auth = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function page(name, shared = storage(), signedIn = true) {
  const session = storage();
  if (signedIn) session.setItem('sista_session', JSON.stringify({ user: { username: 'Erica', role: 'staff' }, issuedAt: Date.now() - 5000, expiresAt: Date.now() + 100000 }));
  const listeners = {}, elements = {};
  const ctx = {
    Date, JSON, Number, String, Error, Uint8Array, TextEncoder, crypto: webcrypto,
    localStorage: shared, sessionStorage: session,
    location: { pathname: '/' + name, replace(url) { ctx.destination = url; } },
    document: {
      hidden: false,
      getElementById: id => elements[id],
      createElement: () => ({ remove() { delete elements[this.id]; } }),
      head: { appendChild(node) { elements[node.id] = node; } },
      addEventListener(type, callback) { listeners['document:' + type] = callback; }
    },
    addEventListener(type, callback) { listeners[type] = callback; },
    dispatchEvent() {}, Event: class { constructor(type) { this.type = type; } }
  };
  ctx.window = ctx;
  vm.runInNewContext(auth, ctx);
  return { ctx, shared, session, elements, fire: (type, data = {}) => listeners[type]?.(data) };
}

test('starting customer mode revokes current and other tab sessions; Back and direct URLs stay hidden', () => {
  const shared = storage();
  const staff = page('notepad.html', shared);
  const other = page('dashboard.html', shared);
  staff.ctx.SalonAccess.enterCustomerMode();
  assert.equal(staff.ctx.destination, 'checkin.html');
  assert.equal(staff.session.getItem('sista_session'), null);
  other.fire('storage', { key: 'sista_customer_mode' });
  assert.equal(other.ctx.destination, 'checkin.html');
  assert.ok(other.elements['salon-access-shield']);
  for (const name of ['dashboard.html','clients.html','notepad.html','reports.html','revenue.html','services.html','visits.html','calendar.html','reservations.html','reviews.html','index.html']) {
    const direct = page(name, shared);
    assert.equal(direct.ctx.destination, 'checkin.html', name);
    direct.fire('pageshow', { persisted: true });
    assert.ok(direct.elements['salon-access-shield'], name);
  }
  const reopened = page('checkin.html', shared, false);
  assert.equal(reopened.ctx.destination, undefined);
  assert.throws(() => reopened.ctx.SalonAccess.requireStaff(), /sign-in/);
});

test('invalid PIN keeps lock; valid existing credentials unlock only the current session', async () => {
  const shared = storage();
  shared.setItem('sista_customer_mode', 'true');
  shared.setItem('sista_session_cutoff', String(Date.now()));
  const salt = new Uint8Array(16).fill(7);
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('123456'), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  shared.setItem('sista_users', JSON.stringify([{ username: 'Erica', role: 'staff', salt: [...salt], hash: Buffer.from(bits).toString('hex') }]));
  const customer = page('checkin.html', shared, false);
  await assert.rejects(customer.ctx.SalonAccess.unlock('Erica', 'staff', 'wrong'), /incorrect/);
  assert.equal(shared.getItem('sista_customer_mode'), 'true');
  shared.removeItem('sista_unlock_after');
  await customer.ctx.SalonAccess.unlock('Erica', 'staff', '123456');
  assert.equal(customer.ctx.SalonAccess.requireStaff().username, 'Erica');
  assert.equal(shared.getItem('sista_customer_mode'), null);
  const old = page('dashboard.html', shared, true);
  assert.match(old.ctx.destination, /index.html/);
  assert.ok(old.elements['salon-access-shield']);
});

test('every private page hides content before loading the access guard', () => {
  for (const name of ['dashboard','clients','services','reviews','reservations','reports','revenue','notepad','calendar','visits','index']) {
    const html = fs.readFileSync(path.join(__dirname, '..', name + '.html'), 'utf8');
    const shield = html.indexOf('id="salon-access-shield"');
    assert.ok(shield > 0 && shield < html.indexOf('<script src="auth.js">'), name);
  }
});
