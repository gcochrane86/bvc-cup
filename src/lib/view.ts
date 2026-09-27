import {
  buildMatches,
  computeMatchState,
  computeTracker,
  pointsStep,
  courseHandicap,
  indexScores,
  roundPointsAvailable,
  scoreKey,
  type ConfirmedResult,
  type HoleInfo,
  type MatchDef,
  type MatchState,
  type MatchType,
  type RoundSettings,
  type ScoreIndex,
  type Slot,
  type Team,
  type Tracker,
} from './scoring';
import type { EventRow, GroupRow, RoundRow, Snapshot } from './data/types';

export interface MatchView { def: MatchDef; state: MatchState; result: ConfirmedResult | null }
export interface GroupView {
  group: GroupRow; slots: Partial<Record<Slot, string>>; matches: MatchView[]; scores: ScoreIndex;
  /** Each player's course handicap for this round (index converted with the course's slope/rating). */
  playingHcp: Record<string, number>;
}
export interface RoundView {
  round: RoundRow; settings: RoundSettings; holes: HoleInfo[]; groups: GroupView[]; completed: number; totalMatches: number;
  /** Points on offer this round (fourballs, plus singles when switched on). */
  pointsAvailable: number;
}
export interface EventView {
  event: EventRow; rounds: RoundView[]; tracker: Tracker; teamOf: Record<string, Team>; handicapOf: Record<string, number>;
}

// Postgres numeric columns can arrive as strings; Number() normalises them.
export function settingsOf(r: RoundRow): RoundSettings {
  return {
    allowancePct: Number(r.allowance_pct),
    betterBallPoints: Number(r.better_ball_points),
    singlesEnabled: r.singles_enabled,
    singlesPoints: Number(r.singles_points),
    singlesAllowancePct: Number(r.singles_allowance_pct),
  };
}

export function buildEventView(s: Snapshot): EventView | null {
  if (!s.event) return null;
  const handicapOf = Object.fromEntries(s.eventPlayers.map((p) => [p.player_id, Number(p.handicap)]));
  const teamOf = Object.fromEntries(s.eventPlayers.map((p) => [p.player_id, p.team])) as Record<string, Team>;
  const groupCount = Math.floor(s.eventPlayers.length / 4);
  const everyMatch: MatchView[] = [];
  let total = 0;

  const rounds = [...s.rounds]
    .sort((a, b) => a.round_no - b.round_no)
    .map((round): RoundView => {
      const settings = settingsOf(round);
      const pointsAvailable = roundPointsAvailable(settings, groupCount);
      total += pointsAvailable;
      const holes = s.courseHoles
        .filter((h) => h.course_id === round.course_id)
        .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index }))
        .sort((a, b) => a.hole - b.hole);
      const course = s.courses.find((c) => c.id === round.course_id);
      const par = holes.reduce((sum, h) => sum + h.par, 0);
      const slope = course?.slope_rating ?? null;
      const rating = course?.course_rating != null ? Number(course.course_rating) : null;
      const scores = indexScores(
        s.scores
          .filter((x) => x.round_id === round.id)
          .map((x) => ({ playerId: x.player_id, hole: x.hole, gross: x.gross, pickedUp: x.picked_up })),
      );
      const groups = s.groups
        .filter((g) => g.round_id === round.id)
        .sort((a, b) => a.group_no - b.group_no)
        .map((group): GroupView => {
          const members = s.groupPlayers.filter((gp) => gp.group_id === group.id);
          const slots = Object.fromEntries(members.map((gp) => [gp.slot, gp.player_id])) as Partial<Record<Slot, string>>;
          const playingHcp = Object.fromEntries(
            members.map((gp) => {
              // A confirmed group plays off the index it was played with; others use the current one.
              const index = gp.handicap !== null && gp.handicap !== undefined ? Number(gp.handicap) : (handicapOf[gp.player_id] ?? 0);
              return [gp.player_id, courseHandicap(index, slope, rating, par)];
            }),
          );
          const defs = buildMatches(
            group.id,
            members.map((gp) => ({ slot: gp.slot, playerId: gp.player_id, handicap: playingHcp[gp.player_id] })),
            settings,
          );
          const matches = defs.map((def): MatchView => {
            const row = s.results.find((r) => r.group_id === group.id && r.match_type === def.type);
            const result: ConfirmedResult | null = row
              ? {
                  groupId: row.group_id,
                  matchType: row.match_type,
                  winner: row.winner,
                  pointsA: Number(row.points_a),
                  pointsB: Number(row.points_b),
                  resultText: row.result_text,
                  finalHole: row.final_hole,
                }
              : null;
            return { def, state: computeMatchState(def, holes, scores), result };
          });
          everyMatch.push(...matches);
          return { group, slots, matches, scores, playingHcp };
        });
      const ms = groups.flatMap((g) => g.matches);
      return { round, settings, holes, groups, completed: ms.filter((m) => m.result).length, totalMatches: ms.length, pointsAvailable };
    });

  return { event: s.event, rounds, tracker: computeTracker(everyMatch, total, pointsStep(rounds.map((r) => r.settings))), teamOf, handicapOf };
}

export function defaultRoundId(rounds: RoundRow[], todayIso: string): string | null {
  if (rounds.length === 0) return null;
  const sorted = [...rounds].sort((a, b) => a.round_no - b.round_no);
  return (
    sorted.find((r) => r.date === todayIso)?.id ??
    sorted.find((r) => r.date !== null && r.date > todayIso)?.id ??
    sorted[sorted.length - 1].id
  );
}

export function findGroup(view: EventView, groupId: string): { round: RoundView; group: GroupView } | null {
  for (const round of view.rounds) {
    const group = round.groups.find((g) => g.group.id === groupId);
    if (group) return { round, group };
  }
  return null;
}

export function firstIncompleteHole(group: GroupView, holes: HoleInfo[]): number {
  const ids = Object.values(group.slots).filter((x): x is string => !!x);
  for (const h of holes) {
    if (!ids.every((id) => group.scores.has(scoreKey(id, h.hole)))) return h.hole;
  }
  return holes[holes.length - 1]?.hole ?? 1;
}

const LABELS: Record<MatchType, string> = {
  better_ball: 'Fourball',
  low_singles: 'Low singles',
  high_singles: 'High singles',
};
export const matchLabel = (type: MatchType) => LABELS[type];

export const today = () => new Date().toLocaleDateString('en-CA');
