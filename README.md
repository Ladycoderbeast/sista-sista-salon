# Sista Sista Salon & Spa — PWA

A lightweight, offline-ready web app for managing salon clients, services, reservations, and revenue.  
Deployed on GitHub Pages and installable on iPad as a full-screen app.

**Live site:** https://ladycoderbeast.github.io/sista-sista-salon/

---

## ✨ Features
- Offline-first (IndexedDB data + Service Worker caching)
- Role-aware UI (Admin vs Staff)
- Client records: photo, gender, service, date/time, staff, amount, payment method
- Filter & search (name, phone, service, staff)
- CSV/PDF export & print
- Reservations with upcoming notifications
- Charts: weekly visit trend, daily/monthly revenue
- Dark theme toggle
- Installable PWA (Add to Home Screen on iPad)

---

## 📲 Install on iPad (Add to Home Screen)
1. Open **Safari** and visit: `https://ladycoderbeast.github.io/sista-sista-salon/`
2. Tap the **Share** icon.
3. Tap **Add to Home Screen**.
4. Launch from the new home screen icon — it runs full screen.
5. First run needs internet to cache files; afterwards it works offline.

> If the splash screen doesn’t appear, make sure you opened the app from the **home screen icon**, not a Safari tab.

---

## 🔐 First-run PIN setup (no server)
- On first open, you’ll see a **First-time Setup** modal.
- Create an **Admin** PIN (required) and an optional **Staff** PIN.
- PINs are **salted & hashed** in the browser and stored **locally on the device** (no cloud).
- To start over on a device, use **Reset PINs** on the login screen.

> Because PINs live on each device, a new iPad will need its own first-run setup.

---

## 📴 Offline behavior
- The first load downloads core pages and assets into a cache.
- When offline, pages are served from the cache.  
  If a page wasn’t cached yet, you’ll see **offline.html**.
- **Shipping updates:** publish changes and **bump the cache name** in `sw.js`
  (e.g., `sista-sista-cache-v4` → `sista-sista-cache-v5`). Users need one online refresh to pick up the new version.

---

## 📁 Project structure (high level)
assets/
icons/ # PWA icons (152, 167, 180, 192, 512)
splash/ # iPad splash screens
chart.min.js
chartjs-plugin-datalabels.min.js

index.html # Login + First-run PIN setup (registers SW, loads manifest)
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
auth.js # Route guard (blocks direct URL access without session)
user-icon.js
manifest.json # PWA manifest
sw.js # Service Worker (cache strategy)
.nojekyll # Prevent Jekyll processing on GitHub Pages


---

## 🚀 Deploy (GitHub Pages)
- Source: **main** branch, **/(root)**.
- Service Worker is registered with a **relative path** and scope:
  - Registration: `./sw.js`
  - Scope: `./`
- Manifest uses:
```json
{ "id": "./", "start_url": "./", "scope": "./", "display": "standalone" }
.nojekyll is included to prevent Jekyll from altering files.

Credits
Built by H-A-N-A Technologies — https://hanatechnologies.org
© 2025 H-A-N-A Technologies. All rights reserved.

::contentReference[oaicite:0]{index=0}
