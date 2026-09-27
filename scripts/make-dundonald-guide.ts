// Builds the Dundonald Links course guide from https://dundonaldlinks.com/golf/course-guide/
// Usage: node --import tsx scripts/make-dundonald-guide.ts
// Writes public/guides/dundonald/hole-NN.webp and src/lib/guides/dundonald.json (par, yards, tips, tees).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'https://dundonaldlinks.com/golf/course-guide/';
const imageUrl = (n: number) =>
  n === 1
    ? 'https://dundonaldlinks.com/app/uploads/2020/03/course-01-01.png'
    : `https://dundonaldlinks.com/app/uploads/2020/05/DUNDONALD_HOLES_${n}.jpg`;

// channel 'chrome': Playwright's bundled Chromium doesn't support macOS 13, so use the installed Chrome.
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });

type Hole = { hole: number; par: number; yards: number; tips: string; tees: { tee: string; yards: number; par: number }[] };
const holes: Hole[] = await page.evaluate(() => {
  const out: Record<number, Hole> = {};
  for (const h2 of document.querySelectorAll('h2')) {
    const m = h2.textContent!.trim().match(/^(\d+)(ST|ND|RD|TH) HOLE$/i);
    if (!m || out[Number(m[1])]) continue; // the page's carousel repeats holes
    const box = h2.closest('.course-hole') as HTMLElement | null;
    if (!box || !box.querySelector('table')) continue;
    // Par comes from the tee table: the heading omits it on hole 12 ("Par | 350 yards").
    const pl = box.textContent!.replace(/\s+/g, ' ').match(/Par\s*\d?\s*\|\s*(\d+)\s*yards/i)!;
    const h3 = box.querySelector('h3')!;
    let tips = '';
    for (let s = h3.nextElementSibling; s && s.tagName !== 'TABLE' && !s.querySelector('table'); s = s.nextElementSibling)
      tips += s.textContent!.trim() + ' ';
    const rows = [...box.querySelector('table')!.querySelectorAll('tr')]
      .map((tr) => [...tr.cells].map((c) => c.textContent!.trim()))
      .filter((r) => r[0] !== 'Tee');
    out[Number(m[1])] = {
      hole: Number(m[1]),
      par: Number(rows[0][2]),
      yards: Number(pl[1]),
      tips: tips.replace(/\s+/g, ' ').trim(),
      tees: rows.map(([tee, yards, par]) => ({ tee, yards: Number(yards), par: Number(par) })),
    };
  }
  return Object.values(out).sort((a, b) => a.hole - b.hole);
});
if (holes.length !== 18) throw new Error(`expected 18 holes, found ${holes.length}`);

mkdirSync('public/guides/dundonald', { recursive: true });
for (const { hole } of holes) {
  const res = await page.request.get(imageUrl(hole));
  if (!res.ok()) throw new Error(`hole ${hole} image: HTTP ${res.status()}`);
  const src = `data:${res.headers()['content-type']};base64,${(await res.body()).toString('base64')}`;
  const webp = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = Math.min(900, img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; // PNG transparency -> white
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/webp', 0.8), w: c.width, h: c.height };
  }, src);
  writeFileSync(`public/guides/dundonald/hole-${String(hole).padStart(2, '0')}.webp`, Buffer.from(webp.data.split(',')[1], 'base64'));
  process.stdout.write(`${hole}(${webp.w}x${webp.h}) `);
}
mkdirSync('src/lib/guides', { recursive: true });
writeFileSync('src/lib/guides/dundonald.json', JSON.stringify(holes, null, 2) + '\n');
await browser.close();
console.log('\nWrote public/guides/dundonald/hole-01..18.webp and src/lib/guides/dundonald.json');
