import { describe, it, expect } from 'vitest';
import { courseGroups, courseLabel, teesOf } from './courses';
import type { CourseRow } from './data/types';

const c = (id: string, name: string, tee: string | null, course_rating: number | null = null): CourseRow => ({ id, name, tee, slope_rating: null, course_rating });
const all = [c('w', 'Glashedy Links', 'White', 71.3), c('d', 'Dundonald Links', null), c('b', 'Glashedy Links', 'Black', 77.4), c('g', 'Glashedy Links', 'Gold', 73.6)];

describe('courses and tees', () => {
  it('labels a tee, or just the course when it has one unnamed tee', () => {
    expect(courseLabel(c('g', 'Glashedy Links', 'Gold'))).toBe('Glashedy Links · Gold tees');
    expect(courseLabel(c('d', 'Dundonald Links', null))).toBe('Dundonald Links');
  });
  it('groups tees under their course, longest (highest rated) first', () => {
    expect(courseGroups(all).map((g) => [g.name, g.tees.map((t) => t.id)])).toEqual([
      ['Dundonald Links', ['d']],
      ['Glashedy Links', ['b', 'g', 'w']],
    ]);
    expect(teesOf(all, 'Glashedy Links').map((t) => t.tee)).toEqual(['Black', 'Gold', 'White']);
  });
});
