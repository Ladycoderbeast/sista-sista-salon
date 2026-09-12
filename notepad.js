(function () {
  const message = document.getElementById('queueMessage');
  const host = document.getElementById('visitQueue');
  const dialog = document.getElementById('approvalDialog');
  const form = document.getElementById('approvalForm');
  const approvalMessage = document.getElementById('approvalMessage');
  let selectedId = null, loading = 0;
  const statusLabel = status => ({ pending: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' })[status];
  function element(tag, content, className) {
    const node = document.createElement(tag); node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  function button(label, action) {
    const node = element('button', label); node.type = 'button';
    node.addEventListener('click', async () => {
      node.disabled = true;
      try { SalonAccess.requireStaff(); await action(); }
      catch (error) { message.textContent = error.message; }
      finally { node.disabled = false; }
    });
    return node;
  }
  function review(entry) {
    SalonAccess.requireStaff();
    selectedId = entry.id;
    form.reset(); approvalMessage.textContent = '';
    for (const key of ['name', 'phone', 'gender', 'date', 'staff']) form.elements[key].value = entry[key] || '';
    form.elements.services.value = entry.services.join('\n');
    dialog.showModal();
  }
  async function refresh() {
    const token = ++loading;
    try {
      const records = await SalonVisits.list(document.getElementById('queueStatus').value);
      SalonAccess.requireStaff();
      if (token !== loading) return;
      const fragment = document.createDocumentFragment();
      if (!records.length) fragment.appendChild(element('p', 'No visits in this view.'));
      for (const entry of records) {
        const card = element('article', '', 'visit-card');
        card.append(element('h3', entry.name), element('span', statusLabel(entry.status), `visit-status ${entry.status}`));
        card.append(element('p', `${entry.phone}\n${entry.date} · ${entry.time}\n${(entry.approvedServices || entry.services).join(', ')}`));
        if (entry.status === 'completed') card.append(element('p', `Worker(s): ${entry.staff}\nGHS ${entry.amount} · ${entry.paymentMethod}\nApproved by ${entry.approvedBy}`));
        if (['pending', 'in_progress'].includes(entry.status)) {
          const actions = element('div', '', 'visit-actions');
          if (entry.status === 'pending') actions.append(button('Start service', async () => { await SalonVisits.changeStatus(entry.id, 'in_progress'); await refresh(); }));
          actions.append(button('Review & complete', () => review(entry)));
          actions.append(button('Cancel visit', () => {
            cancelId = entry.id;
            cancelName = entry.name;
            document.getElementById('cancelVisitDescription').textContent = `Cancel the visit for ${entry.name}?`;
            cancelError.textContent = '';
            cancelDialog.showModal();
          }));
          card.append(actions);
        }
        fragment.append(card);
      }
      host.replaceChildren(fragment);
    } catch (error) { message.textContent = error.message; }
  }
  const cancelDialog = document.getElementById('cancelVisitDialog');
  const cancelError = document.getElementById('cancelVisitError');
  const cancelConfirm = document.getElementById('confirmCancelVisit');
  const keepVisit = document.getElementById('keepVisit');
  let cancelId = null, cancelName = '', cancelling = false, toastTimer;
  function toast(text) {
    const node = document.getElementById('visitToast');
    clearTimeout(toastTimer);
    node.textContent = text;
    node.classList.add('visible');
    toastTimer = setTimeout(() => node.classList.remove('visible'), 4500);
  }
  keepVisit.onclick = () => { if (!cancelling) cancelDialog.close(); };
  cancelDialog.addEventListener('cancel', e => { if (cancelling) e.preventDefault(); });
  cancelDialog.addEventListener('close', () => { cancelId = null; cancelError.textContent = ''; });
  cancelConfirm.onclick = async () => {
    if (cancelling || cancelId === null) return;
    cancelling = true;
    cancelConfirm.disabled = keepVisit.disabled = true;
    cancelConfirm.textContent = 'Cancelling…';
    cancelError.textContent = '';
    try {
      SalonAccess.requireStaff();
      await SalonVisits.changeStatus(cancelId, 'cancelled');
      cancelDialog.close();
      toast(`Visit cancelled for ${cancelName}.`);
      await refresh();
    } catch (error) { cancelError.textContent = error.message || 'Could not cancel. Please try again.'; }
    finally {
      cancelling = false;
      cancelConfirm.disabled = keepVisit.disabled = false;
      cancelConfirm.textContent = 'Yes, cancel visit';
    }
  };
  document.getElementById('startCustomer').onclick = () => {
    try { SalonAccess.enterCustomerMode(); } catch (error) { message.textContent = error.message; }
  };
  document.getElementById('queueStatus').onchange = refresh;
  document.getElementById('closeApproval').onclick = () => dialog.close();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled || !form.reportValidity()) return;
    submit.disabled = true; approvalMessage.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    data.services = data.services.split('\n');
    try {
      await SalonVisits.approve(selectedId, data);
      dialog.close(); form.reset();
      message.textContent = 'Visit completed and saved to Clients. Totals and reports include this visit.';
      await refresh();
    } catch (error) { approvalMessage.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  document.getElementById('toggleDark').addEventListener('change', e => {
    document.body.classList.toggle('dark', e.target.checked);
    localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
  });
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark'); document.getElementById('toggleDark').checked = true;
  }
  let legacyLoaded = false;
  document.getElementById('legacyNotes').addEventListener('toggle', async e => {
    if (!e.target.open || legacyLoaded) return;
    const legacy = document.getElementById('legacyList');
    try {
      SalonAccess.requireStaff();
      const rows = await new Promise((resolve, reject) => {
        const req = indexedDB.open('SalonNotepadDB');
        // No legacy database: abort rather than creating an empty one.
        let missing = false;
        req.onupgradeneeded = () => { missing = true; req.transaction.abort(); };
        req.onerror = () => missing ? resolve([]) : reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => db.close();
          if (!db.objectStoreNames.contains('notepad_entries')) { db.close(); resolve([]); return; }
          const tx = db.transaction('notepad_entries');
          const rows = [];
          tx.objectStore('notepad_entries').openCursor(null, 'prev').onsuccess = e => {
            const cursor = e.target.result;
            if (!cursor) return;
            rows.push(cursor.value);
            cursor.continue();
          };
          tx.oncomplete = () => { db.close(); resolve(rows); };
          tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
        };
      });
      SalonAccess.requireStaff();
      legacy.replaceChildren();
      let shown = 0;
      const more = button('Show more previous notes', () => renderMore());
      function renderMore() {
        more.remove();
        for (const entry of rows.slice(shown, shown + 50)) {
          legacy.append(element('p', `${entry.date || ''} · ${entry.time || ''} — ${entry.name}\n${entry.phone}\n${(entry.services || []).join(', ')}`, 'visit-card'));
        }
        shown += 50;
        if (shown < rows.length) legacy.append(more);
      }
      if (!rows.length) legacy.append(element('p', 'No previous notes.'));
      renderMore(); legacyLoaded = true;
    } catch (error) { legacy.textContent = error.message; }
  });
  window.addEventListener('storage', e => { if (e.key === 'salon_checkins_changed') refresh(); });
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('salon:database-blocked', () => { message.textContent = 'Close other salon tabs and reopen to finish updating.'; });
  refresh();
})();
