// Pending check-ins and completed client visits share a database so approval is atomic.
(function () {
  let connectionPromise;
  function open() {
    if (connectionPromise) return connectionPromise;
    connectionPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('SalonDB', 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['clients', 'visits', 'reservations', 'services', 'checkins']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        }
        const clients = req.transaction.objectStore('clients');
        if (!clients.indexNames.contains('date')) clients.createIndex('date', 'date');
        if (!clients.indexNames.contains('checkinId')) clients.createIndex('checkinId', 'checkinId', { unique: true });
        const checkins = req.transaction.objectStore('checkins');
        if (!checkins.indexNames.contains('status')) checkins.createIndex('status', 'status');
        if (!checkins.indexNames.contains('submissionId')) checkins.createIndex('submissionId', 'submissionId', { unique: true });
      };
      req.onblocked = () => window.dispatchEvent(new Event('salon:database-blocked'));
      req.onerror = () => { connectionPromise = null; reject(req.error); };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); connectionPromise = null; };
        db.onclose = () => { connectionPromise = null; };
        resolve(db);
      };
    });
    return connectionPromise;
  }
  const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
  const services = value => [...new Set((Array.isArray(value) ? value : []).map(v => text(v)).filter(Boolean))].slice(0, 30);
  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    return localDate(new Date(y, m - 1, d)) === value;
  }
  function completed(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not save. Please try again.'));
    });
  }
  async function submit(input, submissionId) {
    const name = text(input.name), phone = text(input.phone, 40), chosen = services(input.services);
    if (!name || !phone || !chosen.length || !submissionId) throw new Error('Enter your name, phone and services.');
    const db = await open();
    const tx = db.transaction('checkins', 'readwrite');
    const store = tx.objectStore('checkins');
    const done = completed(tx);
    let id;
    const existing = store.index('submissionId').get(submissionId);
    existing.onsuccess = () => {
      if (existing.result) { id = existing.result.id; return; }
      const now = new Date();
      const req = store.add({ name, phone, services: chosen,
        gender: ['Female', 'Male'].includes(input.gender) ? input.gender : '',
        date: localDate(now), time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        createdAt: now.getTime(), status: 'pending', submissionId });
      req.onsuccess = () => { id = req.result; };
    };
    await done;
    localStorage.setItem('salon_checkins_changed', String(Date.now()));
    return id;
  }
  async function list(status = 'active') {
    SalonAccess.requireStaff();
    const db = await open();
    SalonAccess.requireStaff();
    const tx = db.transaction('checkins');
    const out = [];
    const done = completed(tx);
    const store = tx.objectStore('checkins');
    const index = store.index('status');
    for (const state of status === 'active' ? ['pending', 'in_progress'] : [status]) {
      let count = 0;
      index.openCursor(state, status === 'active' ? 'next' : 'prev').onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return;
        out.push(cursor.value);
        if (++count < 100) cursor.continue();
      };
    }
    await done;
    return out.sort((a, b) => status === 'active' ? a.id - b.id : b.id - a.id).slice(0, 100);
  }
  async function changeStatus(id, status) {
    const user = SalonAccess.requireStaff();
    if (!['in_progress', 'cancelled'].includes(status)) throw new Error('Invalid status.');
    const db = await open();
    SalonAccess.requireStaff();
    const tx = db.transaction('checkins', 'readwrite');
    const done = completed(tx);
    const store = tx.objectStore('checkins');
    const req = store.get(id);
    let error;
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry || !['pending', 'in_progress'].includes(entry.status)) { error = new Error('This visit is already closed.'); tx.abort(); return; }
      store.put({ ...entry, status, updatedAt: Date.now(), updatedBy: user.username });
    };
    try { await done; } catch (e) { throw error || e; }
  }
  async function approve(id, input) {
    const user = SalonAccess.requireStaff();
    const name = text(input.name), phone = text(input.phone, 40), chosen = services(input.services);
    const staff = text(input.staff), amount = Number(input.amount), date = text(input.date, 10);
    if (!name || !phone || !chosen.length || chosen.includes('Help me choose') || !staff ||
      text(input.amount) === '' || !Number.isFinite(amount) || amount < 0 || !validDate(date) ||
      !['Cash', 'Mobile Money'].includes(input.paymentMethod)) {
      throw new Error('Confirm the name, phone, actual services, workers, visit date, amount paid and payment method.');
    }
    const db = await open();
    SalonAccess.requireStaff();
    const tx = db.transaction(['checkins', 'clients'], 'readwrite');
    const done = completed(tx);
    const queue = tx.objectStore('checkins');
    const req = queue.get(id);
    let clientId, error;
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry || entry.status === 'cancelled') { error = new Error('This visit cannot be completed.'); tx.abort(); return; }
      if (entry.status === 'completed') { clientId = entry.clientId; return; }
      const completedAt = Date.now();
      const record = { name, phone, gender: ['Female', 'Male'].includes(input.gender) ? input.gender : '',
        services: chosen, staff, amount: amount.toFixed(2), paymentMethod: input.paymentMethod,
        date, time: entry.time, photoData: '', checkinId: id, completedAt, approvedBy: user.username };
      const add = tx.objectStore('clients').add(record);
      add.onsuccess = () => {
        clientId = add.result;
        queue.put({ ...entry, name, phone, gender: record.gender, date,
          status: 'completed', clientId, completedAt, approvedBy: user.username,
          approvedServices: chosen, staff, amount: record.amount, paymentMethod: record.paymentMethod });
      };
    };
    try { await done; } catch (e) { throw error || e; }
    localStorage.setItem('salon_clients_changed', String(Date.now()));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('dashboardChannel'); channel.postMessage('update'); channel.close();
    }
    return clientId;
  }
  async function serviceNames() {
    const db = await open();
    const tx = db.transaction('services');
    const done = completed(tx);
    const req = tx.objectStore('services').getAll();
    await done;
    return [...new Set(req.result.map(s => text(s.name)).filter(Boolean))].sort();
  }
  window.SalonVisits = { open, submit, list, changeStatus, approve, serviceNames, localDate };
})();
