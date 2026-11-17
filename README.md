# BCMS Web – Playwright

## 1. Explorer (`tests/explorer.spec.ts`)

Logs in, crawls BCMS Web read-only and builds a sitemap.

- Starts at the home page plus every list/create screen in `config/targets.json`.
- Follows in-app `<a href>` links, one URL per pattern (record ids collapsed).
- Tries to find each target's **edit** form from the list row menu (clicks only items named Edit/View/Open). If none exists, set the `*_ID` env var (e.g. `DIVISION_ID`).
- Never submits forms.

Output (`output/`, uploaded as the `explorer-output` artifact):

| File | Content |
|---|---|
| `sitemap.md` / `sitemap.json` | Page tree, flows table, link edges (also shown in the job summary) |
| `selectors.json` | Recommended locator per control, per page |
| `flows/<ticket>-<target>/{list,create,edit}.html` | Rendered HTML per flow |
| `flows/.../*.aria.yml` | ARIA snapshot (role/name tree) |
| `flows/.../*.controls.json` | All controls with locator + uniqueness count |
| `pages/*` | Same for non-target pages |
| `*.png` | Screenshots (flows only by default, capped at 30) |

### Run in GitHub Actions
Secrets: `AVE_USERNAME`, `AVE_PASSWORD`. Actions → **Explorer** → Run workflow (inputs: `max_pages`, `screenshots`).

### Run locally
```bash
npm ci
```
```bash
npx playwright install chromium
```
```bash
cp .env.example .env   # fill in TEST_USER / TEST_PASSWORD
```
```bash
npm run explore
```

### GitHub Actions limits
- Runs headless Chromium on Ubuntu (no Edge, no SSO / MFA logins – username + password only).
- Only links are followed; screens reached only by button clicks (JS navigation) are not discovered.
- 40 min job timeout, 20 min crawl budget, `MAX_PAGES` cap.
- Artifacts kept 7 days. **This repo is public: artifacts can be downloaded by any signed-in GitHub user**, and the HTML contains real dev data.

## 2. Master data tests (`tests/masterdata/`)

Front-end tests for the Master Data Management screens (FSD Annex D).

| Screen | Tag |
|---|---|
| Task type (#100) | `@task-type` |
| Division (#102) | `@division` |
| Department (#103) | `@department` |
| Section (#104) | `@section` |
| Group (#105) | `@group` |
| Store area team (#106) | `@store-area-team` |
| Cost center (#107) | `@cost-center` |
| Insurance (#110) | `@insurer` |
| Case reason (#113) | `@case-reason` |

The same 7 tests run on every screen (`targets.ts` holds the per-screen fields):

| Test | Covers |
|---|---|
| TC01 create | Create button, form, success message, listing columns, search, Active status, "-" in Last modified, only *Deactivate* in the Action menu |
| TC02 form validation | Unsaved-changes pop-up (Cancel / Leave), "This field is required." per mandatory field, uniqueness of each unique field |
| TC03 lifecycle | Deactivate pop-up (Cancel, Close X, Proceed), Inactive menu (Edit/Activate/Delete), edit form pre-filled + Save and update, Last modified set, Activate, Delete pop-up (Cancel, Close X, Delete) |
| TC04 bulk actions | Bulk buttons disabled by default, enabled only for eligible selections, mixed selection, bulk deactivate / activate / delete |
| TC07 listing | Column sort: 1st click ascending, 2nd click descending; search kept after sort; "1 to N of N records" counter |
| TC09 concurrency | A second tab acts as another user. Stale list: status change refused ("This record has been updated. Please refresh…"). Stale edit: save refused, other user's values kept. Edit of a deleted record: "This record no longer exists." pop-up, OK returns to the list |
| TC10 column pop-up | "+" icon lists every column (all ticked), search filters, untick, Reset, Apply closes |

Plus, run once:
- TC05 side-menu navigation.
- TC06 system-created task types locked.
- TC08 pagination (Division, tag `@pagination`): 11 records → 10 on page 1, 1 on page 2. The pager is the same component on every list.

Not covered yet:
- Filter (removed from the app).
- In-use delete protection (no screen can put a record in use yet).
- Case reason uniqueness (not in the FSD; the app accepts duplicate reasons).
- Reminder / escalation and Organisation hierarchy (not built).

**Isolation:** every test creates its own records with a unique key `PWT#########`, and the fixture deactivates and deletes them after the test, pass or fail. The `masterdata-cleanup` teardown then removes any `PWT` leftovers.

**FSD gaps** (`fsd-gaps.spec.ts`): GAP01 priority options, GAP02 Activate "Proceed", GAP03 Save disabled until a change, GAP04 Department column names, GAP05 Save changes confirmation pop-up, GAP06 column pop-up Apply hides the column (keeping it after a reload is not required). These are tests that assert the FSD where the app differs today. They are marked `test.fail()`, so they pass while the gap exists. When the app is fixed they go red. Then remove the `test.fail()` line.

### Run
GitHub: Actions → **Master data tests** → Run workflow (`grep` e.g. `@division`, `workers`).

Local:
```bash
npm run test:masterdata
```
```bash
npx playwright test --project=masterdata --grep @division
```
