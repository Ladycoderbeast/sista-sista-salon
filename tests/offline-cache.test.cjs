const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function install(failedAsset) {
  const handlers = {}, cached = [];
  const context = {
    self: { addEventListener(type, handler) { handlers[type] = handler; }, skipWaiting() {} },
    caches: { open: async () => ({ put: async url => cached.push(url) }) },
    fetch: async url => ({ ok: url !== failedAsset, clone() { return this; } })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
  let result;
  handlers.install({ waitUntil(promise) { result = promise; } });
  await result;
  return cached;
}
test('offline release requires access guard and check-in scripts to cache successfully', async () => {
  await assert.rejects(install('./auth.js'), /Could not cache/);
  await assert.rejects(install('./visit-store.js'), /Could not cache/);
});
test('offline cache includes all check-in pages and tolerates a missing optional image', async () => {
  const cached = await install('./assets/sista-sista-home.jpeg');
  for (const asset of ['new-app.js','checkin.html','checkin.css','checkin.js','checkin-services.js','notepad.js','visit-store.js','auth.js']) assert.ok(cached.includes('./' + asset));
});
