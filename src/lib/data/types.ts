import type { MatchType, PlayerPoints, SeasonPoints, Slot, Team, Winner } from '../scoring';

export interface PlayerRow { id: string; name: string; short_name: string; default_handicap: number; photo_path: string | null }
/** A course record is one tee of a course: records sharing a name are that course's tees (tee null = one unnamed tee). */
export interface CourseRow { id: string; name: string; tee: string | null; slope_rating: number | null; course_rating: number | null }
/** A course guide photo uploaded in Admin (by course name, so every tee shares it). */
export interface GuidePhotoRow { id: string; course_name: string; hole: number; path: string; created_at: string }
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
  /** Show players' photos (off: coloured initials for everyone, so a half-photographed field looks even). */
  show_photos: boolean;
  /** The share link token (#/watch/<token>); null = no link. */
  watch_token: string | null;
  /** Team cup (A v B) or individual (2- and 3-player games, no teams). */
  kind: 'team' | 'individual';
  /** Season team event: Team A v Team B, golfers change day to day, points per format from `points`. */
  season: boolean;
  points: SeasonPoints;
}
/** team: null in individual events. */
export interface EventPlayerRow { event_id: string; player_id: string; team: Team | null; handicap: number }
export interface RoundRow {
  id: string; event_id: string; course_id: string; round_no: number; date: string | null; name: string;
  allowance_pct: number; better_ball_points: number;
  singles_enabled: boolean; singles_points: number; singles_allowance_pct: number;
  /** How singles opponents are decided: by handicap slot, random draw, or chosen by the admin. */
  singles_pairing: 'handicap' | 'random' | 'selected';
  /** The fourball game: match play off the lowest handicap, Stableford off full handicaps, or flat (no shots). */
  fourball_format: 'matchplay' | 'stableford' | 'flat' | 'scramble';
  /** Individual events: the 2-player game, the 3-player game, and handicap settings. */
  pair_game: 'stableford' | 'flat_match' | 'stableford_match';
  three_game: 'six_stableford' | 'six_flat' | 'two_v_one' | 'two_v_one_match' | 'two_v_one_flat' | 'two_v_one_best' | 'wolf_stableford' | 'wolf_flat';
  /** The holes played that day (e.g. 1–9, 14 and 18 in winter); null = all 18. */
  holes?: number[] | null;
  stableford_pct: number; match_pct: number; match_off_low: boolean;
  /** Stableford wolf: shots off the lowest of the three, not full handicaps. */
  wolf_off_low: boolean;
  /** 2-man scramble: % of the lower and the higher partner's handicap that make the team handicap. */
  scramble_low_pct: number; scramble_high_pct: number;
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
  /** Wolf: this player played the hole on their own. */
  lone?: boolean;
  /** Set by the server on every write; absent on this phone's not-yet-sent rows. */
  updated_at?: string;
}
export interface MatchResultRow {
  group_id: string; match_type: MatchType; winner: Winner;
  points_a: number; points_b: number; result_text: string; final_hole: number; confirmed_at: string;
  /** Individual games: each player's game points and Stableford total. */
  player_points?: Record<string, PlayerPoints> | null;
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
