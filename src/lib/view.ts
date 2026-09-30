import {
  buildMatches,
  computeMatchState,
  computeTracker,
  pointsStep,
  courseHandicap,
  indexScores,
  pairNet,
  roundPointsAvailable,
  scoreKey,
  type ConfirmedResult,
  type HoleInfo,
  type MatchDef,
  type MatchState,
  type MatchType,
  type PairNet,
  type RoundSettings,
  type ScoreIndex,
  type Slot,
  type Team,
  type Tracker,
} from './scoring';
import type { CourseRow, EventRow, GroupRow, RoundRow, Snapshot } from './data/types';

export interface MatchView {
  def: MatchDef; state: MatchState; result: ConfirmedResult | null;
  /** Event-wide match number: day by day, group by group, fourball then low then high singles. */
  number: number;
  /** Fourball only: each pair's better-ball net score to par, off full course handicaps. */
  net?: { a: PairNet | null; b: PairNet | null };
}
export interface GroupView {
  group: GroupRow; slots: Partial<Record<Slot, string>>; matches: MatchView[]; scores: ScoreIndex;
  /** Each player's course handicap for this round (index converted with their own tee's slope/rating/par). */
  playingHcp: Record<string, number>;
  /** Each player's holes as they play them: their own tee's par and stroke index. */
  teeHoles: Record<string, HoleInfo[]>;
  /** Players on a tee other than the day's main tee, and that tee. */
  teeOf: Record<string, CourseRow>;
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
    fourballFormat: r.fourball_format ?? 'matchplay',
  };
}

export function buildEventView(s: Snapshot): EventView | null {
  if (!s.event) return null;
  const handicapOf = Object.fromEntries(s.eventPlayers.map((p) => [p.player_id, Number(p.handicap)]));
  const teamOf = Object.fromEntries(s.eventPlayers.map((p) => [p.player_id, p.team])) as Record<string, Team>;
  const groupCount = Math.floor(s.eventPlayers.length / 4);
  const everyMatch: MatchView[] = [];
  let total = 0;
  let matchNo = 0;

  const rounds = [...s.rounds]
    .sort((a, b) => a.round_no - b.round_no)
    .map((round): RoundView => {
      const settings = settingsOf(round);
      const pointsAvailable = roundPointsAvailable(settings, groupCount);
      total += pointsAvailable;
      const holesOf = (courseId: string): HoleInfo[] =>
        s.courseHoles
          .filter((h) => h.course_id === courseId)
          .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index }))
          .sort((a, b) => a.hole - b.hole);
      const holes = holesOf(round.course_id);
      const course = s.courses.find((c) => c.id === round.course_id);
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
          // Players on another tee play that tee's holes and get a course handicap off its slope/rating/par.
          const teeOf: Record<string, CourseRow> = {};
          const teeHoles: Record<string, HoleInfo[]> = {};
          for (const gp of members) {
            const row = s.roundTees.find((t) => t.round_id === round.id && t.player_id === gp.player_id);
            const found = row && row.course_id !== round.course_id ? s.courses.find((c) => c.id === row.course_id) : undefined;
            // Only another tee of the day's course counts (a tee left over from a previous course is ignored).
            const tee = found && found.name === course?.name ? found : undefined;
            if (tee) teeOf[gp.player_id] = tee;
            teeHoles[gp.player_id] = tee ? holesOf(tee.id) : holes;
          }
          const playingHcp = Object.fromEntries(
            members.map((gp) => {
              // A confirmed group plays off the index it was played with; others use the current one.
              const index = gp.handicap !== null && gp.handicap !== undefined ? Number(gp.handicap) : (handicapOf[gp.player_id] ?? 0);
              const c = teeOf[gp.player_id] ?? course;
              const par = teeHoles[gp.player_id].reduce((sum, h) => sum + h.par, 0);
              const rating = c?.course_rating != null ? Number(c.course_rating) : null;
              return [gp.player_id, courseHandicap(index, c?.slope_rating ?? null, rating, par)];
            }),
          );
          const onOtherTees = Object.keys(teeOf).length > 0;
          const defs = buildMatches(
            group.id,
            members.map((gp) => ({ slot: gp.slot, playerId: gp.player_id, handicap: playingHcp[gp.player_id] })),
            settings,
            !!group.singles_crossed,
          ).map((def) => (onOtherTees ? { ...def, teeHoles } : def));
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
            const net =
              def.type === 'better_ball'
                ? {
                    // Scramble: net off the team's scramble handicap; otherwise each player's full handicap.
                    a: pairNet(def.sideA, holes, scores, def.teamHandicap ?? playingHcp, teeHoles),
                    b: pairNet(def.sideB, holes, scores, def.teamHandicap ?? playingHcp, teeHoles),
                  }
                : undefined;
            return { def, state: computeMatchState(def, holes, scores), result, number: ++matchNo, net };
          });
          everyMatch.push(...matches);
          return { group, slots, matches, scores, playingHcp, teeHoles, teeOf };
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
  low_singles: 'Singles 1',
  high_singles: 'Singles 2',
};
export const matchLabel = (type: MatchType) => LABELS[type];

export const today = () => new Date().toLocaleDateString('en-CA');

/** Groups that still need scoring (have matches, not all confirmed), by day. Days with none are left out. */
export function scoringList(view: EventView): { round: RoundView; groups: GroupView[] }[] {
  return view.rounds
    .map((round) => ({ round, groups: round.groups.filter((g) => g.matches.length > 0 && g.matches.some((m) => !m.result)) }))
    .filter((d) => d.groups.length > 0);
}

/** "Match 4", or "Matches 7–9" when a group also plays singles. */
export function matchesLabel(group: GroupView): string {
  const ns = group.matches.map((m) => m.number);
  if (ns.length === 0) return `Group ${group.group.group_no}`;
  return ns.length === 1 ? `Match ${ns[0]}` : `Matches ${Math.min(...ns)}–${Math.max(...ns)}`;
}

/** The only match left to score (so Scores can skip the list), or null when there's a choice or nothing to score. */
export function onlyGroupId(list: { groups: GroupView[] }[]): string | null {
  const all = list.flatMap((d) => d.groups);
  return all.length === 1 ? all[0].group.id : null;
}

/** The match this phone was scoring, if it's still on the scoring list (i.e. not yet confirmed). */
export function resumeGroupId(remembered: string | null, list: { groups: GroupView[] }[]): string | null {
  if (!remembered) return null;
  return list.some((d) => d.groups.some((g) => g.group.id === remembered)) ? remembered : null;
}

/** "Cochrane/Trimble vs Connaughty/McCaughey" — team A pair vs team B pair, each pair alphabetical. */
export function pairingLabel(group: GroupView, short: (playerId: string) => string): string {
  const side = (slots: Slot[]) =>
    slots
      .map((s) => group.slots[s])
      .filter((x): x is string => !!x)
      .map(short)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
      .join('/');
  return `${side(['A1', 'A2'])} vs ${side(['B1', 'B2'])}`;
}

/**
 * The day the leaderboard opens on: the day of the match this phone is scoring (while it's still being
 * played), otherwise the first day with a match still to confirm — Day 1 until all its matches are
 * confirmed, then Day 2, and so on — and the last day once everything is confirmed.
 */
export function leaderboardRoundId(view: EventView, scoringGroupId: string | null): string | null {
  const id = resumeGroupId(scoringGroupId, scoringList(view));
  const found = id ? findGroup(view, id) : null;
  if (found) return found.round.round.id;
  const days = [...view.rounds].sort((a, b) => a.round.round_no - b.round.round_no);
  return (days.find((r) => r.completed < r.totalMatches) ?? days.at(-1))?.round.id ?? null;
}
