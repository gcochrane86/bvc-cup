import type { RealtimeChannel } from '@supabase/supabase-js';
import { createStore, del, get, set, values } from 'idb-keyval';
import { must, supabase } from '../supabase';
import { applyPending, isBehind, removeScoreRow, upsertScoreRow } from './merge';
import { freshOnly } from './fresh';
import { planPhotoUrls, PHOTO_URL_TTL_S, type SignedPhoto } from './photoUrls';
import { createOutbox, pendingKey, type OutboxStorage, type PendingScore, type SendResult } from './outbox';
import type {
  CourseHoleRow, CourseRow, EventPlayerRow, EventRow, GroupPlayerRow, GroupRow,
  MatchResultRow, PlayerRow, RoundRow, ScoreRow, Snapshot,
} from './types';

const empty = (): Snapshot => ({
  event: null, players: [], courses: [], courseHoles: [], eventPlayers: [],
  rounds: [], groups: [], groupPlayers: [], scores: [], results: [],
});

export const db = $state({
  ...empty(),
  loaded: false,
  error: null as string | null,
  notice: null as string | null,
  pending: [] as PendingScore[],
  photoUrls: {} as Record<string, string>,
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
  return must(
    supabase.rpc('upsert_score', {
      p_round_id: p.roundId,
      p_player_id: p.playerId,
      p_hole: p.hole,
      p_gross: p.gross,
      p_picked_up: p.pickedUp,
      p_client_updated_at: p.clientUpdatedAt,
      p_if_absent: p.ifAbsent ?? false,
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

async function doLoad() {
  try {
    const [events, players, courses, courseHoles] = await Promise.all([
      must(supabase.from('events').select('*').eq('is_active', true).limit(1)) as Promise<EventRow[]>,
      must(supabase.from('players').select('*').order('name')) as Promise<PlayerRow[]>,
      must(supabase.from('courses').select('*').order('name')) as Promise<CourseRow[]>,
      must(supabase.from('course_holes').select('*')) as Promise<CourseHoleRow[]>,
    ]);
    const event = events[0] ?? null;
    let eventPlayers: EventPlayerRow[] = [];
    let rounds: RoundRow[] = [];
    let groups: GroupRow[] = [];
    let groupPlayers: GroupPlayerRow[] = [];
    let scores: ScoreRow[] = [];
    let results: MatchResultRow[] = [];
    if (event) {
      [eventPlayers, rounds] = await Promise.all([
        must(supabase.from('event_players').select('*').eq('event_id', event.id)) as Promise<EventPlayerRow[]>,
        must(supabase.from('rounds').select('*').eq('event_id', event.id)) as Promise<RoundRow[]>,
      ]);
      const roundIds = rounds.map((r) => r.id);
      if (roundIds.length) {
        // 3 rounds x 12 players x 18 holes = 648 score rows, under the API's 1000-row default.
        [groups, scores] = await Promise.all([
          must(supabase.from('groups').select('*').in('round_id', roundIds)) as Promise<GroupRow[]>,
          must(supabase.from('scores').select('*').in('round_id', roundIds)) as Promise<ScoreRow[]>,
        ]);
        const groupIds = groups.map((g) => g.id);
        if (groupIds.length) {
          [groupPlayers, results] = await Promise.all([
            must(supabase.from('group_players').select('*').in('group_id', groupIds)) as Promise<GroupPlayerRow[]>,
            must(supabase.from('match_results').select('*').in('group_id', groupIds)) as Promise<MatchResultRow[]>,
          ]);
        }
      }
    }
    const pending = await outbox.pending();
    Object.assign(db, {
      event, players, courses, courseHoles, eventPlayers, rounds, groups, groupPlayers, results,
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

export function photoUrl(playerId: string): string | null {
  const path = db.players.find((p) => p.id === playerId)?.photo_path;
  return path ? (db.photoUrls[path] ?? null) : null;
}
export const playerName = (id: string) => db.players.find((p) => p.id === id)?.name ?? '?';
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
      supabase.from('scores').select('client_updated_at', { count: 'exact' }).in('round_id', roundIds)
        .order('client_updated_at', { ascending: false }).limit(1),
      supabase.from('match_results').select('group_id', { count: 'exact', head: true })
        .in('group_id', groupIds.length ? groupIds : ['00000000-0000-0000-0000-000000000000']),
    ]);
    if (s.error || r.error) return; // offline; the online/visibility handlers catch up later
    const remote = { scores: s.count ?? 0, latest: s.data?.[0]?.client_updated_at ?? null, results: r.count ?? 0 };
    if (isBehind(db.scores, db.results.length, remote)) void loadAll();
  } catch {
    /* offline — ignore */
  }
}

// ---- realtime ----
const SETUP_TABLES = ['players', 'courses', 'course_holes', 'events', 'event_players', 'rounds', 'groups', 'group_players'];
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

export function startData() {
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
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onOnline);
  clearInterval(pollTimer);
  clearTimeout(retryTimer);
  Object.assign(db, empty(), { loaded: false, error: null });
}
