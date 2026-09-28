// Hole-by-hole course guides. Turnberry: pages rendered from the course-guide PDFs by
// scripts/make-guides.ts. Dundonald: aerials + pro tips from their website (scripts/make-dundonald-guide.ts).
import dundonald from './guides/dundonald.json';

export interface Guide {
  slug: string;
  name: string;
  /** Button label on the Guide tab. */
  short: string;
  /** Matches the course name used in Admin → Courses. */
  match: RegExp;
}

export const GUIDES: Guide[] = [
  { slug: 'dundonald', name: 'Dundonald Links', short: 'Dundonald', match: /dundonald/i },
  { slug: 'krtb', name: 'King Robert the Bruce', short: 'Robert the Bruce', match: /robert\s+the\s+bruce/i },
  { slug: 'ailsa', name: 'The Championship Ailsa', short: 'Ailsa', match: /ailsa/i },
];

export function guideForCourse(courseName: string): Guide | null {
  return GUIDES.find((g) => g.match.test(courseName)) ?? null;
}

/** Images for a hole: Turnberry's layout (with yardages) and approach pages; Dundonald's aerial. */
export function guidePages(slug: string, hole: number): string[] {
  const n = String(hole).padStart(2, '0');
  if (slug === 'dundonald') return [`guides/dundonald/hole-${n}.webp`];
  return [`guides/${slug}/hole-${n}-layout.webp`, `guides/${slug}/hole-${n}-approach.webp`];
}

export interface GuideNotes {
  par: number;
  yards: number;
  tips: string;
  tees: { tee: string; yards: number; par: number }[];
}

/** Written notes for a hole (Dundonald only — the Turnberry pages carry their own text). */
export function guideNotes(slug: string, hole: number): GuideNotes | null {
  if (slug !== 'dundonald') return null;
  return (dundonald as (GuideNotes & { hole: number })[]).find((h) => h.hole === hole) ?? null;
}

/** What this phone last looked at: the course, and the hole per course. */
export interface GuideMemory {
  course: string | null;
  holes: Record<string, number>;
}

export function readGuideMemory(raw: string | null): GuideMemory {
  const empty: GuideMemory = { course: null, holes: {} };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<GuideMemory>;
    const slugs = GUIDES.map((g) => g.slug);
    const holes = Object.fromEntries(
      Object.entries(v.holes ?? {}).filter(([s, h]) => slugs.includes(s) && Number.isInteger(h) && h >= 1 && h <= 18),
    );
    return { course: typeof v.course === 'string' && slugs.includes(v.course) ? v.course : null, holes };
  } catch {
    return empty;
  }
}

export function rememberGuideHole(mem: GuideMemory, slug: string, hole: number): GuideMemory {
  return { course: slug, holes: { ...mem.holes, [slug]: hole } };
}

/** Official "Dundonald Links Fly Over 1 to 18" video (Dundonald Links' YouTube channel), embedded per hole. */
const DUNDONALD_VIDEO = 's3jUc3RyotE';
/** Where each hole's flyover starts (seconds, at the fade to black); each ends where the next begins. */
const DUNDONALD_STARTS = [
  3, 37, 69, 112, 138, 182, 204, 234, 276, // holes 1–9  (0:03 … 4:36)
  312, 351, 371, 401, 433, 481, 511, 550, 597, // holes 10–18 (5:12 … 9:57)
];
const DUNDONALD_VIDEO_END = 637; // 10:37

export interface Flyover {
  embed: string;
  start: number;
  end: number;
}

/** The hole's flyover as an embeddable YouTube player that plays just that section. */
export function guideFlyover(slug: string, hole: number): Flyover | null {
  if (slug !== 'dundonald' || hole < 1 || hole > 18) return null;
  const start = DUNDONALD_STARTS[hole - 1];
  const end = DUNDONALD_STARTS[hole] ?? DUNDONALD_VIDEO_END;
  return { embed: `https://www.youtube-nocookie.com/embed/${DUNDONALD_VIDEO}?start=${start}&end=${end}&rel=0&playsinline=1`, start, end };
}
