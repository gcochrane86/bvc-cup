import type { MatchType, Outcome, Slot, Team } from '../scoring';

export interface PlayerRow { id: string; name: string; short_name: string; default_handicap: number; photo_path: string | null }
export interface CourseRow { id: string; name: string }
export interface CourseHoleRow { course_id: string; hole: number; par: number; stroke_index: number }
export interface EventRow {
  id: string; name: string;
  team_a_name: string; team_a_colour: string;
  team_b_name: string; team_b_colour: string;
  is_active: boolean;
}
export interface EventPlayerRow { event_id: string; player_id: string; team: Team; handicap: number }
export interface RoundRow {
  id: string; event_id: string; course_id: string; round_no: number; date: string | null; name: string;
  allowance_pct: number; better_ball_points: number;
  singles_enabled: boolean; singles_points: number; singles_allowance_pct: number;
}
export interface GroupRow { id: string; round_id: string; group_no: number; tee_time: string | null }
export interface GroupPlayerRow { group_id: string; slot: Slot; player_id: string }
export interface ScoreRow {
  round_id: string; player_id: string; hole: number;
  gross: number | null; picked_up: boolean; client_updated_at: string;
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
}
