import { describe, it, expect } from 'vitest';
import { GUIDES, eventGuides, guideFlyover, guideForCourse, guideNotes, guidePages, initialGuide, readGuideMemory, rememberGuideHole } from './guides';

describe('course guides', () => {
  it('has every guide: the three trip courses in playing order, then Glashedy', () => {
    expect(GUIDES.map((g) => g.slug)).toEqual(['dundonald', 'krtb', 'ailsa', 'glashedy']);
  });

  it('matches every Glashedy tee to the Glashedy guide', () => {
    for (const tee of ['Black', 'Gold', 'White']) expect(guideForCourse(`Glashedy Links (${tee})`)?.slug).toBe('glashedy');
  });

  it('gives Glashedy its hole page then its green page', () => {
    expect(guidePages('glashedy', 7)).toEqual(['guides/glashedy/hole-07-layout.webp', 'guides/glashedy/hole-07-green.webp']);
    expect(guideNotes('glashedy', 7)).toBeNull();
    expect(guideFlyover('glashedy', 7)).toBeNull();
  });

  it('matches a course name to its guide', () => {
    expect(guideForCourse('King Robert the Bruce')?.slug).toBe('krtb');
    expect(guideForCourse('The Championship Ailsa')?.slug).toBe('ailsa');
    expect(guideForCourse('Dundonald Links')?.slug).toBe('dundonald');
    expect(guideForCourse('Seed Links')).toBeNull();
  });

  it('gives each hole its layout and approach pages', () => {
    expect(guidePages('krtb', 3)).toEqual(['guides/krtb/hole-03-layout.webp', 'guides/krtb/hole-03-approach.webp']);
  });

  it('gives Dundonald one aerial per hole plus pro tips and tee yardages', () => {
    expect(guidePages('dundonald', 12)).toEqual(['guides/dundonald/hole-12.webp']);
    const n = guideNotes('dundonald', 12)!;
    expect(n).toMatchObject({ par: 4, yards: 350 });
    expect(n.tips).toMatch(/shortest Par 4/);
    expect(n.tees.map((t) => t.tee)).toEqual(['Championship', 'Medal', 'Middle', 'Front']);
    expect(guideNotes('krtb', 3)).toBeNull();
  });

  it('gives every Dundonald hole its flyover section from the official video', () => {
    expect(guideFlyover('dundonald', 1)).toEqual({
      embed: 'https://www.youtube-nocookie.com/embed/s3jUc3RyotE?start=3&end=37&rel=0&playsinline=1',
      start: 3,
      end: 37,
    });
    expect(guideFlyover('dundonald', 2)).toMatchObject({ start: 37, end: 69 }); // 0:37 – 1:09
    expect(guideFlyover('dundonald', 10)).toMatchObject({ start: 312, end: 351 }); // 5:12 – 5:51
    expect(guideFlyover('dundonald', 18)).toMatchObject({ start: 597, end: 637 }); // 9:57 – end (10:37)
    for (let h = 1; h <= 17; h++) expect(guideFlyover('dundonald', h)!.end).toBe(guideFlyover('dundonald', h + 1)!.start);
    expect(guideFlyover('krtb', 1)).toBeNull();
  });

  it('remembers the hole per course, and the course last viewed', () => {
    let mem = readGuideMemory(null);
    expect(mem).toEqual({ course: null, holes: {} });
    mem = rememberGuideHole(mem, 'krtb', 3);
    mem = rememberGuideHole(mem, 'ailsa', 12);
    mem = rememberGuideHole(mem, 'krtb', 5);
    const back = readGuideMemory(JSON.stringify(mem));
    expect(back).toEqual({ course: 'krtb', holes: { krtb: 5, ailsa: 12 } });
  });

  it('ignores corrupt or out-of-range memory', () => {
    expect(readGuideMemory('not json')).toEqual({ course: null, holes: {} });
    expect(readGuideMemory(JSON.stringify({ course: 'nope', holes: { krtb: 40, ailsa: 2 } }))).toEqual({ course: null, holes: { ailsa: 2 } });
  });
});

describe('eventGuides', () => {
  const courses = [
    { id: 'd', name: 'Dundonald Links' },
    { id: 'k', name: 'King Robert the Bruce' },
    { id: 'a', name: 'The Championship Ailsa' },
    { id: 'gg', name: 'Glashedy Links (Gold)' },
    { id: 'gw', name: 'Glashedy Links (White)' },
    { id: 's', name: 'Seed Links' },
  ];
  const r = (round_no: number, course_id: string) => ({ round_no, course_id });

  it('lists only the courses the event plays, in day order (BvC: unchanged)', () => {
    expect(eventGuides([r(2, 'k'), r(1, 'd'), r(3, 'a')], courses).map((g) => g.short)).toEqual(['Dundonald', 'Robert the Bruce', 'Ailsa']);
  });

  it('shows just Glashedy for Ballyliffen, whichever tees the day uses', () => {
    expect(eventGuides([r(1, 'gg')], courses).map((g) => g.slug)).toEqual(['glashedy']);
    expect(eventGuides([r(1, 'gw')], courses).map((g) => g.slug)).toEqual(['glashedy']);
  });

  it('lists a guide once when two days use it', () => {
    expect(eventGuides([r(1, 'gg'), r(2, 'gw')], courses).map((g) => g.slug)).toEqual(['glashedy']);
  });

  it('falls back to every guide when the event has none (e.g. mid-setup)', () => {
    expect(eventGuides([r(1, 's')], courses)).toEqual(GUIDES);
    expect(eventGuides([], courses)).toEqual(GUIDES);
  });

  it('opens the remembered course only if the event has it', () => {
    const bvc = eventGuides([r(1, 'd'), r(2, 'k'), r(3, 'a')], courses);
    expect(initialGuide(bvc, 'ailsa').slug).toBe('ailsa');
    expect(initialGuide(eventGuides([r(1, 'gg')], courses), 'ailsa').slug).toBe('glashedy');
    expect(initialGuide(bvc, null).slug).toBe('dundonald');
  });
});
