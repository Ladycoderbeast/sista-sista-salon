Run with Node.js 22.12 or newer:

```sh
npm install
npm test
```

These development-only tests use jsdom and fake-indexeddb; the offline app has no new runtime dependencies. Tests cover the version 1 to 3 database upgrade, date-index queries, saving and overlapping refreshes, pagination, filters, search debouncing, complete PDF/print exports, background scan guards, and photo dimension/resource handling.

The 5,001-record fixture checks that Today visits only matching records. It measures work avoided, not actual iPad latency. Photo tests verify sizing and error handling with mocked canvas/image decoding; review image quality and performance on the iPad before release.

Release notes:
- Ship all changed pages/scripts together with service worker cache v11.
- SalonDB version 3 adds the date index, pending check-ins, and unique submission/approval indexes without rewriting existing client records or photos. Other pages open the current version to remain compatible.
- If an older open tab blocks the upgrade, close the other salon tabs and reopen. The app displays a message for this case.
- Client lists display 50 rows per page, newest entries first. Cards count matching records across pages in the selected Today/All scope. PDF and print cover all matching records; CSV retains its existing full-history behavior.
- Only new photo uploads are resized (maximum 1280px, with a 96px list thumbnail). Existing photos remain intact.

Customer check-in workflow:
- Staff opens Notepad and taps Start customer mode before handing over the iPad. The customer screen has no salon navigation or client list.
- Customer mode persists across reload/reopen. It revokes previous staff sessions across tabs. Existing username, role and PIN are required to unlock. Protected pages remain hidden if the access script cannot load.
- Pending check-ins persist locally in SalonDB.checkins. In-progress/cancelled check-ins never enter Clients. Approval atomically inserts the ordinary Clients record and marks the check-in completed, with a unique checkinId preventing duplicate approval.
- Original Notepad entries remain in SalonNotepadDB and are available as read-only previous notes. They are not converted into completed visits.
- Completion uses the reviewed visit date for existing revenue/attendance calculations and separately records the approval timestamp and staff username. Amount is the amount paid, matching the existing Clients field.
- The queue shows up to 100 active visits, oldest first, or the most recent 100 completed/cancelled visits. Completed history remains accessible in Clients.
- Dashboard, Clients, revenue and reports consume the same completed records. Reports now supports both legacy single-service values and arrays of services.

The lock is an offline application navigation/session control, not an operating-system kiosk or encrypted database. To prevent leaving the installed salon app, enable iPad Guided Access using Apple's instructions: https://support.apple.com/guide/ipad/lock-ipad-to-one-app-ipada16d1374/ipados

Before release, verify the flow in the installed iPad app offline: start customer mode, try Back/reopen/direct private pages, submit, unlock with the existing staff PIN, approve, and check Clients/dashboard/reports. Automated tests use jsdom/fake-indexeddb plus real PIN hashing; they do not replace Safari navigation, keyboard, print, or device testing.

Reviews remain on the separate staff Reviews page. Notepad and customer check-in have no review form or review invitation buttons.
