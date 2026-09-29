// Renders a course-guide PDF into per-hole images for the Course guide tab.
// Usage: node --import tsx scripts/make-guides.ts <guide.pdf> <slug> [turnberry|yardage]
// turnberry (krtb | ailsa): hole N has a layout page (6 + 2N) and an approach page (7 + 2N); output goes
//   to public/guides/<slug>/hole-NN-layout.webp and hole-NN-approach.webp.
// yardage (glashedy): hole N is one tall page (N + 2) — green drawing on top, a blank notes grid, then the
//   hole map and tee photo. The notes grid is cropped out: hole-NN-green.webp and hole-NN-layout.webp.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [pdfPath, slug, modeArg = 'turnberry'] = process.argv.slice(2);
if (!pdfPath || !slug || !['turnberry', 'yardage'].includes(modeArg)) {
  console.error('Usage: node --import tsx scripts/make-guides.ts <guide.pdf> <slug> [turnberry|yardage]');
  process.exit(1);
}
const mode = modeArg as 'turnberry' | 'yardage';
// Yardage-book bands, as fractions of the page height (the same on every Glashedy hole page).
const GREEN_END = 0.222;
const LAYOUT_START = 0.356;
const WIDTH = 900; // px; sharp on phones, ~60–120 KB per page as WebP

// channel 'chrome': Playwright's bundled Chromium doesn't support macOS 13, so use the installed Chrome.
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.route('http://guide.local/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' });
  const file = path === '/doc.pdf' ? pdfPath : `node_modules/pdfjs-dist${path}`;
  const type = path.endsWith('.pdf') ? 'application/pdf' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.mjs') || path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
  return route.fulfill({ body: readFileSync(file), contentType: type });
});
// Any content PDF.js can't draw (e.g. an image codec it couldn't load) is only a console warning
// and the rest of the page is silently skipped — treat it as fatal so nothing goes missing.
const problems: string[] = [];
page.on('console', (m) => {
  // "…falling back to JS" is only a slower path that still draws everything (Glashedy's shading).
  if (/ignoring errors|failed|Error/i.test(m.text()) && !/falling back to JS/i.test(m.text())) problems.push(m.text());
});
await page.goto('http://guide.local/');

const outDir = `public/guides/${slug}`;
mkdirSync(outDir, { recursive: true });
for (let hole = 1; hole <= 18; hole++) {
  const images = await page.evaluate(
    async ({ pages, width, bands }) => {
      const lib = 'http://guide.local/build/pdf.min.mjs'; // loaded in the browser page, not by Node
      const pdfjs = (await import(lib)) as typeof import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'http://guide.local/build/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({
        url: 'http://guide.local/doc.pdf',
        wasmUrl: 'http://guide.local/wasm/', // JBIG2/JPX image decoders (the Turnberry guides use JBIG2)
        standardFontDataUrl: 'http://guide.local/standard_fonts/',
        cMapUrl: 'http://guide.local/cmaps/',
        cMapPacked: true,
        iccUrl: 'http://guide.local/iccs/',
      });
      const doc = await task.promise;
      const out: string[] = [];
      for (const n of pages) {
        const p = await doc.getPage(n);
        const vp = p.getViewport({ scale: width / p.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        if (!bands) {
          out.push(canvas.toDataURL('image/webp', 0.8));
          continue;
        }
        for (const [from, to] of bands) {
          const y0 = Math.round(canvas.height * from);
          const h = Math.round(canvas.height * to) - y0;
          const band = document.createElement('canvas');
          band.width = canvas.width;
          band.height = h;
          band.getContext('2d')!.drawImage(canvas, 0, y0, canvas.width, h, 0, 0, canvas.width, h);
          out.push(band.toDataURL('image/webp', 0.8));
        }
      }
      await task.destroy(); // free its WebAssembly memory: the PDF is opened again for every hole
      return out;
    },
    mode === 'yardage'
      ? { pages: [hole + 2], width: WIDTH, bands: [[0, GREEN_END], [LAYOUT_START, 1]] as [number, number][] }
      : { pages: [6 + 2 * hole, 7 + 2 * hole], width: WIDTH, bands: null },
  );
  const n = String(hole).padStart(2, '0');
  (mode === 'yardage' ? ['green', 'layout'] : ['layout', 'approach']).forEach((kind, i) =>
    writeFileSync(`${outDir}/hole-${n}-${kind}.webp`, Buffer.from(images[i].split(',')[1], 'base64')),
  );
  if (problems.length) throw new Error(`hole ${hole} did not render cleanly:\n${problems.join('\n')}`);
  process.stdout.write(`${hole} `);
}
await browser.close();
console.log(`\nWrote ${outDir}/hole-01..18-${mode === 'yardage' ? '{green,layout}' : '{layout,approach}'}.webp`);
