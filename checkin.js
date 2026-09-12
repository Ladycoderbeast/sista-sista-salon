(function () {
  const form = document.getElementById('customerForm');
  const submit = form.querySelector('button[type="submit"]');
  const message = document.getElementById('customerError');
  const confirmation = document.getElementById('customerConfirmation');
  let submissionId = crypto.randomUUID();
  let busy = false;
  loadCheckinServices(document.getElementById('customerServices')).then(() => { submit.disabled = false; })
    .catch(() => { message.textContent = 'Could not load services. Please ask a staff member to reopen check-in.'; });
  const search = document.getElementById('findService');
  function filterServices() {
    const query = search.value.trim().toLowerCase();
    document.querySelectorAll('#customerServices label').forEach(label => {
      label.hidden = !label.textContent.toLowerCase().includes(query);
    });
  }
  search.addEventListener('input', filterServices);
  form.addEventListener('reset', () => setTimeout(filterServices, 0));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; submit.disabled = true; message.textContent = ''; confirmation.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    data.services = Array.from(form.querySelectorAll('[name="services"]:checked'), input => input.value);
    try {
      await SalonVisits.submit(data, submissionId);
      form.reset();
      submissionId = crypto.randomUUID();
      confirmation.textContent = 'You’re checked in! Your visit is pending. Please return the iPad to our team.';
      confirmation.scrollIntoView({ block: 'nearest' });
    } catch (error) { message.textContent = error.message || 'Could not save. Please try again.'; }
    finally { busy = false; submit.disabled = false; }
  });
  const dialog = document.getElementById('staffDialog');
  const unlockForm = document.getElementById('unlockForm');
  const unlockMessage = document.getElementById('unlockMessage');
  document.getElementById('staffReturn').onclick = () => { unlockForm.reset(); unlockMessage.textContent = ''; dialog.showModal(); };
  document.getElementById('cancelUnlock').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { unlockForm.reset(); unlockMessage.textContent = ''; });
  unlockForm.addEventListener('submit', async e => {
    e.preventDefault();
    const button = unlockForm.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true; unlockMessage.textContent = '';
    const data = Object.fromEntries(new FormData(unlockForm));
    try {
      await SalonAccess.unlock(data.username.trim(), data.role, data.pin.trim());
      form.reset(); unlockForm.reset();
      location.replace('notepad.html');
    } catch (error) { unlockMessage.textContent = error.message; unlockForm.elements.pin.value = ''; }
    finally { button.disabled = false; }
  });
  window.addEventListener('pageshow', () => { form.reset(); unlockForm.reset(); });
  window.addEventListener('salon:database-blocked', () => {
    message.textContent = 'Please ask staff to close other salon tabs and reopen the app to finish updating.';
  });
})();
