// auth.js
(function () {
  // Pages that require a logged-in session
  const PROTECTED = [
    "dashboard.html","clients.html","services.html",
    "reviews.html","reservations.html","reports.html","revenue.html"
  ];

  const page = location.pathname.split("/").pop() || "index.html";
  const isLoginPage = page === "index.html" || page === "";
  const isProtected = PROTECTED.includes(page);

  const getSession = () => {
    try { return JSON.parse(sessionStorage.getItem("sista_session") || "null"); }
    catch { return null; }
  };

  const session = getSession();
  const valid = !!(session && session.user && Date.now() < session.expiresAt);

  // Block direct URL access when not logged in
  if (isProtected && !valid) {
    sessionStorage.removeItem("sista_session");
    localStorage.removeItem("loggedUser");
    location.replace("index.html?next=" + encodeURIComponent(location.pathname));
    return;
  }

  // If already logged in and on login page, send to dashboard
  if (isLoginPage && valid) {
    location.replace("dashboard.html");
    return;
  }

  // Keep localStorage.user in sync for pages that read it
  if (valid && !localStorage.getItem("loggedUser")) {
    localStorage.setItem("loggedUser", JSON.stringify(session.user));
  }

  // Cross-tab logout enforcement
  window.addEventListener("storage", (e) => {
    if (e.key === "sista_session_kill" && isProtected) {
      location.replace("index.html");
    }
  });

  // Handle back/forward cache (so you can't see a protected page after logout)
  window.addEventListener("pageshow", () => {
    const s = getSession();
    if (isProtected && !(s && s.user && Date.now() < s.expiresAt)) {
      location.replace("index.html");
    }
  });

  // Universal logout hook: any element with id="logoutBtn" or data-logout
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#logoutBtn, [data-logout]");
    if (!btn) return;
    e.preventDefault();
    try { sessionStorage.removeItem("sista_session"); } catch {}
    try { localStorage.removeItem("loggedUser"); } catch {}
    // poke other tabs
    localStorage.setItem("sista_session_kill", String(Date.now()));
    location.replace("index.html");
  });
})();
