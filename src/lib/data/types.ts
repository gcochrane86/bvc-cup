import type { MatchType, Outcome, Slot, Team } from '../scoring';

export interface PlayerRow { id: string; name: string; short_name: string; default_handicap: number; photo_path: string | null }
/** A course record is one tee of a course: records sharing a name are that course's tees (tee null = one unnamed tee). */
export interface CourseRow { id: string; name: string; tee: string | null; slope_rating: number | null; course_rating: number | null }
/** A player on a tee other than the day's main tee (rounds.course_id). */
export interface RoundTeeRow { round_id: string; player_id: string; course_id: string }
export interface CourseHoleRow { course_id: string; hole: number; par: number; stroke_index: number }
export interface EventRow {
  id: string; name: string;
  team_a_name: string; team_a_colour: string;
  team_b_name: string; team_b_colour: string;
  is_active: boolean;
  /** Show players the Form tab (rankings) for this event. */
  show_form: boolean;
  /** Show players the Leaderboard tab (off: they land on Scores; the admin still sees it). */
  show_leaderboard: boolean;
}
export interface EventPlayerRow { event_id: string; player_id: string; team: Team; handicap: number }
export interface RoundRow {
  id: string; event_id: string; course_id: string; round_no: number; date: string | null; name: string;
  allowance_pct: number; better_ball_points: number;
  singles_enabled: boolean; singles_points: number; singles_allowance_pct: number;
  /** How singles opponents are decided: by handicap slot, random draw, or chosen by the admin. */
  singles_pairing: 'handicap' | 'random' | 'selected';
  /** The fourball game: match play off the lowest handicap, Stableford off full handicaps, or flat (no shots). */
  fourball_format: 'matchplay' | 'stableford' | 'flat';
}
export interface GroupRow {
  id: string; round_id: string; group_no: number; tee_time: string | null;
  /** Singles line-up: false = A1 v B1 & A2 v B2; true = A1 v B2 & A2 v B1. */
  singles_crossed: boolean;
}
export interface GroupPlayerRow {
  group_id: string; slot: Slot; player_id: string;
  /** Frozen when a match in the group is confirmed; null = use the current event handicap. */
  handicap: number | null;
}
export interface ScoreRow {
  round_id: string; player_id: string; hole: number;
  gross: number | null; picked_up: boolean; client_updated_at: string;
  /** Set by the server on every write; absent on this phone's not-yet-sent rows. */
  updated_at?: string;
}
export interface MatchResultRow {
  group_id: string; match_type: MatchType; winner: Outcome;
  points_a: number; points_b: number; result_text: string; final_hole: number; confirmed_at: string;
}

/** Everything the app displays for the active event. */
export interface Snapshot {
  event: EventRow | null;
  players: PlayerRow[];
  courses: CourseRow[];
  courseHoles: CourseHoleRow[];
  eventPlayers: EventPlayerRow[];
  rounds: RoundRow[];
  groups: GroupRow[];
  groupPlayers: GroupPlayerRow[];
  scores: ScoreRow[];
  results: MatchResultRow[];
  roundTees: RoundTeeRow[];
}
