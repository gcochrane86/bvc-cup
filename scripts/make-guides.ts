// Renders a Turnberry course-guide PDF into per-hole images for the Course guide tab.
// Usage: node --import tsx scripts/make-guides.ts <guide.pdf> <slug>     (slug: krtb | ailsa)
// Each hole N has a layout page (6 + 2N) and an approach page (7 + 2N); output goes to
// public/guides/<slug>/hole-NN-layout.webp and hole-NN-approach.webp.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [pdfPath, slug] = process.argv.slice(2);
if (!pdfPath || !slug) {
  console.error('Usage: node --import tsx scripts/make-guides.ts <guide.pdf> <slug>');
  process.exit(1);
}
const WIDTH = 900; // px; sharp on phones, ~60–120 KB per page as WebP

// channel 'chrome': Playwright's bundled Chromium doesn't support macOS 13, so use the installed Chrome.
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.route('http://guide.local/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' });
  const file = path === '/doc.pdf' ? pdfPath : `node_modules/pdfjs-dist/build${path}`;
  return route.fulfill({ body: readFileSync(file), contentType: path.endsWith('.pdf') ? 'application/pdf' : 'text/javascript' });
});
await page.goto('http://guide.local/');

const outDir = `public/guides/${slug}`;
mkdirSync(outDir, { recursive: true });
for (let hole = 1; hole <= 18; hole++) {
  const images = await page.evaluate(
    async ({ pages, width }) => {
      const lib = 'http://guide.local/pdf.min.mjs'; // loaded in the browser page, not by Node
      const pdfjs = (await import(lib)) as typeof import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'http://guide.local/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ url: 'http://guide.local/doc.pdf' }).promise;
      const out: string[] = [];
      for (const n of pages) {
        const p = await doc.getPage(n);
        const vp = p.getViewport({ scale: width / p.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        out.push(canvas.toDataURL('image/webp', 0.8));
      }
      return out;
    },
    { pages: [6 + 2 * hole, 7 + 2 * hole], width: WIDTH },
  );
  const n = String(hole).padStart(2, '0');
  ['layout', 'approach'].forEach((kind, i) =>
    writeFileSync(`${outDir}/hole-${n}-${kind}.webp`, Buffer.from(images[i].split(',')[1], 'base64')),
  );
  process.stdout.write(`${hole} `);
}
await browser.close();
console.log(`\nWrote ${outDir}/hole-01..18-{layout,approach}.webp`);
