import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ca-lh-'));
process.env.DB_FILE = path.join(tmp, 'lh.sqlite');
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const { start } = await import('../server/index.js');
const server = await start(0);
const base = `http://localhost:${server.address().port}`;
const out = 'docs/evidencias/lighthouse';
await fs.mkdir(out, { recursive: true });

const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
const chrome = await launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox'] });

const summary = [];
for (const formFactor of ['mobile', 'desktop']) {
  const res = await lighthouse(base + '/', {
    port: chrome.port,
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    formFactor,
    screenEmulation: formFactor === 'desktop' ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false } : undefined
  });
  await fs.writeFile(`${out}/${formFactor}-inicio.json`, JSON.stringify(res.lhr, null, 2));
  await fs.writeFile(`${out}/${formFactor}-inicio.html`, res.report);
  const scores = Object.fromEntries(Object.entries(res.lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
  const contrastAudit = res.lhr.audits['color-contrast'];
  const swAudit = res.lhr.audits['service-worker'];
  const installAudit = res.lhr.audits['installable-manifest'];
  const failedA11y = Object.values(res.lhr.audits).filter((a) => a.score !== null && a.score < 1 && res.lhr.categories.accessibility.auditRefs.some((r) => r.id === a.id)).map((a) => `${a.id}:${a.score}`);
  summary.push({ formFactor, scores, contrast: contrastAudit?.score, sw: swAudit?.score, installable: installAudit?.score, failedA11y });
}

await chrome.kill();
server.close();
console.log(JSON.stringify(summary, null, 2));
