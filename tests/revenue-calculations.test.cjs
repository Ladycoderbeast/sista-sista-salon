const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const helperPath = path.join(root, 'revenue-math.js');
for (const timezone of ['Africa/Accra','Asia/Tokyo','America/New_York','Australia/Adelaide','Pacific/Honolulu']) {
  test(`local revenue boundaries and decimal sums in ${timezone}`, () => {
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict'); require(${JSON.stringify(helperPath)});
      const m = globalThis.SalonRevenue;
      assert.equal(m.dateKey(new Date(2026,8,12,0,5)), '2026-09-12');
      assert.equal(m.dateKey(new Date(2026,8,12,23,55)), '2026-09-12');
      function sum(day, records) {const t=m.accumulator(day);records.forEach(([date,amount])=>t.include({date,amount}));return t;}
      let t=sum('2026-09-12',[['2026-09-12','150.10'],['2026-09-12','0.20'],['2026-09-11','100'],['2026-09-07','200'],['2026-09-06','50'],['2026-08-31','40'],['2026-01-01','20']]);
      assert.equal(t.daily,15030);assert.equal(t.weekly,45030);assert.equal(t.monthly,50030);assert.equal(t.yearly,56030);
      assert.equal(t.weeklyVisits.reduce((a,b)=>a+b),4);
      t=sum('2019-01-01',[['2018-12-31','200'],['2019-01-01','300']]);
      assert.equal(t.weekly,50000);assert.equal(t.yearly,30000);assert.equal(t.start,'2018-12-31');assert.equal(t.end,'2019-01-06');
      t=sum('2018-12-31',[['2018-01-01','100'],['2018-12-31','200']]);assert.equal(t.weekly,20000);assert.deepEqual(Object.keys(t.weeks),['2018-01-01','2018-12-31']);
      t=sum('2024-03-10',[['2024-03-04','10'],['2024-03-10','20'],['2024-03-11','100']]);assert.equal(t.weekly,3000);assert.equal(t.end,'2024-03-10');
      t=sum('2024-11-03',[['2024-10-28','10'],['2024-11-03','20'],['2024-11-04','100']]);assert.equal(t.weekly,3000);
      assert.equal(m.inYear('2024-02-29',2025),'2025-02-28');
      t=sum('2024-02-29',[['2024-02-29','10'],['2024-02-28','20'],['2024-03-01','30']]);assert.equal(t.monthly,3000);
      t=sum('2026-09-12',[['2026-09-12','abc'],['2026-02-30','10'],['2026-09-12','1,250.50'],['2026-09-12','-1'],['2026-09-12','0.005']]);assert.equal(t.daily,125050);assert.equal(t.invalid,4);
      assert.equal(m.cents(''),0);assert.equal(m.cents('12,34'),null);assert.equal(m.cents(Infinity),null);
      assert.equal(m.trend(15000,0),'GHS 150.00 today; no revenue yesterday');assert.equal(m.trend(15000,10000),'+50.0% from yesterday');assert.equal(m.trend(0,10000),'−100.0% from yesterday');
    `], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
}
async function page(t, records) {
  const dom = new JSDOM(read('revenue.html'), { runScripts: 'outside-only', url: 'https://salon.test/revenue.html' });
  const w = dom.window;
  w.indexedDB = new IDBFactory();
  const db = await new Promise(resolve => {
    const req = w.indexedDB.open('SalonDB',1);
    req.onupgradeneeded = () => req.result.createObjectStore('clients',{ keyPath:'id',autoIncrement:true });
    req.onsuccess = () => resolve(req.result);
  });
  await new Promise(resolve => {const tx=db.transaction('clients','readwrite');records.forEach(record=>tx.objectStore('clients').add(record));tx.oncomplete=resolve;});
  w.eval(read('revenue-math.js'));
  w.eval(read('revenue-app.js'));
  await w.updateRevenueSummary();
  const appDb = await w.openRevenueDatabase();
  t.after(()=>{appDb.close();db.close();w.close();});
  return {w,db, setDate:async date=>{w.document.getElementById('revenueDate').value=date;await w.updateRevenueSummary();}, cells:()=>[...w.document.querySelectorAll('#revenueTable tbody tr')].map(row=>row.textContent)};
}
test('historical date selector shows real day/week/month/year totals without requiring chart libraries',async t=>{
  const p=await page(t,[{date:'2018-12-31',amount:'200'},{date:'2019-01-01',amount:'300'}]);
  await p.setDate('2019-01-01');
  assert.match(p.cells()[0],/2019-01-01.*300.00/);
  assert.match(p.cells()[1],/2018-12-31 to 2019-01-06.*500.00/);
  assert.match(p.cells()[3],/2019.*300.00/);
  assert.equal(p.w.document.getElementById('exportCSV').disabled,false);
  assert.match(p.w.document.getElementById('revenueChartNotice').textContent,/Chart unavailable/);
});
test('invalid amounts are flagged; failed database reads hide stale totals and disable exports',async t=>{
  const p=await page(t,[{date:'2026-09-12',amount:'abc'},{date:'2026-09-12',amount:'10.10'}]);
  await p.setDate('2026-09-12');
  assert.match(p.cells()[0],/10.10/);assert.match(p.w.document.getElementById('revenueStatus').textContent,/1 record/);
  p.w.eval("openRevenueDatabase = async () => { throw new Error('Database unavailable'); }");
  await p.w.updateRevenueSummary();
  assert.match(p.cells()[0],/Database unavailable/);assert.equal(p.w.document.getElementById('exportCSV').disabled,true);
});
test('rapid date changes publish only the latest selected period',async t=>{
  const p=await page(t,[{date:'2025-01-01',amount:'10'},{date:'2026-01-01',amount:'20'}]);
  const older=p.setDate('2025-01-01'),newer=p.setDate('2026-01-01');
  await Promise.all([older,newer]);assert.match(p.cells()[0],/2026-01-01.*20.00/);
});
