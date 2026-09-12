// App navigation lock. iPad Guided Access provides the device-level app lock.
(function () {
  const PRIVATE = ['dashboard.html', 'clients.html', 'services.html', 'reviews.html',
    'reservations.html', 'reports.html', 'revenue.html', 'notepad.html', 'calendar.html', 'visits.html'];
  const page = location.pathname.split('/').pop() || 'index.html';
  const isPrivate = PRIVATE.includes(page) || !!document.documentElement?.hasAttribute('data-salon-private');
  const isLogin = page === 'index.html';
  const locked = () => localStorage.getItem('sista_customer_mode') === 'true';
  function session() {
    try { return JSON.parse(sessionStorage.getItem('sista_session') || 'null'); } catch { return null; }
  }
  function requireStaff() {
    const s = session();
    const cutoff = Number(localStorage.getItem('sista_session_cutoff') || 0);
    if (locked() || !s || !['admin', 'staff'].includes(s.user?.role) ||
      !(s.expiresAt > Date.now()) || !(s.issuedAt > cutoff)) throw new Error('Staff sign-in required.');
    return s.user;
  }
  function shield(hide) {
    let style = document.getElementById('salon-access-shield');
    if (hide && !style) {
      style = document.createElement('style');
      style.id = 'salon-access-shield';
      style.textContent = 'html{visibility:hidden!important}';
      document.head.appendChild(style);
    } else if (!hide) style?.remove();
  }
  function enforce() {
    if (page === 'checkin.html' && !locked()) {
      shield(true);
      location.replace('notepad.html');
      return false;
    }
    if ((isPrivate || isLogin) && locked()) {
      shield(true);
      sessionStorage.removeItem('sista_session');
      location.replace('checkin.html');
      return false;
    }
    if (isPrivate) {
      try { requireStaff(); } catch {
        shield(true);
        sessionStorage.removeItem('sista_session');
        location.replace('index.html?next=' + encodeURIComponent(page));
        return false;
      }
    }
    shield(false);
    return true;
  }
  function enterCustomerMode() {
    requireStaff();
    localStorage.setItem('sista_session_cutoff', String(Date.now()));
    localStorage.setItem('sista_customer_mode', 'true');
    sessionStorage.removeItem('sista_session');
    localStorage.removeItem('loggedUser');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    shield(true);
    location.replace('checkin.html');
  }
  async function unlock(username, role, pin) {
    const until = Number(localStorage.getItem('sista_unlock_after') || 0);
    if (Date.now() < until) throw new Error('Please wait a moment before trying again.');
    let users;
    try { users = JSON.parse(localStorage.getItem('sista_users') || '[]'); } catch { users = []; }
    const user = users.find(u => u.username === username && u.role === role && ['admin', 'staff'].includes(role));
    let valid = false;
    if (user) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256',
        salt: new Uint8Array(user.salt), iterations: 150000 }, key, 256);
      valid = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('') === user.hash;
    }
    if (!valid) {
      localStorage.setItem('sista_unlock_after', String(Date.now() + 2000));
      throw new Error('Username, role or PIN is incorrect.');
    }
    const issuedAt = Math.max(Date.now(), Number(localStorage.getItem('sista_session_cutoff') || 0) + 1);
    const safeUser = { username: user.username, role: user.role };
    sessionStorage.setItem('sista_session', JSON.stringify({ user: safeUser, issuedAt, expiresAt: issuedAt + 8 * 60 * 60 * 1000 }));
    localStorage.setItem('loggedUser', JSON.stringify(safeUser));
    localStorage.setItem('username', safeUser.username);
    localStorage.setItem('role', safeUser.role);
    localStorage.removeItem('sista_unlock_after');
    localStorage.removeItem('sista_customer_mode');
    return safeUser;
  }
  window.SalonAccess = { requireStaff, enterCustomerMode, unlock, locked };
  enforce();
  window.addEventListener('pageshow', enforce);
  // Hide private pages before Safari snapshots them for back/forward navigation.
  window.addEventListener('pagehide', () => { if (isPrivate || isLogin) shield(true); });
  document.addEventListener('visibilitychange', () => {
    if (isPrivate || isLogin) { if (document.hidden) shield(true); else enforce(); }
  });
  window.addEventListener('storage', e => {
    if (['sista_customer_mode', 'sista_session_cutoff', 'sista_session_kill'].includes(e.key)) {
      if (e.key === 'sista_session_kill') sessionStorage.removeItem('sista_session');
      enforce();
    }
    if (e.key === 'salon_clients_changed' && isPrivate && enforce()) {
      window.dispatchEvent(new Event('salon:clients-updated'));
    }
  });
  document.addEventListener('submit', e => {
    if ((isPrivate || isLogin) && !enforce()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('click', e => {
    if ((isPrivate || isLogin) && !enforce()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!e.target.closest('[data-logout], #logoutBtn')) return;
    e.preventDefault();
    sessionStorage.removeItem('sista_session');
    localStorage.removeItem('loggedUser');
    localStorage.setItem('sista_session_kill', String(Date.now()));
    shield(true);
    location.replace('index.html');
  }, true);
})();
