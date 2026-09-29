// Hole-by-hole course guides. Turnberry: pages rendered from the course-guide PDFs by
// scripts/make-guides.ts. Dundonald: aerials + pro tips from their website (scripts/make-dundonald-guide.ts).
// Glashedy: hole and green pages rendered from the yardage book by scripts/make-guides.ts.
import dundonald from './guides/dundonald.json';

export interface Guide {
  slug: string;
  name: string;
  /** Button label on the Guide tab. */
  short: string;
  /** Matches the course name used in Admin → Courses. */
  match: RegExp;
  /** aerial: one photo + notes; turnberry: layout + approach pages; yardage: hole page + green page. */
  kind: 'aerial' | 'turnberry' | 'yardage';
  /** Where the pages come from (shown under the hole). */
  credit: string;
}

const TURNBERRY = 'From the Trump Turnberry course guide. Yardages are to the front of the green.';

export const GUIDES: Guide[] = [
  { slug: 'dundonald', name: 'Dundonald Links', short: 'Dundonald', match: /dundonald/i, kind: 'aerial', credit: 'From the Dundonald Links hole-by-hole guide.' },
  { slug: 'krtb', name: 'King Robert the Bruce', short: 'Robert the Bruce', match: /robert\s+the\s+bruce/i, kind: 'turnberry', credit: TURNBERRY },
  { slug: 'ailsa', name: 'The Championship Ailsa', short: 'Ailsa', match: /ailsa/i, kind: 'turnberry', credit: TURNBERRY },
  { slug: 'glashedy', name: 'Glashedy Links', short: 'Glashedy', match: /glashedy/i, kind: 'yardage', credit: 'From the Glashedy Links yardage book.' },
];

export function guideForCourse(courseName: string): Guide | null {
  return GUIDES.find((g) => g.match.test(courseName)) ?? null;
}

/** The guides for the active event's courses, in day order, each once; every guide if none match. */
export function eventGuides(rounds: { round_no: number; course_id: string }[], courses: { id: string; name: string }[]): Guide[] {
  const out: Guide[] = [];
  for (const r of [...rounds].sort((a, b) => a.round_no - b.round_no)) {
    const course = courses.find((c) => c.id === r.course_id);
    const g = course ? guideForCourse(course.name) : null;
    if (g && !out.includes(g)) out.push(g);
  }
  return out.length ? out : GUIDES;
}

/** The course the Courses tab opens on: the remembered one if this event has it, else the first. */
export function initialGuide(list: Guide[], remembered: string | null): Guide {
  return list.find((g) => g.slug === remembered) ?? list[0];
}

/** Images for a hole: Turnberry's layout (with yardages) and approach pages; Dundonald's aerial;
 *  Glashedy's hole map (with yardages) and green. */
export function guidePages(slug: string, hole: number): string[] {
  const n = String(hole).padStart(2, '0');
  if (slug === 'dundonald') return [`guides/dundonald/hole-${n}.webp`];
  if (slug === 'glashedy') return [`guides/glashedy/hole-${n}-layout.webp`, `guides/glashedy/hole-${n}-green.webp`];
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
