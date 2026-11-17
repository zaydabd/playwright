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
