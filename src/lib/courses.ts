// Tees: course records sharing a name are one course's tees (tee = null: a course with one unnamed tee).
import type { CourseRow } from './data/types';

export const courseLabel = (c: Pick<CourseRow, 'name' | 'tee'>) => (c.tee ? `${c.name} · ${c.tee} tees` : c.name);

// Longest (highest rated) tee first; unrated last. Postgres numerics can arrive as strings.
const byLength = (a: CourseRow, b: CourseRow) =>
  Number(b.course_rating ?? -1) - Number(a.course_rating ?? -1) || (a.tee ?? '').localeCompare(b.tee ?? '');

export function teesOf(courses: CourseRow[], name: string): CourseRow[] {
  return courses.filter((c) => c.name === name).sort(byLength);
}

export function courseGroups(courses: CourseRow[]): { name: string; tees: CourseRow[] }[] {
  return [...new Set(courses.map((c) => c.name))].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, tees: teesOf(courses, name) }));
}

/** The tee a new day starts on: the White tee where the course has one, else its first (longest) tee. */
export function defaultTee(tees: CourseRow[]): CourseRow | undefined {
  return tees.find((t) => /\bwhite\b/i.test(t.tee ?? '')) ?? tees[0];
}
