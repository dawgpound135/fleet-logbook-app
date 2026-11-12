# Fleet Logbook: M0 + M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This project overrides that:** Liam writes every line of code. Claude tutors: explains the why, lets Liam attempt each step, then reviews. Claude does not write the code, commit, or create files in the repo unless Liam asks.

**Goal:** A public GitHub repo with npm workspaces, lint, format and CI running on every pull request, and a fully tested `shared/` package holding the trip-distance, point-window, cell-number and odometer rules.

**Architecture:** One repo, npm workspaces. This plan creates only the root and `shared/`; `api/`, `dashboard/` and `driver-app/` join the workspace list in their own milestones. `shared/` is plain ES-module JavaScript with no dependencies, so both the Node API and the Vue driver app can import it as `@fleet/shared`.

**Tech Stack:** Node.js 26 (installed: v26.13.0; confirm it is the current LTS on nodejs.org), npm 11 workspaces, Vitest, ESLint (flat config) + Prettier, GitHub Actions, PostgreSQL (installed in Task 0.5, first used in M3).

**Spec:** `docs/superpowers/specs/2026-11-10-fleet-logbook-design.md`

**Where this plan sits.** The spec covers four separate packages, so the work is split into one plan per stage, each written when its stage is reached:

| Plan | Milestones | Why it waits |
|---|---|---|
| **1 (this one)** | M0 setup, M1 `shared/` logic | — |
| 2 | M2 background-GPS spike | Throwaway; its result decides M5's plugin and queue |
| 3 | M3 API core, M4 trips API | Needs `shared/` (this plan) and Postgres |
| 4 | M5 driver app | Needs M2's findings and the trips API |
| 5 | M6 dashboard, M7 maps | Needs the full API |
| 6 | M8 deploy and polish | Neon/Render limits are re-checked at that time (spec §2) |

## Global Constraints

- Every change after the first commit lands through a branch and a pull request that Claude reviews (spec §10).
- The repo is public: nothing secret is ever committed (`.env` files are git-ignored from the first commit).
- All packages are ES modules (`"type": "module"`); tests use Vitest.
- `shared/` has no runtime dependencies and no Node- or browser-only APIs (it runs in both).
- Earth radius: `6,371,008.8 m` (spec §4).
- Points with `accuracy_m > 50` are dropped; a jump implying more than `160 km/h` is a GPS glitch (spec §4).
- Distances are whole metres (integers) (spec §3).
- Odometer flag: `|gps_km − odo_km| > max(2 km, 5% of odo_km)`; both thresholds are constants in `shared/` (spec §3).
- Cell numbers are stored as E.164, e.g. `+27821234567` (spec §3).
- Points timestamped before the trip's start or in the future are dropped; points for a completed trip are kept only if timestamped before its `ended_at` (spec §7).

## Review Focus

These are inputs the spec implies but does not spell out. Each has a test in the task named.

1. **Cell numbers typed in other common ways** (`082-123-4567`, `(082) 123 4567`, `27821234567`, `0027821234567`, stray spaces): a driver expects these to sign in like `0821234567` does → Task 1.3.
2. **Phone clock a little ahead of the server:** the newest points look "in the future" by a few seconds. A driver expects their last minute of driving to count, not vanish → Task 1.5 (`CLOCK_SKEW_TOLERANCE_MS`, 60 s; a decision the spec leaves open, confirm it at review).
3. **Points out of order or sharing a timestamp:** the upload queue and retries can deliver either. Distance must equal the sorted result and never be `NaN` or `Infinity` → Task 1.2.
4. **`recordedAt` as an ISO string *or* a `Date`:** the driver app has strings, `pg` returns `Date` objects to the API. Both must give the same distance → Task 1.2.
5. **The caller's array is not reordered:** sorting in place would silently reorder the driver app's queue or the API's rows → Task 1.2.

---

## How each lesson runs

Every task below is one lesson. A lesson has three parts:

1. **Learn:** Claude explains the concepts listed, bridging from C# and Java. Ask questions until it makes sense.
2. **Build:** Liam does the steps. Tests come first (TDD): write the test, watch it fail, write the code, watch it pass. Test cases are given as tables of exact inputs and expected outputs; Liam turns them into Vitest code.
3. **Ship it (the PR workflow):** used by every task from 0.2 on, so it is written once here:
   - [ ] `git switch main`, `git pull`, `git switch -c <branch>` (branch name given in the task)
   - [ ] Commit in small steps as you go (`git add <files>`, `git commit -m "<type>: <what>"`; types: `feat`, `test`, `chore`, `ci`, `docs`)
   - [ ] `git push -u origin <branch>`, then `gh pr create` with the title given in the task and a body saying what changed and how you tested it
   - [ ] Ask Claude to review the PR; fix what comes up with new commits on the same branch and push again
   - [ ] Once CI is green (from Task 0.4) and the review is approved: `gh pr merge --squash --delete-branch`, then `git switch main` and `git pull`

---

## M0: Setup

### Task 0.1: Local repo, first commit, GitHub

**Learn:** what `git init` creates; why `main` is protected later; `.gitignore` vs `.gitattributes`; why Windows line endings (CRLF) break Prettier checks on Linux CI and how `eol=lf` prevents it.

**Files:**
- Create: `.gitignore`, `.gitattributes`, `README.md`
- Already present: `docs/superpowers/specs/…`, `docs/superpowers/plans/…` (this file)

- [ ] **Step 1:** `git init -b main` in `fleet-logbook-app/`.
- [ ] **Step 2:** Write `.gitignore` covering at least: `node_modules/`, `.env`, `.env.*` (but not `.env.example`), `coverage/`, `dist/`, `*.log`.
- [ ] **Step 3:** Write `.gitattributes` with `* text=auto eol=lf`.
- [ ] **Step 4:** Write a `README.md` stub: project name, one-paragraph description from spec §1, "Work in progress".
- [ ] **Step 5:** `git status` shows only the files you expect (no `CLAUDE.md`, no secrets). Commit: `chore: initial commit with spec and plan`.
- [ ] **Step 6:** `gh repo create fleet-logbook-app --public --source . --push`.
- [ ] **Verify:** the repo page on GitHub shows the README, the spec and this plan.

### Task 0.2: npm workspaces and the `shared` package (first pull request)

**Learn:** `package.json` vs a `.csproj`/`pom.xml`; npm workspaces vs a .NET solution with several projects; `"type": "module"` and `import`/`export` vs C# namespaces and Java packages; the `exports` field; `npm install` and `package-lock.json`; what Vitest is (JUnit/xUnit for JS); red → green.

**Branch:** `m0/workspaces` · **PR title:** `chore: set up npm workspaces and shared package`

**Files:**
- Create: `package.json` (root), `.nvmrc`, `shared/package.json`, `shared/src/index.js`, `shared/test/smoke.test.js`

**Interfaces:**
- Produces: the package name `@fleet/shared` with `"exports": "./src/index.js"`; root script `npm test` runs every workspace's `test` script.

- [ ] **Step 1:** Root `package.json`: `"name": "fleet-logbook-app"`, `"private": true`, `"type": "module"`, `"workspaces": ["shared"]`, `"engines": { "node": ">=26" }`, script `"test": "npm run test --workspaces --if-present"`.
- [ ] **Step 2:** `.nvmrc` containing `26`.
- [ ] **Step 3:** `shared/package.json`: `"name": "@fleet/shared"`, `"version": "0.1.0"`, `"private": true`, `"type": "module"`, `"exports": "./src/index.js"`, script `"test": "vitest run"`. Install Vitest into the workspace: `npm install -D vitest -w shared`.
- [ ] **Step 4:** `shared/src/index.js` exists and is empty for now (later tasks add exports).
- [ ] **Step 5: Write a failing smoke test** in `shared/test/smoke.test.js`: `expect(1 + 1).toBe(3)`.
- [ ] **Step 6:** Run `npm test` from the root. Expected: FAIL, `expected 2 to be 3`. (You have now seen what red looks like.)
- [ ] **Step 7:** Fix the expectation to `2`. Run `npm test`. Expected: PASS, 1 test.
- [ ] **Step 8:** Ship it (PR workflow above). `package-lock.json` is committed; `node_modules/` is not.

### Task 0.3: ESLint and Prettier

**Learn:** linting vs formatting (Roslyn analyzers vs `dotnet format`); ESLint flat config; why `eslint-config-prettier` exists (stops the two tools fighting); `--check` vs `--write`.

**Branch:** `m0/lint-format` · **PR title:** `chore: add ESLint and Prettier`

**Files:**
- Create: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`
- Modify: root `package.json` (dev dependencies, scripts)

- [ ] **Step 1:** At the root: `npm install -D eslint @eslint/js globals prettier eslint-config-prettier`.
- [ ] **Step 2:** `eslint.config.js`: `@eslint/js` recommended rules, Node and browser `globals` (shared runs in both), ignores `**/dist/**` and `**/coverage/**`, and `eslint-config-prettier` last.
- [ ] **Step 3:** `.prettierrc.json`: choose your style (quotes, semicolons, print width) and keep it. `.prettierignore`: `package-lock.json`, `coverage`, `dist`, `docs` (so Prettier never rewrites the spec and plans).
- [ ] **Step 4:** Root scripts: `"lint": "eslint ."`, `"format": "prettier --write ."`, `"format:check": "prettier --check ."`.
- [ ] **Step 5:** Break it on purpose: add an unused variable to `shared/src/index.js`. Run `npm run lint`. Expected: error `no-unused-vars`. Remove it.
- [ ] **Step 6:** `npm run format`, then `npm run lint` and `npm run format:check`. Expected: both exit with no errors.
- [ ] **Step 7:** Ship it.

### Task 0.4: GitHub Actions CI and branch protection

**Learn:** what CI is for (you know it from QA: the gate before release); workflow YAML (`on`, `jobs`, `steps`); `npm ci` vs `npm install`; required status checks.

**Branch:** `m0/ci` · **PR title:** `ci: run lint, format check and tests on every pull request`

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1:** `ci.yml` triggers on `pull_request` and on `push` to `main`. One job on `ubuntu-latest`: checkout, set up Node from `.nvmrc` with npm caching, `npm ci`, `npm run lint`, `npm run format:check`, `npm test`. Use the latest major version of `actions/checkout` and `actions/setup-node` shown in their READMEs.
- [ ] **Step 2:** Push the branch and open the PR. Expected: the CI check runs and goes green on the PR page.
- [ ] **Step 3:** Prove the gate works: push a commit that breaks the smoke test. Expected: CI red, PR shows a failing check. Revert that commit and push. Expected: green again.
- [ ] **Step 4:** Merge (PR workflow).
- [ ] **Step 5:** On GitHub, Settings → Branches (or Rules): protect `main`, require a pull request and require the CI check to pass.
- [ ] **Verify (M0 done):** a direct `git push` to `main` is rejected, and CI is green on `main`.

### Task 0.5: Local Postgres

Not used until M3, but the spec puts it in M0 so the environment is ready. No PR (nothing in the repo changes).

**Learn:** server vs database vs role; `psql`; why dev and test use separate databases (tests wipe their data).

- [ ] **Step 1:** Install PostgreSQL for Windows (EDB installer). Pick the major version Neon offers as its default (check neon.tech) so dev matches the demo. Add its `bin` folder to `PATH`.
- [ ] **Step 2:** In `psql` as `postgres`: create a login role `fleet` with a password you keep in your password manager, and two databases owned by it: `fleet_dev` and `fleet_test`.
- [ ] **Verify:** `psql -U fleet -d fleet_dev -c "select version();"` prints the version, and the same works for `fleet_test`.

---

## M1: `shared/` logic, test-first

All files in this milestone live in `shared/`. Tests import from `../src/<file>.js`. Each task also adds its exports to `shared/src/index.js`.

### Task 1.1: Constants and the haversine distance

**Learn:** named exports and `export const` (vs C# `public const`/Java `static final`); JSDoc comments as JavaScript's stand-in for type signatures; degrees vs radians; why floating-point results are tested with `toBeCloseTo`, not `toBe`.

**Branch:** `m1/haversine` · **PR title:** `feat(shared): add constants and haversine distance`

**Files:**
- Create: `shared/src/constants.js`, `shared/src/haversine.js`, `shared/test/haversine.test.js`
- Modify: `shared/src/index.js`
- Delete: `shared/test/smoke.test.js` (real tests replace it)

**Interfaces:**
- Produces (`constants.js`): `EARTH_RADIUS_M = 6371008.8`, `MAX_ACCURACY_M = 50`, `MAX_SPEED_KMH = 160`, `ODO_TOLERANCE_MIN_KM = 2`, `ODO_TOLERANCE_FRACTION = 0.05`, `CLOCK_SKEW_TOLERANCE_MS = 60_000`
- Produces (`haversine.js`): `haversineMetres(a: {lat: number, lng: number}, b: {lat: number, lng: number}): number`. Unrounded metres; uses `EARTH_RADIUS_M`.

- [ ] **Step 1: Write the failing tests** in `haversine.test.js`:

  | Test name | a | b | Expect |
  |---|---|---|---|
  | `is 0 for the same point` | (-33.9, 18.4) | (-33.9, 18.4) | `0` |
  | `one degree of latitude on a meridian` | (0, 0) | (1, 0) | close to `111195.08` (1 decimal) |
  | `Cape Town to Stellenbosch` | (-33.9249, 18.4241) | (-33.9321, 18.8602) | close to `40243.58` (1 decimal) |
  | `is the same in both directions` | (-33.9249, 18.4241) | (-33.9321, 18.8602) | `haversineMetres(a, b)` equals `haversineMetres(b, a)` |

- [ ] **Step 2:** `npm test`. Expected: FAIL, `haversineMetres` is not exported / not a function.
- [ ] **Step 3:** Write `constants.js` and `haversineMetres` (the formula is on Wikipedia's "Haversine formula" page; translate it yourself).
- [ ] **Step 4:** `npm test`. Expected: PASS, 4 tests.
- [ ] **Step 5:** Export both modules from `index.js` (`export * from './constants.js'` etc.). Run `npm run lint`.
- [ ] **Step 6:** Ship it.

### Task 1.2: Trip distance

**Learn:** array methods vs LINQ (`filter` ≈ `Where`, `sort` with a comparator ≈ `OrderBy`, but `sort` changes the array in place); copying with spread `[...points]`; `new Date(x).getTime()` for both strings and `Date`s; `it.each` for table-driven tests (≈ xUnit `[Theory]`/JUnit `@ParameterizedTest`).

**Branch:** `m1/trip-distance` · **PR title:** `feat(shared): add trip distance algorithm`

**Files:**
- Create: `shared/src/distance.js`, `shared/test/distance.test.js`
- Modify: `shared/src/index.js`

**Interfaces:**
- Consumes: `haversineMetres`, `MAX_ACCURACY_M`, `MAX_SPEED_KMH` (Task 1.1)
- Produces: `tripDistanceMetres(points: TripPoint[]): number` (whole metres), where `TripPoint = { recordedAt: string | Date, lat: number, lng: number, accuracyM: number }`. Document `TripPoint` with a JSDoc `@typedef` in `distance.js`.

**Algorithm (spec §4), plus the two decisions the spec leaves open (marked ★):**
1. Copy, then sort by `recordedAt` ascending (★ never mutate the input).
2. Drop points with `accuracyM > 50` (exactly 50 is kept).
3. The first remaining point is the anchor. For each later point: `dt` = seconds since the anchor. ★ If `dt <= 0`, drop the point (same timestamp, so the speed is undefined). If `distance / dt` is over 160 km/h, drop it. Otherwise add the distance and make it the anchor.
4. Return `Math.round(total)` (round once, at the end).

**Test fixture:** `line` = five points at `lat -33.9`, `lng` 18.400, 18.401, 18.402, 18.403, 18.404, `recordedAt` `2026-11-10T06:00:00.000Z` then every 10 s, `accuracyM 10`. Neighbouring points are 92.29 m apart. Build variants by changing one point.

- [ ] **Step 1: Write the failing tests:**

  | Test name | Input | Expect |
  |---|---|---|
  | `is 0 for no points` | `[]` | `0` |
  | `is 0 for one point` | `[line[0]]` | `0` |
  | `adds up a straight line` | `line` | `369` |
  | `sorts points by time first` | `line` reversed | `369` |
  | `does not reorder the caller's array` | `line` reversed; check array after the call | array still reversed (`[0].lng` is `18.404`) |
  | `accepts Date objects as recordedAt` | `line` with each `recordedAt` as `new Date(...)` | `369` |
  | `drops points less accurate than 50 m` | `line`, point 2 moved to `lat -33.899`, `accuracyM 51` | `369` |
  | `keeps a point exactly 50 m accurate` | `line`, point 2 moved to `lat -33.899`, `accuracyM 50` | `474` |
  | `drops a GPS glitch and keeps the anchor` | `line`, point 2 moved to `lng 18.45` (4.6 km in 10 s) | `369` |
  | `drops a second point with the same timestamp` | `line` plus `{ recordedAt: line[1].recordedAt, lat: -33.9, lng: 18.5, accuracyM: 10 }` | `369`, and the result is a finite number |
  | `keeps movement just under 160 km/h` | two points, `lng` 18.400 → 18.401, 2.2 s apart | `92` |
  | `drops movement just over 160 km/h` | same two points, 2.0 s apart | `0` |

- [ ] **Step 2:** `npm test`. Expected: FAIL, `tripDistanceMetres` not a function.
- [ ] **Step 3:** Implement `tripDistanceMetres` in `distance.js`.
- [ ] **Step 4:** `npm test`. Expected: PASS, all distance tests.
- [ ] **Step 5:** Export from `index.js`; lint.
- [ ] **Step 6:** Ship it.

**Known limitation to discuss at review (no code change):** if the *first* accurate point is itself a glitch, it stays the anchor until enough time passes for a real point to fall under 160 km/h, and that jump is counted. The spec accepts this; the odometer cross-check is the safety net.

### Task 1.3: Cell-number normalising

**Learn:** regular expressions in JS vs `System.Text.RegularExpressions`/`java.util.regex`; `string.replace` with a global regex; returning `null` for "no valid value" vs throwing (why `null` suits validation: the caller decides the error message).

**Branch:** `m1/cell-number` · **PR title:** `feat(shared): normalise South African cell numbers to E.164`

**Files:**
- Create: `shared/src/cellNumber.js`, `shared/test/cellNumber.test.js`
- Modify: `shared/src/index.js`

**Interfaces:**
- Produces: `normaliseCellNumber(input: unknown): string | null`. Returns `+27` followed by 9 digits, or `null`. M3's zod schemas and the driver sign-in screen use this.

**Rules:** ignore spaces, hyphens and brackets. Accept a leading `0`, `27`, `+27` or `0027`. What remains must be exactly 9 digits starting with 6, 7 or 8 (South African mobile numbers). Anything else, including non-strings, gives `null`.

- [ ] **Step 1: Write the failing tests** (use `it.each`):

  | Input | Expect |
  |---|---|
  | `'082 123 4567'` | `'+27821234567'` |
  | `'0821234567'` | `'+27821234567'` |
  | `'+27 82 123 4567'` | `'+27821234567'` |
  | `'+27821234567'` | `'+27821234567'` |
  | `'27821234567'` | `'+27821234567'` |
  | `'0027821234567'` | `'+27821234567'` |
  | `'082-123-4567'` | `'+27821234567'` |
  | `'(082) 123 4567'` | `'+27821234567'` |
  | `'  0821234567  '` | `'+27821234567'` |
  | `'0611234567'` | `'+27611234567'` |
  | `'021 123 4567'` (landline) | `null` |
  | `'082123456'` (too short) | `null` |
  | `'08212345678'` (too long) | `null` |
  | `'+1 555 123 4567'` | `null` |
  | `'082 123 4567x'` | `null` |
  | `''` | `null` |
  | `undefined`, `null`, `821234567` (a number) | `null` |

- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `normaliseCellNumber`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Export from `index.js`; lint.
- [ ] **Step 6:** Ship it.

### Task 1.4: Odometer cross-check

**Learn:** `Math.abs`/`Math.max`; `null` vs `undefined` and the `==` null check vs `===`; the `??` operator (same idea as C#'s); why the rule returns `null` ("can't tell yet") rather than `false` for an active trip.

**Branch:** `m1/odometer-flag` · **PR title:** `feat(shared): add odometer cross-check rule`

**Files:**
- Create: `shared/src/odometer.js`, `shared/test/odometer.test.js`
- Modify: `shared/src/index.js`

**Interfaces:**
- Consumes: `ODO_TOLERANCE_MIN_KM`, `ODO_TOLERANCE_FRACTION` (Task 1.1)
- Produces: `odometerFlag({ gpsDistanceM: number, startOdometerKm: number | null, endOdometerKm: number | null }): boolean | null`. `true` = flagged, `false` = within tolerance, `null` = either odometer reading missing. M4's trip list and M6's flag badge use it.

**Rule:** `odoKm = end − start`, `gpsKm = gpsDistanceM / 1000`, flagged when `|gpsKm − odoKm| > max(2, 0.05 × odoKm)`. Strictly greater: exactly at the tolerance is not flagged.

- [ ] **Step 1: Write the failing tests:**

  | Test name | gpsDistanceM | start → end | Expect |
  |---|---|---|---|
  | `within 5% on a long trip` | 104900 | 1000 → 1100 | `false` |
  | `exactly 5% is not flagged` | 105000 | 1000 → 1100 | `false` |
  | `over 5% on a long trip` | 105100 | 1000 → 1100 | `true` |
  | `GPS under-counts by more than 5%` | 94900 | 1000 → 1100 | `true` |
  | `2 km floor on a short trip` | 11900 | 500 → 510 | `false` |
  | `over the 2 km floor` | 12100 | 500 → 510 | `true` |
  | `zero-km trip, no GPS distance` | 0 | 500 → 500 | `false` |
  | `zero odometer km but 3 km of GPS` | 3000 | 500 → 500 | `true` |
  | `active trip has no end reading` | 5000 | 500 → `null` | `null` |
  | `missing start reading` | 5000 | `null` → 510 | `null` |

- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `odometerFlag`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Export from `index.js`; lint.
- [ ] **Step 6:** Ship it.

### Task 1.5: Point time-window filter

**Learn:** comparing times in JS (`getTime()` milliseconds, like `DateTime.Ticks`); passing an options object and destructuring it (vs C# named arguments); why `now` is a parameter instead of calling `Date.now()` inside (the same reason you inject `IClock`/`TimeProvider` in C#: testable).

**Branch:** `m1/point-window` · **PR title:** `feat(shared): add point time-window check`

**Files:**
- Create: `shared/src/points.js`, `shared/test/points.test.js`
- Modify: `shared/src/index.js`

**Interfaces:**
- Consumes: `CLOCK_SKEW_TOLERANCE_MS` (Task 1.1)
- Produces: `isPointInTripWindow(recordedAt: string | Date, trip: { startedAt: string | Date, endedAt: string | Date | null }, now: Date): boolean`. M4's `POST /trips/:id/points` uses it to drop points (spec §7).

**Rule:** keep the point when `recordedAt >= startedAt`, and `recordedAt <= now + 60 s` (★ clock-skew tolerance, Review Focus 2), and, if `endedAt` is set, `recordedAt < endedAt`.

**Fixture:** `startedAt '2026-11-10T06:00:00Z'`, `now new Date('2026-11-10T08:00:00Z')`.

- [ ] **Step 1: Write the failing tests:**

  | Test name | recordedAt | endedAt | Expect |
  |---|---|---|---|
  | `drops a point before the start` | `05:59:59Z` | `null` | `false` |
  | `keeps a point exactly at the start` | `06:00:00Z` | `null` | `true` |
  | `keeps a point during an active trip` | `07:00:00Z` | `null` | `true` |
  | `keeps a point up to 60 s ahead of the server clock` | `08:01:00Z` | `null` | `true` |
  | `drops a point more than 60 s in the future` | `08:01:01Z` | `null` | `false` |
  | `keeps a late point from before the trip ended` | `07:29:59Z` | `07:30:00Z` | `true` |
  | `drops a point at or after the end` | `07:30:00Z` | `07:30:00Z` | `false` |
  | `accepts Date objects` | `new Date('…07:00:00Z')` | `new Date('…07:30:00Z')` | `true` |

- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `isPointInTripWindow`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Export from `index.js`; lint.
- [ ] **Step 6:** Ship it.

### Task 1.6: Coverage check and closing M1

**Learn:** what line and branch coverage do and don't prove (you know this from QA: 100% coverage is not "no bugs"); reading a coverage report to find an untested branch.

**Branch:** `m1/coverage` · **PR title:** `test(shared): enforce full coverage`

**Files:**
- Create: `shared/vitest.config.js`
- Modify: `shared/package.json`

- [ ] **Step 1:** `npm install -D @vitest/coverage-v8 -w shared`. In `shared/vitest.config.js`, enable coverage for `src/**` with thresholds of 100 for lines, branches, functions and statements.
- [ ] **Step 2:** Change the `shared` test script to `vitest run --coverage`. Run `npm test`.
- [ ] **Step 3:** If any threshold fails, open `shared/coverage/index.html`, find the untested branch, and add a test for it in the matching test file (not a code change to dodge the check).
- [ ] **Step 4:** `npm test`. Expected: PASS with 100% on all four measures.
- [ ] **Step 5:** Ship it.
- [ ] **Verify (M1 done):** CI is green on `main`, and `import { tripDistanceMetres, normaliseCellNumber, odometerFlag, isPointInTripWindow } from '@fleet/shared'` resolves (the M3 API will be the first real consumer).