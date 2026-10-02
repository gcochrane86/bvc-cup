import type { GameRow } from '../games';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createStore, del, get, set, values } from 'idb-keyval';
import { must, supabase } from '../supabase';
import { isAdmin } from '../auth.svelte';
import { applyPending, isBehind, removeScoreRow, upsertScoreRow } from './merge';
import { freshOnly } from './fresh';
import { endWatching, watch } from '../watch.svelte';
import { planPhotoUrls, PHOTO_URL_TTL_S, type SignedPhoto } from './photoUrls';
import { createOutbox, pendingKey, type OutboxStorage, type PendingScore, type SendResult } from './outbox';
import type {
  CourseHoleRow, CourseRow, EventPlayerRow, EventRow, GroupPlayerRow, GroupRow,
  GuidePhotoRow, MatchResultRow, PlayerRow, RoundRow, RoundTeeRow, ScoreRow, Snapshot,
} from './types';

const empty = (): Snapshot => ({
  event: null, players: [], courses: [], courseHoles: [], eventPlayers: [],
  rounds: [], groups: [], groupPlayers: [], scores: [], results: [], roundTees: [],
});

export const db = $state({
  ...empty(),
  loaded: false,
  error: null as string | null,
  notice: null as string | null,
  pending: [] as PendingScore[],
  photoUrls: {} as Record<string, string>,
  /** Guide photos uploaded in Admin, for every course (a handful of rows). */
  guidePhotos: [] as GuidePhotoRow[],
  /** Admin → Games: which games are on and their defaults (rows only for games the admin has touched or seeded). */
  games: [] as GameRow[],
});

// ---- offline outbox (IndexedDB) ----
const idb = createStore('golf-outbox', 'pending');
const storage: OutboxStorage = {
  getAll: () => values<PendingScore>(idb),
  get: (k) => get<PendingScore>(k, idb),
  put: (p) => set(pendingKey(p), p, idb),
  remove: (k) => del(k, idb),
};

async function send(p: PendingScore): Promise<SendResult> {
  // Through a share link, scores go via the link (checked against its event) rather than a sign-in.
  const link = watching ? { p_token: watch.token } : {};
  return must(
    supabase.rpc(watching ? 'watch_upsert_score' : 'upsert_score', {
      ...link,
      p_round_id: p.roundId,
      p_player_id: p.playerId,
      p_hole: p.hole,
      p_gross: p.gross,
      p_picked_up: p.pickedUp,
      p_client_updated_at: p.clientUpdatedAt,
      p_if_absent: p.ifAbsent ?? false,
      ...(p.lone !== undefined ? { p_lone: p.lone } : {}),
    }),
  ) as Promise<SendResult>;
}

const outbox = createOutbox({
  storage,
  send,
  onChange: (pending) => {
    db.pending = pending;
  },
  onLocked: (p) => {
    db.notice = `Hole ${p.hole} is locked because its match was confirmed, so that change wasn't saved.`;
    void loadAll();
  },
  // This phone already shows its own value for that cell, but the server kept another phone's score.
  // Reload so it shows the real one: the catch-up check can't tell, as the count of scores matches and
  // this phone's own (newer) timestamp makes it look up to date.
  onRefused: () => void loadAll(),
});

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2000;

export async function flushOutbox(): Promise<boolean> {
  clearTimeout(retryTimer);
  const result = await outbox.drain(); // waits out an in-flight flush, so callers see the real queue
  if (result === 'done') retryDelay = 2000;
  if (result === 'failed') {
    retryTimer = setTimeout(() => void flushOutbox(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }
  return db.pending.length === 0;
}

export async function enterScore(p: PendingScore) {
  db.pending = [...db.pending.filter((x) => pendingKey(x) !== pendingKey(p)), p];
  db.scores = applyPending(db.scores, [p]);
  await outbox.enqueue(p);
  void flushOutbox();
}

// ---- loading ----
let loading = false;

/** Reload everything. A call made mid-load waits for a fresh load, so callers never see pre-write data. */
export const loadAll = freshOnly(async () => {
  loading = true;
  try {
    await doLoad();
  } finally {
    loading = false;
  }
});

/** An event's rounds, groups, players, tees, scores and results (for the active event, or one opened in Admin). */
export async function fetchEventData(eventId: string) {
  const [eventPlayers, rounds] = await Promise.all([
    must(supabase.from('event_players').select('*').eq('event_id', eventId)) as Promise<EventPlayerRow[]>,
    must(supabase.from('rounds').select('*').eq('event_id', eventId)) as Promise<RoundRow[]>,
  ]);
  let groups: GroupRow[] = [];
  let groupPlayers: GroupPlayerRow[] = [];
  let scores: ScoreRow[] = [];
  let results: MatchResultRow[] = [];
  let roundTees: RoundTeeRow[] = [];
  const roundIds = rounds.map((r) => r.id);
  if (roundIds.length) {
    // 3 rounds x 12 players x 18 holes = 648 score rows, under the API's 1000-row default.
    [groups, scores, roundTees] = await Promise.all([
      must(supabase.from('groups').select('*').in('round_id', roundIds)) as Promise<GroupRow[]>,
      must(supabase.from('scores').select('*').in('round_id', roundIds)) as Promise<ScoreRow[]>,
      must(supabase.from('round_tees').select('*').in('round_id', roundIds)) as Promise<RoundTeeRow[]>,
    ]);
    const groupIds = groups.map((g) => g.id);
    if (groupIds.length) {
      [groupPlayers, results] = await Promise.all([
        must(supabase.from('group_players').select('*').in('group_id', groupIds)) as Promise<GroupPlayerRow[]>,
        must(supabase.from('match_results').select('*').in('group_id', groupIds)) as Promise<MatchResultRow[]>,
      ]);
    }
  }
  return { eventPlayers, rounds, groups, groupPlayers, scores, results, roundTees };
}

/** Using an event's share link (no sign-in): data comes from watch_event, polled; scores go via the link. */
let watching = false;
export const isWatching = () => watching;

async function loadWatched() {
  try {
    const snap = (await must(supabase.rpc('watch_event', { p_token: watch.token }))) as (Snapshot & { guidePhotos: GuidePhotoRow[] }) | null;
    if (!snap) return endWatching(); // the admin turned the link off (or replaced it)
    Object.assign(db, { ...snap, pending: [], loaded: true, error: null });
    await refreshPhotoUrls();
  } catch (e) {
    db.error = e instanceof Error ? e.message : String(e);
  }
}

async function doLoad() {
  if (watching) return loadWatched();
  try {
    const [events, players, courses, courseHoles, guidePhotos, games] = await Promise.all([
      must(supabase.from('events').select('*').eq('is_active', true).limit(1)) as Promise<EventRow[]>,
      must(supabase.from('players').select('*').order('name')) as Promise<PlayerRow[]>,
      must(supabase.from('courses').select('*').order('name')) as Promise<CourseRow[]>,
      must(supabase.from('course_holes').select('*')) as Promise<CourseHoleRow[]>,
      must(supabase.from('guide_photos').select('*').order('created_at')) as Promise<GuidePhotoRow[]>,
      must(supabase.from('games').select('*')) as Promise<GameRow[]>,
    ]);
    const event = events[0] ?? null;
    const { eventPlayers, rounds, groups, groupPlayers, scores, results, roundTees } = event
      ? await fetchEventData(event.id)
      : { eventPlayers: [], rounds: [], groups: [], groupPlayers: [], scores: [], results: [], roundTees: [] };
    const pending = await outbox.pending();
    Object.assign(db, {
      event, players, courses, courseHoles, eventPlayers, rounds, groups, groupPlayers, results, roundTees, guidePhotos, games,
      scores: applyPending(scores, pending),
      pending,
      loaded: true,
      error: null,
    });
    await refreshPhotoUrls();
  } catch (e) {
    db.error = e instanceof Error ? e.message : String(e);
  }
}

let signedPhotos: Record<string, SignedPhoto> = {};

async function refreshPhotoUrls() {
  const paths = db.players.map((p) => p.photo_path).filter((p): p is string => !!p);
  const now = Date.now();
  const { keep, sign } = planPhotoUrls(signedPhotos, paths, now);
  if (sign.length) {
    const signed = await must(supabase.storage.from('player-photos').createSignedUrls(sign, PHOTO_URL_TTL_S));
    for (const s of signed ?? []) if (s.path && s.signedUrl) keep[s.path] = { url: s.signedUrl, signedAt: now };
  }
  signedPhotos = keep;
  db.photoUrls = Object.fromEntries(Object.entries(keep).map(([path, s]) => [path, s.url]));
}

/** A player's photo for the event's pages: none when the admin has switched photos off for this event. */
export function photoUrl(playerId: string): string | null {
  return db.event?.show_photos === false ? null : playerPhotoUrl(playerId);
}
/** A player's photo whatever the event's setting (Admin → Players). */
export function playerPhotoUrl(playerId: string): string | null {
  const path = db.players.find((p) => p.id === playerId)?.photo_path;
  return path ? (db.photoUrls[path] ?? null) : null;
}
export const playerName = (id: string) => db.players.find((p) => p.id === id)?.name ?? '?';
/** Players see the Leaderboard (and match pages) unless the admin hid it for this event; the admin always does. */
export const leaderboardShown = () => db.event?.show_leaderboard !== false || isAdmin();

/** Courses (by name) that have uploaded guide photos. */
export const photoCourses = () => [...new Set(db.guidePhotos.map((p) => p.course_name))];

export const playerShort = (id: string) => db.players.find((p) => p.id === id)?.short_name ?? '?';

// ---- catch-up check ----
// Realtime drops messages silently when the project hits its per-second message limit (e.g. an
// admin saving a course while every phone is watching). Every 15s, compare two tiny server
// summaries with local state and reload if anything was missed.
async function checkForMissed() {
  if (!db.loaded || loading || document.visibilityState !== 'visible') return;
  const roundIds = db.rounds.map((r) => r.id);
  const groupIds = db.groups.map((g) => g.id);
  if (!roundIds.length) return;
  try {
    const [s, r] = await Promise.all([
      supabase.from('scores').select('updated_at', { count: 'exact' }).in('round_id', roundIds)
        .order('updated_at', { ascending: false }).limit(1),
      supabase.from('match_results').select('group_id', { count: 'exact', head: true })
        .in('group_id', groupIds.length ? groupIds : ['00000000-0000-0000-0000-000000000000']),
    ]);
    if (s.error || r.error) return; // offline; the online/visibility handlers catch up later
    const remote = { scores: s.count ?? 0, latest: s.data?.[0]?.updated_at ?? null, results: r.count ?? 0 };
    if (isBehind(db.scores, db.results.length, remote)) void loadAll();
  } catch {
    /* offline — ignore */
  }
}

// ---- realtime ----
const SETUP_TABLES = ['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players', 'round_tees', 'guide_photos'];
let channel: RealtimeChannel | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void loadAll(), 300);
}

function onScore(payload: { eventType: string; new: unknown; old: unknown }) {
  if (payload.eventType === 'DELETE') {
    db.scores = applyPending(removeScoreRow(db.scores, payload.old as ScoreRow), db.pending);
    return;
  }
  const row = payload.new as ScoreRow;
  if (!db.rounds.some((r) => r.id === row.round_id)) return;
  db.scores = applyPending(upsertScoreRow(db.scores, row), db.pending);
}

function onResult(payload: { eventType: string; new: unknown; old: unknown }) {
  const key = (payload.eventType === 'DELETE' ? payload.old : payload.new) as MatchResultRow;
  const others = db.results.filter((r) => !(r.group_id === key.group_id && r.match_type === key.match_type));
  if (payload.eventType === 'DELETE') db.results = others;
  else if (db.groups.some((g) => g.id === key.group_id)) db.results = [...others, key];
}

function onVisible() {
  if (document.visibilityState === 'visible') {
    void loadAll();
    void flushOutbox();
  }
}
function onOnline() {
  void loadAll();
  void flushOutbox();
}

const WATCH_POLL_MS = 5_000;

export function startData(mode: 'member' | 'watch' = 'member') {
  if (mode === 'watch') {
    // No realtime through a link (it needs a member's access): reload every few seconds while on screen.
    watching = true;
    void loadAll().then(() => flushOutbox());
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    pollTimer = setInterval(() => {
      if (db.pending.length) void flushOutbox();
      if (document.visibilityState === 'visible') void loadAll();
    }, WATCH_POLL_MS);
    return;
  }
  void loadAll().then(() => flushOutbox());
  channel = supabase
    .channel('golf-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, onScore)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_results' }, onResult);
  for (const table of SETUP_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload);
  }
  // Every (re)subscription catches up on anything missed while disconnected.
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') void loadAll();
  });
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  pollTimer = setInterval(() => {
    if (db.pending.length) void flushOutbox();
    void checkForMissed();
  }, 15_000);
}

export function stopData() {
  watching = false;
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onOnline);
  clearInterval(pollTimer);
  clearTimeout(retryTimer);
  Object.assign(db, empty(), { loaded: false, error: null });
}
