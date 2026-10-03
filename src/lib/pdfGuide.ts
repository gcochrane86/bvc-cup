// A course guide scanned as one PDF (e.g. Notes → Scan Documents → Save to Files): each page goes on a hole.

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

/** Open a PDF on the phone: how many pages, and each page as a JPEG at most `max` px on the long side. */
export async function openPdf(file: Blob): Promise<{ pages: number; render: (page: number, max: number) => Promise<Blob> }> {
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
  return {
    pages: doc.numPages,
    async render(page, max) {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: max / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvas, canvasContext: ctx, viewport }).promise;
      return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode page'))), 'image/jpeg', 0.82),
      );
    },
  };
}
