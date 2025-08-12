# Sista Sista Salon & Spa — PWA

A lightweight offline-ready web app for managing salon clients, services, reservations, and revenue.  
Deployed with GitHub Pages and installable on iPad as a full-screen app.

**Live site:** https://ladycoderbeast.github.io/sista-sista-salon

---

## Features
- 📋 Client management (photos, services, payments, dates/times)
- 📅 Reservations & notifications
- 📈 Dashboard stats + weekly trend chart
- 💾 Offline support via Service Worker (caches core pages/assets)
- 🔐 Simple role-based login (admin / staff)
- 🌓 Dark mode toggle
- 📱 Installable PWA (Add to Home Screen)

---

## Install on iPad (Add to Home Screen)
1. Open Safari and visit: `https://ladycoderbeast.github.io/sista-sista-salon`
2. Tap the **Share** icon.
3. Tap **Add to Home Screen**.
4. Open the new home screen icon — the app will run full screen.
5. First run needs internet to cache; after that it works offline.

> If the splash screen doesn’t show, make sure the app was opened from the **home screen icon**, not inside Safari tabs.

---

## Offline behavior
- The first load downloads core pages and assets to a cache.
- While offline, navigation uses the cache; if a page wasn’t cached yet, you’ll see **offline.html**.
- To ship an update, publish changes and **bump the cache name** in `sw.js` (e.g., `sista-sista-cache-v4` → `v5`) so clients get the new files.

---

## Security & login
- This demo uses simple in-browser credentials (no server).  
- **Do not publish real passwords**. Replace demo users in `index.html` with your own or connect to a backend later.
- A small `auth.js` gate checks for a session before allowing access to dashboard pages.

---

## Project structure (high level)
