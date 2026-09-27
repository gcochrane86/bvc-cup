// Renders public/icon.svg to the PNG sizes iOS/Android need. Usage: npm run icons
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
// channel 'chrome': Playwright's bundled Chromium doesn't support macOS 13, so use the installed Chrome.
const browser = await chromium.launch({ channel: 'chrome' });
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icon-${size}.png` });
  await page.close();
}
await browser.close();
console.log('Wrote public/icon-180.png, icon-192.png, icon-512.png');
