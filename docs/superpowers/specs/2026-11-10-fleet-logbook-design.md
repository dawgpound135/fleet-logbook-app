# Fleet Logbook — design spec

**Date:** 2026-11-10
**Status:** Draft for review
**Author:** Liam (builder), Claude (tutor)

## 1. Purpose

A portfolio project. Drivers log trips on an Android app that measures distance from the phone's GPS. The owner of the business sees every driver and trip on a web dashboard, including a live map.

The project has two goals, and both count:

1. **A working demo** that can be shown in an interview: install the app on a phone, drive a real trip, and show it appear on the dashboard with its route, distance totals and live position.
2. **Learning full-stack development.** Liam writes all of the code; Claude tutors (explains the why, Liam attempts each step, Claude reviews). The backend (API, SQL, auth, deployment) is the main skill gap this project closes. Liam must be able to explain every part of the code.

### Confirmed brief

| Said by Liam | Assumed and confirmed |
|---|---|
| Personal / portfolio project | Android only (Windows dev machine; iOS needs a Mac) |
| Liam builds, Claude tutors | Backend in JavaScript too (Node.js) |
| Driver app: sign in, pick truck, start/end trip, GPS distance | One demo business with sample data; no multi-company sign-up, no billing |
| Owner dashboard: all drivers and trips, totals per driver/truck/period | Free tiers only |
| V1 extras: route map per trip, live map, odometer cross-check, Excel/CSV export | Public GitHub repo, built through branches and pull requests |
| Vue + JavaScript; Postgres database; free maps | Delivered in milestones, each ending in something that works |
| Drivers sign in with cell number + password; owner signs in with email + password | |
| Drivers can see their own trip history | |

### Success criteria

- A driver records a real trip on a real Android phone with the screen locked, and the GPS distance lands within the odometer cross-check tolerance.
- The owner sees that trip on the deployed dashboard: in the list, in the totals, on a route map, and on the live map while it is in progress.
- All automated tests pass in CI on every pull request.
- The README explains the project, shows a demo GIF, and links to the live dashboard.

### Non-goals (v1)

- iOS, Play Store release, multiple businesses, billing, public sign-up.
- SMS or one-time-code login; drivers changing their own password (the owner resets it).
- Paid map services (Google Maps, Roads API snap-to-road).
- Real `.xlsx` export, WebSocket live updates, PostGIS (all listed as stretch goals in section 11).

## 2. Architecture

One GitHub repository, using npm workspaces:

```
fleet-logbook-app/
  api/          Node.js + Express REST API; the only component that talks to Postgres
  dashboard/    Vue 3 + Vite web app for the owner
  driver-app/   Vue 3 + Vite web app, wrapped as an Android app with Capacitor
  shared/       plain JavaScript used by both api/ and driver-app/
  docs/         spec, implementation plan, decision log, manual test cases
```

```
 Android phone                       Render (free)                    Neon (free)
┌──────────────────┐   HTTPS/JSON   ┌──────────────────┐    SQL     ┌────────────┐
│ driver-app       │ ─────────────▶ │ api (Express)    │ ─────────▶ │ Postgres   │
│ Vue + Capacitor  │                │                  │            └────────────┘
│ background GPS   │                └──────────────────┘
│ on-phone queue   │                        ▲
└──────────────────┘                        │ HTTPS/JSON (polling for live map)
                                    ┌──────────────────┐
 Owner's browser ─────────────────▶ │ dashboard (Vue)  │  static site on Render
                                    └──────────────────┘
```

### Tech choices

| Area | Choice | Why |
|---|---|---|
| Front end | Vue 3, `<script setup>` (Composition API), Vue Router, Vite | Matches Liam's job stack. No Pinia until shared state actually needs it. |
| Driver app shell | Capacitor, plus the free community background-geolocation plugin (`@capacitor-community/background-geolocation`, confirmed in M2) | A plain website or PWA loses GPS when the screen locks; Capacitor reuses the Vue code as a native Android app. |
| Maps | Leaflet + OpenStreetMap tiles | Free, no API key; requires the OSM attribution line. Fine for demo-level traffic under OSM's tile usage policy. |
| Distance | GPS points + haversine formula in `shared/` | No maps API needed; a pure, unit-testable function. |
| API | Node.js (current LTS) + Express | Small and explicit, so nothing is hidden; middleware maps to ASP.NET Core concepts Liam knows. |
| Database access | `pg` (node-postgres) with hand-written SQL; SQL migration files (`node-pg-migrate`) | Learn SQL directly, like Dapper rather than Entity Framework. |
| Auth | `bcrypt` password hashes (cost 12), JWT in `Authorization: Bearer` header, login rate limit (`express-rate-limit`) | Standard, and teaches the security basics. |
| Validation | `zod` schemas on every request body and query | One place to define what valid input is. |
| Tests | Vitest, Supertest, Vue Test Utils | One test runner across all packages. |
| Quality | ESLint + Prettier; GitHub Actions CI on every PR | Free for public repos. |

### Where it runs

- **Development:** Postgres installed natively on Windows; API and dashboard on `localhost`; driver app in the browser first, then the Android emulator.
- **Demo:** Postgres on Neon (free), API on Render (free web service), dashboard on Render (free static site), driver app as a debug APK installed on Liam's phone through Android Studio.
- Free-tier limits change. Re-check Neon and Render limits at M8 before deploying. The known catch: Render's free API sleeps after about 15 minutes idle and takes about a minute to wake. The on-phone queue (section 4) covers this.
- **CORS:** the API allows only the dashboard's origin and the Capacitor Android origin (`https://localhost`).

## 3. Data model

```sql
users        id, name, role ('owner' | 'driver'),
             email (unique, nullable), cell_number (unique, nullable),
             password_hash, active, created_at
             CHECK: role = 'owner'  → email IS NOT NULL
                    role = 'driver' → cell_number IS NOT NULL

trucks       id, registration (unique), description, active, created_at

trips        id, driver_id → users, truck_id → trucks,
             status ('active' | 'completed'),
             started_at, ended_at,
             start_odometer_km, end_odometer_km,
             gps_distance_m, created_at
             CHECK: end_odometer_km >= start_odometer_km (when set)

trip_points  id, trip_id → trips, recorded_at, lat, lng, accuracy_m, received_at
             UNIQUE (trip_id, recorded_at)
```

### Rules enforced by the database

- **One active trip per driver and per truck:** partial unique indexes on `trips (driver_id) WHERE status = 'active'` and `trips (truck_id) WHERE status = 'active'`.
- **Retry-safe uploads:** `UNIQUE (trip_id, recorded_at)` plus `INSERT … ON CONFLICT DO NOTHING`, so a re-sent batch never double-counts points.
- **Drivers and trucks are deactivated, never deleted,** so trip history stays intact.

### Formats

- Distances are stored in metres (integers) and shown as km with one decimal.
- Timestamps are `timestamptz` stored in UTC and shown in `Africa/Johannesburg`.
- Cell numbers are stored in E.164 format. Input such as `082 123 4567`, `0821234567` or `+27 82 123 4567` is normalised to `+27821234567` by a function in `shared/`.

### Derived values (computed, not duplicated)

- **GPS distance:** computed by the API from the trip's points using `shared/` (section 4). Saved to `gps_distance_m` when the trip ends (and recomputed if late points arrive); computed on the fly for active trips.
- **Live position:** the newest point of each active trip, via `SELECT DISTINCT ON (trip_id) … ORDER BY trip_id, recorded_at DESC`.
- **Odometer flag:** `odo_km = end_odometer_km − start_odometer_km`. The trip is flagged when `|gps_km − odo_km| > max(2 km, 5% of odo_km)`. Both thresholds are constants in `shared/`.

### Volume

The GPS distance filter is 50 m (one point per 50 m of movement, so about one every 2 s at 90 km/h). An 8-hour day averaging 60 km/h produces about 480 km ÷ 50 m ≈ 10,000 points. This is small for Postgres, so plain `lat`/`lng` columns are used and PostGIS is not needed. At 50 m spacing, the straight line between points under-counts curved roads by well under 1%.

## 4. Trip flow

### Distance algorithm (`shared/distance.js`)

1. Sort the trip's points by `recorded_at`.
2. Drop points with `accuracy_m > 50`.
3. Walk the remaining points. For each point, compute the haversine distance from the last *kept* point (Earth radius 6,371,008.8 m). If the implied speed exceeds 160 km/h, it is a GPS glitch: drop the point and keep the anchor. Otherwise add the distance and make this point the new anchor.
4. Return the total in whole metres.

The driver app uses the same function for its running total; the API's result is the official figure.

### Step by step

1. **Sign in.** The driver signs in with cell number and password. The token is stored with Capacitor Preferences and lasts 30 days.
2. **Start.** The driver picks a truck (only trucks with no active trip are listed), enters the start odometer and taps **Start trip**. The API creates the trip. The app starts background GPS with a 50 m distance filter, and Android shows the "Tracking trip" foreground notification.
3. **Record.** Every GPS point is written first to an on-phone queue, so it survives lost signal, a closed app or a sleeping server. The queue is a small module (`add`, `peekBatch`, `remove`, `count`) backed by IndexedDB in the app's WebView; because the rest of the app only uses that interface, it can be swapped for the Capacitor SQLite plugin if M2 or M5 shows IndexedDB is unreliable. The in-progress screen shows running km, trip time, GPS status and "*n* points waiting to upload".
4. **Upload.** When a new point arrives and at least 30 s have passed since the last upload, the app sends up to 500 queued points in one `POST /trips/:id/points`. Points leave the queue only after the API confirms receipt; on failure they stay queued for the next attempt. Uploads are triggered by location updates rather than timers because Android slows background timers but keeps delivering location updates.
5. **End.** The driver enters the end odometer. The app uploads any queued points, then calls `POST /trips/:id/end`. The API computes the final GPS distance and marks the trip completed.
6. **Dashboard.** Completed trips appear in the trip list and totals. The live map polls `GET /live` every 15 s and shows each active truck's last position with "last seen *x* min ago".
7. **Recovery.** On launch, the app calls `GET /trips/active`. If the driver has an active trip (after a phone restart or the app being killed), tracking resumes. Any gap in points under-counts distance; the odometer cross-check exists to catch that.

## 5. API

Every route except the two login routes requires a valid token. Role checks run in middleware. Driver routes only ever read or change the signed-in driver's own trips.

| Who | Method and path | Purpose |
|---|---|---|
| anyone | `POST /auth/driver/login` | `{ cellNumber, password }` → token + user; drivers only |
| anyone | `POST /auth/owner/login` | `{ email, password }` → token + user; owner only |
| signed in | `GET /me` | current user |
| driver | `GET /trucks/available` | active trucks with no active trip |
| driver | `POST /trips` | start a trip `{ truckId, startOdometerKm }` |
| driver | `GET /trips/active` | the driver's active trip, or none |
| driver | `POST /trips/:id/points` | upload 1–500 points `{ points: [{ recordedAt, lat, lng, accuracyM }] }` |
| driver | `POST /trips/:id/end` | end own trip `{ endOdometerKm }` |
| driver | `GET /me/trips?from&to` | own trips; defaults to the last 30 days |
| owner | `GET /drivers`, `POST /drivers`, `PATCH /drivers/:id` | list, add, deactivate, reset password |
| owner | `GET /trucks`, `POST /trucks`, `PATCH /trucks/:id` | list, add, deactivate |
| owner | `GET /trips?from&to&driverId&truckId` | trip list with GPS km, odometer km, flag |
| owner | `GET /trips/:id` | one trip with its points (for the route map) |
| owner | `POST /trips/:id/end` | end a trip a driver forgot to end |
| owner | `GET /reports/summary?from&to` | totals per driver and per truck |
| owner | `GET /reports/export.csv?from&to&driverId&truckId` | trips for the filter as CSV (opens in Excel) |
| owner | `GET /live` | latest position of every active trip |

`POST /trips/:id/end` is one route with role-dependent rules: a driver may end only their own trip; the owner may end any active trip.

- **Login rate limit:** 10 attempts per 15 minutes per IP on each login route.
- **Passwords:** minimum 8 characters.
- **Token lifetimes:** driver 30 days, owner 12 hours. The dashboard keeps its token in `sessionStorage`.

## 6. Screens

### Driver app (5 screens)

1. **Sign in:** cell number, password.
2. **Start trip:** truck picker (available trucks only), start odometer. On first use, a one-time setup checklist covers location permission, notification permission and battery optimisation.
3. **Trip in progress:** running km, trip time, GPS status, points waiting to upload, **End trip** button.
4. **End trip:** end odometer, confirm.
5. **My trips:** recent trips with date, truck, GPS km, odometer km.

### Dashboard (6 screens)

1. **Sign in:** email, password.
2. **Trips:** quick periods (today, this week, this month, custom; default this week), driver and truck filters, a table (date, driver, truck, GPS km, odometer km, flag badge, "Possibly forgotten" badge), a totals row, an **Export CSV** button.
3. **Trip detail:** route on a Leaflet map with start and end markers, and the trip's figures.
4. **Live map:** markers for active trips with "last seen" times; refreshes every 15 s.
5. **Reports:** totals per driver and per truck for a chosen period.
6. **Manage:** drivers (add, deactivate, reset password) and trucks (add, deactivate).

## 7. Error handling

### Driver app

- **Location permission refused or GPS off:** Start trip is blocked with an explanation and a button that opens Settings. Android 13+ also needs notification permission for the foreground notification.
- **Battery savers** (Samsung, Huawei, Xiaomi and others kill background apps): the setup checklist guides the driver to turn off battery optimisation for the app.
- **No signal or sleeping server:** points wait in the queue; the in-progress screen shows the count.
- **401 during a trip:** points keep queuing; the driver is asked to sign in again, then uploads resume.
- **Trip ended by the owner while the driver was offline:** the next upload response says the trip is completed. The app stops tracking, still uploads any queued points timestamped before the trip's end (the API accepts them, see below), and tells the driver.

### API

- **One error shape everywhere:** `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`.
- **400** for invalid input (field-level messages from `zod`); **401** for no or invalid token; **403** for wrong role or someone else's trip; **404** for unknown IDs; **409** when starting a trip while the driver or truck already has an active one (the partial unique index violation is mapped to a friendly message); **500** with a generic message, with details logged on the server only.
- **Point checks:** points timestamped before the trip's start or in the future are dropped. Points for a completed trip are accepted if timestamped before its `ended_at`, and the distance is recomputed.

### Dashboard

- **Sleeping server:** a "Waking up the server…" state, then automatic retry.
- **401:** back to sign-in.
- **Empty states** instead of blank tables.
- **Trips active for more than 14 hours** show a "Possibly forgotten" badge so the owner can follow up and end them.

## 8. Testing

- **Unit, test-first (Vitest):** distance algorithm, point filtering, cell-number normalising, odometer flag rule.
- **API integration (Vitest + Supertest)** against a separate test database, covering every endpoint, and especially:
  - a driver cannot read or change another driver's trips;
  - a driver cannot call owner routes, and the owner cannot use the driver login (and vice versa);
  - starting a second active trip returns 409;
  - re-uploading the same batch does not change the distance;
  - late points for a completed trip recompute the distance.
- **Vue components (Vue Test Utils):** trip-in-progress screen states; trips filters and totals.
- **Device:** the Android emulator plays back a known GPX route (about 20 km) to check the total; then a real drive on Liam's phone with the screen locked.
- **Manual test cases** in `docs/test-cases/`, written by Liam in his QA style.
- **CI:** GitHub Actions runs lint and all automated tests on every pull request.

## 9. Seed data

A seed script creates one owner, four drivers and five trucks, plus about two months of completed trips. The trips use points generated along a few fixed Western Cape routes, with a handful of deliberate odometer mismatches so the flag has something to show.

## 10. Milestones

Every step is a branch and a pull request that Claude reviews.

| # | Milestone | Done when |
|---|---|---|
| M0 | Setup: repo on GitHub, npm workspaces, local Postgres, ESLint/Prettier, CI skeleton | CI is green on an empty project |
| M1 | `shared/` logic, test-first | distance, filters, cell numbers and odometer rule fully tested |
| M2 | **Background-GPS spike** (throwaway Capacitor app) | the phone keeps recording points with the screen locked for a 20+ minute drive; plugin choice confirmed or replaced |
| M3 | API core: migrations, both logins, drivers and trucks, seed script | the demo business can be signed into and managed through a REST client |
| M4 | Trips API: start, points, end, active, My trips, conflicts | a full trip can be simulated end to end through the API, with tests |
| M5 | Driver app: screens, queue, background GPS | a GPX route "driven" in the emulator, then a real drive, produces a correct trip |
| M6 | Dashboard: trips, filters, totals, reports, manage, CSV export | the owner sees and exports real trips |
| M7 | Maps: trip route map and live map | routes draw on the map; an active trip moves on the live map |
| M8 | Deploy and polish: Neon, Render, APK, README with demo GIF | the portfolio link works from anywhere |

M2 comes early because background GPS on a real phone is the riskiest part of the project. If it fails, the design changes before anything depends on it.

## 11. Stretch goals (after M8)

- Real `.xlsx` export (for example with `exceljs`).
- WebSocket or server-sent events for the live map instead of polling.
- PostGIS for distance and spatial queries.
- iOS build.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Background GPS is killed by the phone's battery saver | M2 spike on a real phone; setup checklist; odometer cross-check catches gaps |
| Community GPS plugin doesn't work on current Android/Capacitor | Found in M2; fall back to another plugin or write a small native foreground service |
| Free-tier limits change before M8 | Re-check Neon and Render at M8; the app runs fully on `localhost` regardless |
| Render cold start (~1 min) during a demo | Open the dashboard a minute before demoing; the driver app's queue absorbs it |
| OSM tile usage policy | Demo-level traffic only, with attribution; switch tile provider if usage grows |
