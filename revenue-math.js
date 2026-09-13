// Calendar keys use the device's local dates. Money is summed as whole pesewas.
(function (global) {
  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    date.setFullYear(year);
    return dateKey(date) === value ? date : null;
  }
  function shiftDate(key, days) {
    const date = parseDate(key);
    if (!date) throw new Error('Choose a valid date.');
    date.setDate(date.getDate() + days);
    return dateKey(date);
  }
  function weekStart(key) {
    const date = parseDate(key);
    if (!date) throw new Error('Choose a valid date.');
    return shiftDate(key, -((date.getDay() + 6) % 7));
  }
  function inYear(key, year) {
    const date = parseDate(key);
    const lastDay = new Date(year, date.getMonth() + 1, 0).getDate();
    return dateKey(new Date(year, date.getMonth(), Math.min(date.getDate(), lastDay), 12));
  }
  function cents(value) {
    if (value == null || value === '') return 0;
    if (!['string', 'number'].includes(typeof value)) return null;
    const raw = String(value).trim();
    if (raw === '') return 0;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
    const [whole, fraction = ''] = raw.replace(/,/g, '').split('.');
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(result) ? result : null;
  }
  function add(a, b) {
    const sum = a + b;
    if (!Number.isSafeInteger(sum)) throw new Error('Revenue exceeds the supported total. Please review the records.');
    return sum;
  }
  const money = value => `GHS ${(value / 100).toFixed(2)}`;
  function accumulator(reference = dateKey()) {
    if (!parseDate(reference)) throw new Error('Choose a valid date.');
    const start = weekStart(reference), end = shiftDate(start, 6), yesterday = shiftDate(reference, -1);
    const year = Number(reference.slice(0, 4)), month = reference.slice(0, 7);
    const totals = { reference, start, end, year, month, daily: 0, weekly: 0, monthly: 0, yearly: 0,
      yesterday: 0, invalid: 0, todayVisits: 0, weeklyVisits: Array(7).fill(0),
      clients: new Set(), services: new Set(), years: new Set([year]),
      days: Object.create(null), weeks: Object.create(null), months: Object.create(null) };
    totals.include = record => {
      totals.clients.add(`${record.name}_${record.phone}`);
      (Array.isArray(record.services) ? record.services : (record.service ? [record.service] : []))
        .forEach(service => { if (service) totals.services.add(service); });
      const date = parseDate(record.date), amount = cents(record.amount);
      if (!date) { totals.invalid++; return; }
      const key = record.date;
      totals.years.add(date.getFullYear());
      if (key === reference) totals.todayVisits++;
      if (key >= start && key <= end) totals.weeklyVisits[(date.getDay() + 6) % 7]++;
      if (amount === null) { totals.invalid++; return; }
      if (key === reference) totals.daily = add(totals.daily, amount);
      if (key === yesterday) totals.yesterday = add(totals.yesterday, amount);
      if (key >= start && key <= end) totals.weekly = add(totals.weekly, amount);
      if (key.startsWith(month + '-')) totals.monthly = add(totals.monthly, amount);
      if (date.getFullYear() === year) {
        totals.yearly = add(totals.yearly, amount);
        const week = weekStart(key), monthKey = key.slice(0, 7);
        totals.days[key] = add(totals.days[key] || 0, amount);
        totals.weeks[week] = add(totals.weeks[week] || 0, amount);
        totals.months[monthKey] = add(totals.months[monthKey] || 0, amount);
      }
    };
    return totals;
  }
  function trend(today, yesterday) {
    if (!yesterday) return today ? `${money(today)} today; no revenue yesterday` : 'No revenue today or yesterday';
    const difference = today - yesterday;
    if (!difference) return 'No change from yesterday';
    return `${difference > 0 ? '+' : '−'}${(Math.abs(difference) / yesterday * 100).toFixed(1)}% from yesterday`;
  }
  function warning(count) {
    return count ? `${count} record(s) have an invalid date or amount and were excluded from revenue totals. Please review Clients.` : '';
  }
  global.SalonRevenue = { dateKey, parseDate, shiftDate, weekStart, inYear, cents, money, accumulator, trend, warning };
})(globalThis);
