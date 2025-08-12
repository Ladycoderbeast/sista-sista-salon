# Sista Sista Salon & Spa — PWA

A lightweight, offline-ready web app for managing salon clients, services, reservations, and revenue.  
Deployed with GitHub Pages and installable on iPad as a full-screen app.

**Live site:** https://ladycoderbeast.github.io/sista-sista-salon/

---

## ✨ Features
- Offline-first (IndexedDB data + Service Worker caching)
- Role-aware UI (admin vs staff)
- Clients: add with photo, gender, service, date/time, staff, amount, payment method
- Filters & search (by name, phone, service, staff)
- CSV/PDF export & print
- Reservations with upcoming notifications
- Charts: weekly visit trend, daily/monthly revenue
- Dark theme toggle
- PWA install on iPad (“Add to Home Screen”)

---

## 📲 Install on iPad (Add to Home Screen)
1. Open **Safari** and visit: `https://ladycoderbeast.github.io/sista-sista-salon/`
2. Tap the **Share** icon.
3. Tap **Add to Home Screen**.
4. Open the new home screen icon — the app runs full screen.
5. First run needs internet to cache files; afterwards it works offline.

> If the splash screen doesn’t appear, make sure you opened the app from the **home screen icon**, not a Safari tab.

---

## 📴 Offline behavior
- The first load downloads core pages and assets to a cache.
- When offline, pages are served from the cache.  
  If a page wasn’t cached yet, you’ll see **offline.html**.
- To ship updates, publish your changes and **bump the cache name** in `sw.js`
  (e.g., `sista-sista-cache-v4` → `v5`) so devices fetch fresh files.

---

## 🔐 Security & login
- This demo uses in-browser credentials (no server).  
- **Do not publish real passwords.** Replace the example users in `index.html` or connect to a backend later.
- A small `auth.js` “gatekeeper” blocks direct URL access unless a valid session exists.

---

## 📁 Project structure (high level)
assets/
icons/ # PWA icons (152, 167, 180, 192, 512)
splash/ # iPad splash screens
chart.min.js
chartjs-plugin-datalabels.min.js
index.html # Login (registers SW, loads manifest)
dashboard.html # Overview + charts
clients.html # Client list & add form
services.html # Services
reservations.html # Reservations
reviews.html # Reviews
reports.html # Reports
revenue.html # Revenue summary
offline.html # Offline fallback
style.css
login.css
app.js # IndexedDB + UI logic
auth.js # Route guard
user-icon.js
manifest.json # PWA manifest
sw.js # Service Worker (cache strategy)
.nojekyll # Prevent Jekyll processing on GitHub Pages


---

## 🚀 Deploy (GitHub Pages)
- Source: **main** branch, **/(root)**.
- Service Worker is registered with a **relative path**: `./sw.js` and scope `./`.
- Manifest includes:
  ```json
  { "id": "./", "start_url": "./", "scope": "./", "display": "standalone" }
.nojekyll is included to prevent Jekyll from altering files.

Credits
Built by H-A-N-A Technologies — https://hanatechnologies.org
© 2025 H-A-N-A Technologies. All rights reserved.

::contentReference[oaicite:0]{index=0}
