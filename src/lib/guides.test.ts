import { describe, it, expect } from 'vitest';
import { GUIDES, guideFlyover, guideForCourse, guideNotes, guidePages, readGuideMemory, rememberGuideHole } from './guides';

describe('course guides', () => {
  it('has all three courses, in playing order', () => {
    expect(GUIDES.map((g) => g.slug)).toEqual(['dundonald', 'krtb', 'ailsa']);
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

  it('gives Dundonald holes a flyover clip from the official video, where timed', () => {
    expect(guideFlyover('dundonald', 1)).toEqual({
      embed: 'https://www.youtube-nocookie.com/embed/s3jUc3RyotE?start=3&end=35&rel=0&playsinline=1',
      start: 3,
      end: 35,
    });
    expect(guideFlyover('dundonald', 2)).toMatchObject({ start: 36, end: 67 });
    expect(guideFlyover('dundonald', 3)).toBeNull();
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
