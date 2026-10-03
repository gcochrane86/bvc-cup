// A course guide scanned as one PDF (e.g. Notes → Scan Documents → Save to Files): each page goes on a hole.
import { GUIDE_QUALITY, guideScale } from './imageSize';

/**
 * The hole each page goes on (0 = skip), page 1 first. By default page N is hole N counting from the page
 * hole 1 is on; overrides (page number → hole, 0 to skip) change single pages.
 */
export function pageHoles(pages: number, holeOnePage: number, overrides: Record<number, number>): number[] {
  return Array.from({ length: pages }, (_, i) => {
    const page = i + 1;
    if (page in overrides) return overrides[page];
    const hole = page - holeOnePage + 1;
    return hole >= 1 && hole <= 18 ? hole : 0;
  });
}

/** Open a PDF on the phone: how many pages, a small picture of a page, and a page at full detail as a JPEG. */
export async function openPdf(file: Blob): Promise<{ pages: number; thumb: (page: number) => Promise<Blob>; render: (page: number) => Promise<Blob> }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  // Fonts, image decoders and colour profiles ship in public/pdfjs (fetched only when a PDF is opened).
  const files = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    standardFontDataUrl: files('standard_fonts'),
    wasmUrl: files('wasm'),
    iccUrl: files('iccs'),
  }).promise;

  /** The biggest picture on the page, in its own pixels (a scan is one picture per page), or null. */
  async function scanSize(p: Awaited<ReturnType<typeof doc.getPage>>): Promise<{ w: number; h: number } | null> {
    const ops = await p.getOperatorList();
    let best: { w: number; h: number } | null = null;
    for (const [i, fn] of ops.fnArray.entries()) {
      if (fn !== pdfjs.OPS.paintImageXObject) continue;
      const name = ops.argsArray[i][0] as string;
      const img = await new Promise<{ width: number; height: number } | null>((resolve) => {
        try {
          p.objs.get(name, (o: { width: number; height: number }) => resolve(o));
        } catch {
          resolve(null);
        }
      });
      if (img && (!best || img.width * img.height > best.w * best.h)) best = { w: img.width, h: img.height };
    }
    return best;
  }

  async function draw(page: number, scaleFor: (w: number, h: number) => Promise<number>, quality: number): Promise<Blob> {
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: await scaleFor(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, canvasContext: ctx, viewport }).promise;
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode page'))), 'image/jpeg', quality),
    );
  }

  return {
    pages: doc.numPages,
    thumb: (page) => draw(page, async (w, h) => 160 / Math.max(w, h), 0.7),
    // Full detail: the scan's own resolution (for a page with no scan, 1500 across), within guideScale's limits.
    render: (page) =>
      draw(
        page,
        async (w, h) => {
          const scan = await scanSize(await doc.getPage(page));
          const want = scan ? Math.max(scan.w / w, scan.h / h) : 1500 / Math.min(w, h);
          return want * guideScale(w * want, h * want);
        },
        GUIDE_QUALITY,
      ),
  };
}
