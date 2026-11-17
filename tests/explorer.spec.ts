/**
 * BCMS Web explorer.
 *
 * Read-only crawl of the app after login:
 *  - starts from the home page plus every list/create screen in config/targets.json
 *  - follows same-app <a href> links (one representative URL per URL pattern)
 *  - for each page saves: rendered HTML, ARIA snapshot, discovered controls with
 *    recommended locators, and (optionally) a screenshot
 *  - writes output/sitemap.json + output/sitemap.md (also added to the Actions job summary)
 *
 * It never submits forms and never clicks buttons, except: opening a row's
 * overflow menu on list screens and clicking an item named exactly "Edit"/"View"
 * to discover the EDIT form URL. Nothing is saved.
 */
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Target = {
  ticket: number; name: string; listScreen: string; formScreen: string;
  idParam: string; envId: string; expectedFields: string[];
};

type Control = {
  tag: string; role: string; name: string; type: string; id: string; placeholder: string;
  label: string; testId: string; href: string; required: boolean; disabled: boolean;
  visible: boolean; options: string[];
  locator?: { kind: string; expression: string; count: number; confidence: 'high' | 'medium' | 'low' };
};

type PageRecord = {
  slug: string; url: string; pattern: string; finalUrl: string; status: string; error?: string;
  depth: number; parent: string | null; via: string;
  flow?: { ticket: number; target: string; mode: 'list' | 'create' | 'edit' };
  title: string; headings: string[]; tables: { headers: string[]; rows: number }[];
  links: string[]; controls: Control[];
  files: { html?: string; aria?: string; controls?: string; screenshot?: string };
  loadMs: number;
};

const OUT = process.env.OUTPUT_DIR || 'output';
const MAX_PAGES = Number(process.env.MAX_PAGES || 80);
const SCREENSHOTS = (process.env.SCREENSHOTS || 'flows').toLowerCase(); // none | flows | all
const MAX_SCREENSHOTS = Number(process.env.MAX_SCREENSHOTS || 30);
const SETTLE_MS = Number(process.env.SLOW_SCREEN_MS || 1500);
const TIME_BUDGET_MS = Number(process.env.EXPLORER_BUDGET_MS || 20 * 60 * 1000);

const SKIP_PATH = /\/(Login|LoginSSO|Logout|LogOut|SignOut)(\/|\?|$)/i;
const SKIP_EXT = /\.(pdf|zip|xlsx?|csv|docx?|png|jpe?g|gif|svg|ico|js|css)(\?|$)/i;

const targets: Target[] = JSON.parse(fs.readFileSync('config/targets.json', 'utf8')).targets;

function slugify(s: string) {
  return s.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 120) || 'home';
}

/** Collapse record ids so we only visit one URL per screen/mode. */
function patternOf(u: URL) {
  const params = [...u.searchParams.keys()].sort()
    .map(k => `${k}=${/^0*$/.test(u.searchParams.get(k) || '') ? '0' : '*'}`);
  return u.pathname.replace(/\/+$/, '') + (params.length ? '?' + params.join('&') : '');
}

function flowFor(u: URL): PageRecord['flow'] {
  const screen = u.pathname.split('/').filter(Boolean).pop() || '';
  for (const t of targets) {
    if (screen.toLowerCase() === t.listScreen.toLowerCase()) return { ticket: t.ticket, target: t.name, mode: 'list' };
    if (screen.toLowerCase() === t.formScreen.toLowerCase()) {
      const id = u.searchParams.get(t.idParam);
      return { ticket: t.ticket, target: t.name, mode: id && !/^0*$/.test(id) ? 'edit' : 'create' };
    }
  }
  return undefined;
}

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  // OutSystems shows a feedback/loading overlay while screen aggregates run.
  await page.locator('.feedback-message-wrapper .spinner, .osui-loader, [data-loading="true"]')
    .first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

/** Pull page facts out of the DOM in one round trip. */
async function extract(page: Page) {
  return page.evaluate(() => {
    const vis = (e: Element) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(e as HTMLElement);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const txt = (e: Element | null) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
    const labelOf = (e: Element) => {
      const id = e.getAttribute('id');
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const wrap = e.closest('label');
      const lb = e.getAttribute('aria-labelledby');
      const byLb = lb ? lb.split(/\s+/).map(i => txt(document.getElementById(i))).join(' ') : '';
      return txt(byFor) || txt(wrap) || byLb;
    };
    const implicitRole = (e: Element) => {
      const t = e.tagName.toLowerCase(); const type = (e.getAttribute('type') || '').toLowerCase();
      if (t === 'a') return e.hasAttribute('href') ? 'link' : '';
      if (t === 'button') return 'button';
      if (t === 'select') return (e as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
      if (t === 'textarea') return 'textbox';
      if (t === 'input') {
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'search') return 'searchbox';
        if (['text', 'email', 'tel', 'url', 'password', ''].includes(type)) return 'textbox';
        if (type === 'number') return 'spinbutton';
      }
      return '';
    };
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=combobox], [role=checkbox], [role=switch], [contenteditable=true]';
    const controls = [...document.querySelectorAll(sel)].map(e => {
      const role = e.getAttribute('role') || implicitRole(e);
      const label = labelOf(e);
      const name = (e.getAttribute('aria-label') || label || (['input', 'textarea', 'select'].includes(e.tagName.toLowerCase()) ? '' : txt(e)) || e.getAttribute('title') || e.getAttribute('placeholder') || '').slice(0, 120);
      return {
        tag: e.tagName.toLowerCase(), role, name, label,
        type: e.getAttribute('type') || '', id: e.id || '',
        placeholder: e.getAttribute('placeholder') || '',
        testId: e.getAttribute('data-testid') || e.getAttribute('data-test-id') || '',
        href: e.getAttribute('href') || '',
        required: (e as HTMLInputElement).required || e.getAttribute('aria-required') === 'true',
        disabled: (e as HTMLInputElement).disabled || e.getAttribute('aria-disabled') === 'true',
        visible: vis(e),
        options: e.tagName === 'SELECT' ? [...(e as HTMLSelectElement).options].map(o => o.text.trim()).slice(0, 50) : [],
      };
    });
    const headings = [...document.querySelectorAll('h1,h2,h3,.heading1,.heading2,.heading3,[class*="title"]')].filter(e => !e.closest('nav,aside,header,.app-menu,.menu,[role=navigation]'))
      .filter(vis).map(txt).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && v.length < 120).slice(0, 25);
    const tables = [...document.querySelectorAll('table')].map(t => ({
      headers: [...t.querySelectorAll('thead th')].map(txt).filter(Boolean),
      rows: t.querySelectorAll('tbody tr').length,
    }));
    const links = [...document.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).href);
    return { title: document.title, headings, tables, links, controls };
  });
}

/** Pick the most robust Playwright locator for a control and check it is unique. */
async function recommend(page: Page, c: Control): Promise<Control['locator']> {
  const q = JSON.stringify;
  const generatedId = /^(b\d+-|l\d+_|\$|[a-z]?\d)|-\d+-|_\d+-/i.test(c.id);
  const candidates: { kind: string; expression: string; loc: () => ReturnType<Page['locator']>; conf: 'high' | 'medium' | 'low' }[] = [];
  if (c.testId) candidates.push({ kind: 'testId', expression: `page.getByTestId(${q(c.testId)})`, loc: () => page.getByTestId(c.testId), conf: 'high' });
  if (c.role && c.name) candidates.push({ kind: 'role', expression: `page.getByRole(${q(c.role)}, { name: ${q(c.name)}, exact: true })`, loc: () => page.getByRole(c.role as any, { name: c.name, exact: true }), conf: 'high' });
  if (c.label) candidates.push({ kind: 'label', expression: `page.getByLabel(${q(c.label)}, { exact: true })`, loc: () => page.getByLabel(c.label, { exact: true }), conf: 'high' });
  if (c.placeholder) candidates.push({ kind: 'placeholder', expression: `page.getByPlaceholder(${q(c.placeholder)}, { exact: true })`, loc: () => page.getByPlaceholder(c.placeholder, { exact: true }), conf: 'medium' });
  if (c.id) candidates.push({ kind: 'id', expression: `page.locator(${q('#' + c.id)})`, loc: () => page.locator(`[id=${q(c.id)}]`), conf: generatedId ? 'low' : 'medium' });
  let fallback: Control['locator'];
  for (const cand of candidates) {
    const count = await cand.loc().count().catch(() => -1);
    if (count === 1) return { kind: cand.kind, expression: cand.expression, count, confidence: cand.conf };
    if (!fallback && count > 1) fallback = { kind: cand.kind, expression: cand.expression + '.first()', count, confidence: 'low' };
  }
  return fallback;
}

async function tryDiscoverEdit(page: Page, t: Target): Promise<string | null> {
  const envId = process.env[t.envId];
  if (envId) return new URL(`${t.formScreen}?${t.idParam}=${envId}`, page.url()).href;
  const rows = page.locator('table tbody tr');
  const n = Math.min(await rows.count(), 10);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    // Direct link to the form in the row (e.g. name column).
    const direct = row.locator(`a[href*="${t.formScreen}"]`);
    if (await direct.count()) return new URL((await direct.first().getAttribute('href'))!, page.url()).href;
    const edit = row.locator('a, button, [role=menuitem]').filter({ hasText: /^\s*(Edit|View|Open)\s*$/i });
    if (!(await edit.count())) continue;
    const before = page.url();
    const trigger = row.locator('.osui-overflow-menu__trigger, [aria-haspopup="menu"]').first();
    if (await trigger.count()) await trigger.click().catch(() => {});
    await edit.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForURL(u => u.href !== before, { timeout: 10_000 }).catch(() => {});
    const after = page.url();
    if (after !== before) {
      await page.goBack().catch(() => {});
      return after;
    }
  }
  return null;
}

function writeFile(rel: string, data: string | Buffer) {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return rel.split(path.sep).join('/');
}

const usedBases = new Set<string>();
function fileBase(rec: { slug: string; flow?: PageRecord['flow'] }) {
  let b = rec.flow ? `flows/${rec.flow.ticket}-${slugify(rec.flow.target)}/${rec.flow.mode}` : `pages/${rec.slug}`;
  if (usedBases.has(b)) b = `${b}-${rec.slug}`;
  usedBases.add(b);
  return b;
}

test('explore BCMS Web and build a sitemap', async ({ page, baseURL }) => {
  const started = Date.now();
  const base = new URL(baseURL!);
  const appRoot = base.pathname.replace(/\/?$/, '/'); // e.g. /BCMS_Web/
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  type QItem = { url: string; depth: number; parent: string | null; via: string };
  const queue: QItem[] = [{ url: new URL('', base).href, depth: 0, parent: null, via: 'start' }];
  for (const t of targets) {
    queue.push({ url: new URL(t.listScreen, base).href, depth: 1, parent: null, via: `target:${t.name}:list` });
    queue.push({ url: new URL(`${t.formScreen}?${t.idParam}=0`, base).href, depth: 1, parent: null, via: `target:${t.name}:create` });
  }
  const seen = new Set<string>();
  const records: PageRecord[] = [];
  const edges: { from: string; to: string }[] = [];
  let shots = 0;

  const enqueue = (href: string, from: PageRecord) => {
    let u: URL;
    try { u = new URL(href); } catch { return; }
    if (u.origin !== base.origin || !u.pathname.startsWith(appRoot)) return;
    if (SKIP_PATH.test(u.pathname) || SKIP_EXT.test(u.pathname)) return;
    u.hash = '';
    edges.push({ from: from.pattern, to: patternOf(u) });
    if (!seen.has(patternOf(u)) && !queue.some(q => patternOf(new URL(q.url)) === patternOf(u)))
      queue.push({ url: u.href, depth: from.depth + 1, parent: from.pattern, via: 'link' });
  };

  while (queue.length && records.length < MAX_PAGES) {
    if (Date.now() - started > TIME_BUDGET_MS) { console.warn('Time budget reached, stopping crawl.'); break; }
    const item = queue.shift()!;
    const pattern = patternOf(new URL(item.url));
    if (seen.has(pattern)) continue;
    seen.add(pattern);

    const rec: PageRecord = {
      slug: slugify(pattern), url: item.url, pattern, finalUrl: '', status: 'OK',
      depth: item.depth, parent: item.parent, via: item.via, flow: flowFor(new URL(item.url)),
      title: '', headings: [], tables: [], links: [], controls: [], files: {}, loadMs: 0,
    };
    const t0 = Date.now();
    try {
      const resp = await page.goto(item.url);
      await settle(page);
      rec.loadMs = Date.now() - t0;
      rec.finalUrl = page.url();
      if (/\/Login(\?|$)/i.test(new URL(rec.finalUrl).pathname)) rec.status = 'REDIRECTED_TO_LOGIN';
      else if (resp && resp.status() >= 400) rec.status = `HTTP_${resp.status()}`;
      else if (/InvalidPermissions|NotRegistered|ErrorPage|Error/i.test(new URL(rec.finalUrl).pathname)) rec.status = 'ERROR_SCREEN';

      const facts = await extract(page);
      rec.title = facts.title; rec.headings = facts.headings; rec.tables = facts.tables;
      rec.links = [...new Set(facts.links)];
      rec.controls = facts.controls.filter(c => c.visible || c.tag === 'input' || c.tag === 'select');
      for (const c of rec.controls) c.locator = await recommend(page, c);

      const fb = fileBase(rec);
      rec.files.html = writeFile(`${fb}.html`, await page.content());
      rec.files.aria = writeFile(`${fb}.aria.yml`, await page.locator('body').ariaSnapshot().catch(e => `# ariaSnapshot failed: ${e}`));
      rec.files.controls = writeFile(`${fb}.controls.json`, JSON.stringify(rec.controls, null, 2));
      const wantShot = SCREENSHOTS === 'all' || (SCREENSHOTS === 'flows' && (rec.flow || rec.depth === 0));
      if (wantShot && shots < MAX_SCREENSHOTS) {
        rec.files.screenshot = writeFile(`${fb}.png`, await page.screenshot({ fullPage: true, animations: 'disabled' }));
        shots++;
      }

      if (rec.status === 'OK') for (const l of rec.links) enqueue(l, rec);

      // On list screens of known targets, try to find the EDIT form (read-only).
      if (rec.flow?.mode === 'list') {
        const t = targets.find(x => x.ticket === rec.flow!.ticket)!;
        const editUrl = await tryDiscoverEdit(page, t).catch(() => null);
        if (editUrl) {
          const eu = new URL(editUrl);
          if (!seen.has(patternOf(eu))) queue.unshift({ url: eu.href, depth: rec.depth + 1, parent: rec.pattern, via: `target:${t.name}:edit` });
        }
      }
    } catch (e: any) {
      rec.status = 'FAILED';
      rec.error = String(e?.message || e).split('\n')[0];
      rec.loadMs = Date.now() - t0;
    }
    console.log(`[${records.length + 1}/${MAX_PAGES}] ${rec.status.padEnd(8)} ${rec.loadMs}ms ${rec.pattern}`);
    records.push(rec);
  }

  // Edit flows that could not be reached.
  const missingEdit = targets.filter(t => !records.some(r => r.flow?.ticket === t.ticket && r.flow.mode === 'edit'))
    .map(t => ({ ticket: t.ticket, target: t.name, hint: `No Edit link found on ${t.listScreen}. Set ${t.envId} to an existing record id to capture the edit form.` }));

  const sitemap = {
    baseUrl: base.href, generatedAt: new Date().toISOString(), durationMs: Date.now() - started,
    limits: { MAX_PAGES, SCREENSHOTS, MAX_SCREENSHOTS, TIME_BUDGET_MS },
    unvisited: queue.map(q => q.url),
    pages: records.map(({ controls, links, ...r }) => ({ ...r, controlCount: controls.length, linkCount: links.length })),
    edges: [...new Map(edges.map(e => [`${e.from}->${e.to}`, e])).values()],
    flows: targets.map(t => ({
      ticket: t.ticket, target: t.name, expectedFields: t.expectedFields,
      list: records.find(r => r.flow?.ticket === t.ticket && r.flow.mode === 'list')?.files,
      create: records.find(r => r.flow?.ticket === t.ticket && r.flow.mode === 'create')?.files,
      edit: records.find(r => r.flow?.ticket === t.ticket && r.flow.mode === 'edit')?.files,
    })),
    missingEdit,
  };
  writeFile('sitemap.json', JSON.stringify(sitemap, null, 2));
  writeFile('selectors.json', JSON.stringify(Object.fromEntries(records.map(r => [r.pattern, {
    flow: r.flow, title: r.title,
    controls: r.controls.filter(c => c.locator).map(c => ({ role: c.role, name: c.name, type: c.type, required: c.required, ...c.locator })),
  }])), null, 2));

  const md = renderMarkdown(sitemap, records);
  writeFile('sitemap.md', md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');

  expect(records.filter(r => r.status === 'OK').length, 'at least one page explored').toBeGreaterThan(0);
  expect(records.filter(r => r.status === 'REDIRECTED_TO_LOGIN'), 'session should stay logged in').toHaveLength(0);
});

function renderMarkdown(sitemap: any, records: PageRecord[]) {
  const byParent = new Map<string | null, PageRecord[]>();
  for (const r of records) byParent.set(r.parent, [...(byParent.get(r.parent) || []), r]);
  const lines: string[] = [];
  const walk = (parent: string | null, indent: number) => {
    for (const r of byParent.get(parent) || []) {
      const label = r.title || r.headings[0] || r.pattern;
      const flow = r.flow ? ` _(#${r.flow.ticket} ${r.flow.target} – ${r.flow.mode})_` : '';
      const flag = r.status === 'OK' ? '' : ` **${r.status}**`;
      lines.push(`${'  '.repeat(indent)}- \`${r.pattern}\` — ${label}${flow}${flag}`);
      if (indent < 6) walk(r.pattern, indent + 1);
    }
  };
  walk(null, 0);

  const flowRows = sitemap.flows.map((f: any) =>
    `| ${f.ticket} | ${f.target} | ${f.list ? '✅' : '❌'} | ${f.create ? '✅' : '❌'} | ${f.edit ? '✅' : '❌'} |`);
  const pageRows = records.map(r =>
    `| \`${r.pattern}\` | ${r.status} | ${(r.title || r.headings[0] || '').replace(/\|/g, '/')} | ${r.controls.length} | ${r.controls.filter(c => c.locator?.confidence === 'high').length} | ${r.loadMs} |`);

  return [
    `# BCMS Web sitemap`,
    ``,
    `Generated ${sitemap.generatedAt} from ${sitemap.baseUrl} — ${records.length} pages in ${Math.round(sitemap.durationMs / 1000)}s` +
      (sitemap.unvisited.length ? `, ${sitemap.unvisited.length} queued URLs not visited (MAX_PAGES/time limit)` : ''),
    ``,
    `## Tree (by discovery)`,
    ...lines,
    ``,
    `## Master-data flows`,
    `| Ticket | Target | List | Create | Edit |`, `|---|---|---|---|---|`, ...flowRows,
    ...(sitemap.missingEdit.length ? ['', ...sitemap.missingEdit.map((m: any) => `- #${m.ticket} ${m.target}: ${m.hint}`)] : []),
    ``,
    `## Pages`,
    `| Pattern | Status | Title | Controls | High-confidence locators | Load ms |`, `|---|---|---|---|---|---|`, ...pageRows,
  ].join('\n');
}
