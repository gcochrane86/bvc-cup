<script lang="ts">
  import ShareLink from '../../components/ShareLink.svelte';
  import SeasonGolfers from '../../components/SeasonGolfers.svelte';
  import AddRound, { type AddRoundPayload } from '../../components/AddRound.svelte';
  import { db, loadAll, photoCourses } from '../../lib/data/store.svelte';
  import { favouritesFirst } from '../../lib/favourites';
  import { must, supabase } from '../../lib/supabase';
  import type { EventPlayerRow, EventRow, RoundRow, RoundTeeRow } from '../../lib/data/types';
  import { courseGroups, teesOf } from '../../lib/courses';
  import { autoFourball, eventKindFor, gameLabel, gamesToSet, scrambleHandicap, seasonDayCheck, type SeasonDay, type Team } from '../../lib/scoring';
  import { courseGuide } from '../../lib/guides';
  import { fourballKey, gamesFor } from '../../lib/games';
  import ResetScores from '../../components/ResetScores.svelte';
  import ConfirmedResults from '../../components/ConfirmedResults.svelte';

  let { eventId }: { eventId: string } = $props();

  /** playing: ticked in step 1; team: picked in step 2 (only saved once every player playing has one). */
  type Member = { playing: boolean; team: '' | 'A' | 'B'; handicap: number };
  let event = $state<EventRow | null>(null);
  let members = $state<Record<string, Member>>({});
  let rounds = $state<RoundRow[]>([]);
  let msg = $state<string | null>(null);
  /** Where the last message shows: next to the section that was saved ('players', 'event', 'points', 'more', 'round:<id>'), or (null) at the top. */
  let msgAt = $state<string | null>(null);
  /** This admin's favourite players: first in the Who's playing list. */
  let favs = $state<string[]>([]);
  /** The Add round form only shows after '+ Add round' is pressed (always for an event with no rounds yet). */
  let adding = $state(false);
  let roundTees = $state<RoundTeeRow[]>([]);
  let paired = $state<Record<string, number>>({});
  /** Individual events: each day's group sizes (2 or 3), which decide the games it needs. */
  let groupSizes = $state<Record<string, number[]>>({});
  /** Season events: each day's golfers. */
  let roundGolfers = $state<Record<string, string[]>>({});
  /** Season events, changing a day's golfers: the list being edited, per day. */
  let editGolfers = $state<Record<string, string[]>>({});
  /** The event's saved players (the day pickers only offer players already saved with a team). */
  let savedPlayers = $state<EventPlayerRow[]>([]);
  /** After saving teams: a day whose pairings still need setting (scores and the leaderboard need them). */
  let nudge = $state<RoundRow | null>(null);
  /** `${roundId}:${playerId}` for players whose match that day is confirmed (their tee is locked). */
  let locked = $state<Set<string>>(new Set());
  /** Rounds show as one-line tiles; these are the ones opened for editing (kept open across saves). */
  let openRounds = $state<Record<string, boolean>>({});
  let openGolfers = $state<Record<string, boolean>>({});
  /** The Players section opens by itself while teams still need sorting. */
  let playersOpen = $state(false);
  let moreOpen = $state(false);

  const courseName = (id: string) => db.courses.find((c) => c.id === id)?.name ?? '';
  const teeOfPlayer = (roundId: string, pid: string) => roundTees.find((t) => t.round_id === roundId && t.player_id === pid)?.course_id ?? '';
  const lockedIn = (roundId: string, pid: string) => locked.has(`${roundId}:${pid}`);
  const setPlayerTee = (r: RoundRow, pid: string, courseId: string) => {
    const name = db.players.find((p) => p.id === pid)?.name ?? 'Player';
    const tee = db.courses.find((c) => c.id === (courseId || r.course_id))?.tee ?? 'main';
    return act(
      () =>
        courseId
          ? must(supabase.from('round_tees').upsert({ round_id: r.id, player_id: pid, course_id: courseId }))
          : must(supabase.from('round_tees').delete().eq('round_id', r.id).eq('player_id', pid)),
      `${name} plays the ${tee} tees on ${r.name}`,
    );
  };

  async function load() {
    const id = eventId;
    const [ev, eps, rs, fs] = await Promise.all([
      must(supabase.from('events').select('*').eq('id', id).single()) as Promise<EventRow>,
      must(supabase.from('event_players').select('*').eq('event_id', id)) as Promise<EventPlayerRow[]>,
      must(supabase.from('rounds').select('*').eq('event_id', id).order('round_no')) as Promise<RoundRow[]>,
      must(supabase.from('player_favourites').select('player_id')) as Promise<{ player_id: string }[]>,
    ]);
    favs = fs.map((f) => f.player_id);
    if (!rs.length) adding = true; // a new event: straight to adding its first day
    const ids = rs.map((r) => r.id);
    if (ids.length) {
      const [tees, gs, rps] = await Promise.all([
        must(supabase.from('round_tees').select('*').in('round_id', ids)) as Promise<RoundTeeRow[]>,
        must(supabase.from('groups').select('round_id, group_players(player_id), match_results(match_type)').in('round_id', ids)) as Promise<
          { round_id: string; group_players: { player_id: string }[]; match_results: unknown[] }[]
        >,
        must(supabase.from('round_players').select('round_id, player_id').in('round_id', ids)) as Promise<{ round_id: string; player_id: string }[]>,
      ]);
      roundTees = tees;
      roundGolfers = Object.fromEntries(ids.map((id) => [id, rps.filter((r) => r.round_id === id).map((r) => r.player_id)]));
      // Full groups per day (for each day's pairing status): fourballs of four, or individual groups of 2–3.
      // Season days of 2 or 3 golfers are one group too.
      const fullFor = (id: string) => (ev.kind === 'individual' || (ev.season && (roundGolfers[id]?.length ?? 4) <= 3) ? 2 : 4);
      paired = Object.fromEntries(ids.map((id) => [id, gs.filter((g) => g.round_id === id && g.group_players.length >= fullFor(id)).length]));
      groupSizes = Object.fromEntries(ids.map((id) => [id, gs.filter((g) => g.round_id === id && g.group_players.length >= 2).map((g) => g.group_players.length)]));
      locked = new Set(gs.filter((g) => g.match_results.length).flatMap((g) => g.group_players.map((gp) => `${g.round_id}:${gp.player_id}`)));
    }
    members = Object.fromEntries(
      db.players.map((p) => {
        const m = eps.find((x) => x.player_id === p.id);
        return [p.id, { playing: !!m, team: m?.team ?? '', handicap: Number(p.default_handicap) }];
      }),
    );
    savedPlayers = eps;
    if (!Object.values(members).some((m) => m.playing)) teamStep = 'who';
    if (!eps.length) playersOpen = true;
    // Last, so the page never shows the event with its players and pairings still loading.
    rounds = rs;
    event = ev;
  }
  $effect(() => {
    void load();
  });

  /** fn may return a fuller message to show instead of ok. */
  /** Returns true when it saved. at: where its message shows (see msgAt). */
  async function act(fn: () => Promise<unknown>, ok: string, at: string | null = null): Promise<boolean> {
    msg = null;
    msgAt = at;
    try {
      const said = await fn();
      await load();
      await loadAll();
      msg = typeof said === 'string' ? said : ok;
      return true;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
      return false;
    }
  }

  // Step 1 (who's playing, with search) and step 2 (a one-tap team switch for each of them).
  let teamStep = $state<'who' | 'teams'>('teams');
  /** Individual events: no teams, so players are just ticked and each day has 2- and 3-player games. */
  const individual = $derived(event?.kind === 'individual' && !event?.season);
  /** Season team events: Team A v Team B, each day picks its golfers, points per format on the event. */
  const season = $derived(!!event?.season);
  let search = $state('');
  const playingIds = $derived(db.players.filter((p) => members[p.id]?.playing).map((p) => p.id));
  /** 2 or 3 ticked: one individual group, so players are just saved (no teams). 4 or more: teams, as before. */
  const smallGroup = $derived(!season && eventKindFor(playingIds.length) === 'individual');
  /** Season events: the event's players (with a team) for the day pickers, in name order. */
  const seasonPlayers = $derived(
    db.players
      .map((p) => ({ p, ep: savedPlayers.find((x) => x.player_id === p.id) }))
      .filter(({ ep }) => ep?.team)
      .map(({ p, ep }) => ({ id: p.id, name: p.name, short: p.short_name, team: ep!.team as Team })),
  );
  const seasonTeamOf = $derived(Object.fromEntries(seasonPlayers.map((p) => [p.id, p.team])) as Record<string, Team>);
  const teamName = (t: Team) => (t === 'A' ? (event?.team_a_name ?? 'Team A') : (event?.team_b_name ?? 'Team B'));
  /** A day's golfers: its own list, or (older days) everyone in the event. */
  const golfersOf = (r: RoundRow) => (roundGolfers[r.id]?.length ? roundGolfers[r.id] : seasonPlayers.map((p) => p.id));
  const lastRound = $derived(rounds.at(-1));
  /** "Same as Day N": the last day's golfers (everyone for the first day). */
  const sameGolfers = $derived(lastRound ? golfersOf(lastRound) : seasonPlayers.map((p) => p.id));
  /** Season days of 2 or 3 golfers play an individual game (1 v 1 or 2 v 1); 4+ play fourballs. */
  const seasonGameDay = (r: RoundRow) => season && golfersOf(r).length <= 3;
  const savedPlaying = $derived(playingIds.filter((id) => members[id].team).length);
  const fourballs = $derived(Math.floor(savedPlaying / 4));
  const pairingStatus = (r: RoundRow) => {
    const done = paired[r.id] ?? 0;
    if (individual) return done > 0 ? `${done} group${done === 1 ? '' : 's'} set ✓` : 'Groups not set yet';
    if (seasonGameDay(r)) return done > 0 ? 'Group set ✓' : 'Group not set yet';
    if (fourballs > 0 && done >= fourballs) return 'Pairings set ✓';
    if (done > 0) return `${done} of ${fourballs} fourballs paired`;
    return 'Pairings not set yet';
  };
  const GAMES = { matchplay: 'Match play', stableford: 'Stableford', flat: 'Match play, flat', scramble: '2-man scramble' } as const;
  const roundDate = (d: string | null) =>
    d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'No date';
  /** The games a day needs: by its groups' sizes, or before groups are set by how many are playing. */
  const gamesOf = (r: RoundRow) =>
    season ? { pair: golfersOf(r).length === 2, three: golfersOf(r).length === 3 } : gamesToSet(groupSizes[r.id] ?? [], playingIds.length);
  const roundGame = (r: RoundRow) =>
    individual || seasonGameDay(r)
      ? [gamesOf(r).pair && gameLabel(r.pair_game), gamesOf(r).three && gameLabel(r.three_game)].filter(Boolean).join(' · ')
    : r.fourball_format === 'matchplay' ? `${GAMES.matchplay} ${Number(r.allowance_pct)}%`
    : r.fourball_format === 'scramble' ? `${GAMES.scramble} ${Number(r.scramble_low_pct)}/${Number(r.scramble_high_pct)}`
    : GAMES[r.fourball_format];
  const guideFor = (r: RoundRow) => courseGuide(courseName(r.course_id), photoCourses());
  /** Players in this event with a photo, for the photo switch. */
  const withPhotos = $derived(playingIds.filter((id) => db.players.find((p) => p.id === id)?.photo_path).length);
  const shown = $derived(db.players.filter((p) => members[p.id] && p.name.toLowerCase().includes(search.trim().toLowerCase())));
  const shownGroups = $derived(favouritesFirst(shown, favs));
  /** Star or unstar a player for this admin (shown at once; put back if the save fails). */
  async function toggleFav(id: string) {
    const was = favs;
    const on = !was.includes(id);
    favs = on ? [...was, id] : was.filter((x) => x !== id);
    try {
      if (on) await must(supabase.from('player_favourites').insert({ player_id: id }));
      else await must(supabase.from('player_favourites').delete().eq('player_id', id));
    } catch (e) {
      favs = was;
      msg = `Error: ${(e as Error).message}`;
      msgAt = null;
    }
  }
  const onTeam = (t: 'A' | 'B') => playingIds.filter((id) => members[id].team === t);
  const countA = $derived(onTeam('A').length);
  const countB = $derived(onTeam('B').length);
  const unassigned = $derived(playingIds.filter((id) => !members[id].team));
  const avg = (ids: string[]) => (ids.length ? (ids.reduce((sum, id) => sum + Number(members[id].handicap), 0) / ids.length).toFixed(1) : '–');
  const setAll = (on: boolean) => {
    for (const m of Object.values(members)) m.playing = on;
  };

  const saveDetails = (at: 'event' | 'more') =>
    act(async () => {
      const ev = event!;
      // Only one active event is allowed (unique index): deactivate the others first.
      if (ev.is_active) await must(supabase.from('events').update({ is_active: false }).neq('id', ev.id));
      await must(
        supabase
          .from('events')
          .update({
            name: ev.name,
            team_a_name: ev.team_a_name,
            team_a_colour: ev.team_a_colour,
            team_b_name: ev.team_b_name,
            team_b_colour: ev.team_b_colour,
            is_active: ev.is_active,
            show_form: ev.show_form,
            show_leaderboard: ev.show_leaderboard,
            show_photos: ev.show_photos,
          })
          .eq('id', ev.id),
      );
    }, 'Event saved', at);

  /** 2 or 3 players: everyone ticked plays with no team, the event becomes individual, and each day gets its group. */
  const savePlayers = () =>
    act(async () => {
      await must(supabase.from('events').update({ kind: 'individual' }).eq('id', eventId));
      const entries = Object.entries(members);
      const rows = entries.filter(([, m]) => m.playing).map(([player_id, m]) => ({ event_id: eventId, player_id, team: null, handicap: Number(m.handicap) }));
      const removed = entries.filter(([, m]) => !m.playing).map(([id]) => id);
      if (rows.length) await must(supabase.from('event_players').upsert(rows));
      if (removed.length) await must(supabase.from('event_players').delete().eq('event_id', eventId).in('player_id', removed));
      const grouped = await groupEveryDay(rounds);
      return grouped.length ? `Players saved · group set for ${grouped.join(', ')}` : 'Players saved';
    }, 'Players saved', 'players').then((ok) => ok && (playersOpen = false));

  /**
   * 2 or 3 players are one group, so make it on every day (P1, P2, P3 in name order). A day whose group already
   * has these players (e.g. the admin chose the single) or whose game is confirmed is left alone.
   */
  async function groupEveryDay(days: RoundRow[]): Promise<string[]> {
    const ids = playingIds;
    if (eventKindFor(ids.length) !== 'individual') return [];
    const done: string[] = [];
    for (const r of days) {
      const gs = (await must(
        supabase.from('groups').select('group_no, group_players(player_id), match_results(match_type)').eq('round_id', r.id),
      )) as { group_no: number; group_players: { player_id: string }[]; match_results: unknown[] }[];
      if (gs.some((g) => g.match_results.length)) continue;
      const g1 = gs.find((g) => g.group_no === 1);
      const same = g1 && g1.group_players.length === ids.length && g1.group_players.every((gp) => ids.includes(gp.player_id));
      if (!same) {
        await must(supabase.rpc('save_group', { p_round_id: r.id, p_group_no: 1, p_tee_time: null, p_slots: ids.map((player_id, i) => ({ slot: `P${i + 1}`, player_id })) }));
      }
      if (gs.some((g) => g.group_no > 1)) await must(supabase.from('groups').delete().eq('round_id', r.id).gt('group_no', 1));
      done.push(r.name);
    }
    return done;
  }

  const saveMembers = async () => {
    if (await saveTeams()) playersOpen = false; // saved: fold the section away
    // More than one fourball can't be paired automatically: point at any day still needing pairings.
    if (!msg?.startsWith('Error') && savedPlaying > 4) nudge = rounds.find((r) => (paired[r.id] ?? 0) < fourballs) ?? null;
  };
  const saveTeams = () =>
    act(async () => {
      if (individual) await must(supabase.from('events').update({ kind: 'team' }).eq('id', eventId));
      const entries = Object.entries(members);
      const rows = entries
        .filter(([, m]) => m.playing && m.team)
        .map(([player_id, m]) => ({ event_id: eventId, player_id, team: m.team, handicap: Number(m.handicap) }));
      const removed = entries.filter(([, m]) => !m.playing || !m.team).map(([id]) => id);
      if (rows.length) await must(supabase.from('event_players').upsert(rows));
      if (removed.length) await must(supabase.from('event_players').delete().eq('event_id', eventId).in('player_id', removed));
      const paired = await pairTwoVTwo(rounds);
      return paired.length ? `Teams saved · pairings set for ${paired.join(', ')}` : 'Teams saved';
    }, 'Teams saved', 'players');

  /**
   * Two players a side means only one possible fourball, so pair it on every day (the pairing then follows any
   * change of teams). Days whose match is confirmed are left alone. Returns the names of the days paired.
   */
  async function pairTwoVTwo(days: RoundRow[]): Promise<string[]> {
    // Season days pick their own golfers (and are grouped when added), so saving teams never re-pairs them.
    if (individual || season) return [];
    const slots = autoFourball(
      Object.entries(members)
        .filter(([, m]) => m.playing && m.team)
        .map(([playerId, m]) => ({ playerId, team: m.team as 'A' | 'B', handicap: Number(m.handicap) })),
    );
    if (!slots) return [];
    const paired: string[] = [];
    for (const r of days) {
      const [g] = (await must(
        supabase.from('groups').select('tee_time, match_results(match_type)').eq('round_id', r.id).eq('group_no', 1),
      )) as { tee_time: string | null; match_results: unknown[] }[];
      if (g?.match_results.length) continue;
      await must(supabase.rpc('save_group', { p_round_id: r.id, p_group_no: 1, p_tee_time: g?.tee_time ?? null, p_slots: slots }));
      paired.push(r.name);
    }
    return paired;
  }

  /** Add a day from the form (fully set: course, tees, holes, golfers and game), then its group where it has one. */
  const addRound = (p: AddRoundPayload) => {
    const next = Math.max(0, ...rounds.map((r) => r.round_no)) + 1;
    void act(async () => {
      const added = (await must(
        supabase
          .from('rounds')
          .insert({ ...p.round, event_id: eventId, round_no: next, name: p.name, course_id: p.course_id, date: p.date })
          .select()
          .single(),
      )) as RoundRow;
      if (season && p.golfers && p.day) return seasonGroup(added, p.golfers, p.day);
      const paired = individual ? await groupEveryDay([added]) : await pairTwoVTwo([added]);
      return paired.length ? `Round added · ${individual ? 'group' : 'pairings'} set for ${added.name}` : 'Round added';
    }, 'Round added').then(() => {
      adding = false;
    });
  };


  /**
   * Season events: save a day's golfers, then its group — a 1 v 1 or 2 v 1 (the single first) is one group;
   * 4 golfers split 2–2 are one fourball. Other fourball days are paired on the pairings page.
   */
  async function seasonGroup(r: RoundRow, ids: string[], day: SeasonDay): Promise<string> {
    await must(supabase.from('round_players').delete().eq('round_id', r.id));
    if (ids.length) await must(supabase.from('round_players').insert(ids.map((player_id) => ({ round_id: r.id, player_id }))));
    let slots: { slot: string; player_id: string }[] | null = null;
    if ('format' in day && day.format !== 'fourballs') {
      const ordered = day.format === 'two_v_one' ? [day.single, ...ids.filter((id) => id !== day.single)] : ids;
      slots = ordered.map((player_id, i) => ({ slot: `P${i + 1}`, player_id }));
    } else if ('format' in day) {
      slots = autoFourball(ids.map((playerId) => ({ playerId, team: seasonTeamOf[playerId], handicap: Number(savedPlayers.find((x) => x.player_id === playerId)?.handicap ?? 0) })));
    }
    if (!slots) {
      // Not one group (e.g. 5+ golfers): the day's old groups go; pair it on the pairings page.
      await must(supabase.from('groups').delete().eq('round_id', r.id));
      return `${r.name}: golfers saved`;
    }
    await must(supabase.rpc('save_group', { p_round_id: r.id, p_group_no: 1, p_tee_time: null, p_slots: slots }));
    await must(supabase.from('groups').delete().eq('round_id', r.id).gt('group_no', 1));
    return `Round added · group set for ${r.name}`;
  }
  const saveGolfers = (r: RoundRow) => {
    const ids = editGolfers[r.id] ?? golfersOf(r);
    return act(async () => {
      await seasonGroup(r, ids, seasonDayCheck(ids, seasonTeamOf));
      delete editGolfers[r.id];
    }, `${r.name} golfers saved`, `golfers:${r.id}`).then((ok) => ok && (openGolfers[r.id] = false)); // the day stays open: its game may need choosing
  };

  /** Season events: the event's points for each format (a win and a halve each). */
  const POINT_ROWS = [
    { key: 'fourball', label: 'Fourball' },
    { key: 'singles', label: 'Singles' },
    { key: 'one_v_one', label: '1 v 1' },
    { key: 'two_v_one_single', label: '2 v 1 single' },
    { key: 'two_v_one_pair', label: 'The pair' },
  ] as const;
  const savePoints = () =>
    act(async () => {
      const pts = Object.fromEntries(
        POINT_ROWS.map(({ key }) => [key, { win: Number(event!.points[key].win), halve: Number(event!.points[key].halve) }]),
      );
      await must(supabase.from('events').update({ points: pts }).eq('id', eventId));
    }, 'Points saved', 'points');

  /** Holes played: all 18 (null), the front 9, 1–13, or a chosen set (e.g. winter: 1–9, 14 and 18). */
  const ALL_HOLES = Array.from({ length: 18 }, (_, i) => i + 1);
  const range = (to: number) => ALL_HOLES.filter((h) => h <= to);
  /** Which holes choice a day is on (a chosen set is remembered while it's being edited). */
  let choosingHoles = $state<Record<string, boolean>>({});
  function holesMode(r: RoundRow): 'all' | 'front' | 'thirteen' | 'custom' {
    if (choosingHoles[r.id]) return 'custom';
    const h = r.holes ?? null;
    if (!h || h.length >= 18) return 'all';
    if (h.join() === range(9).join()) return 'front';
    if (h.join() === range(13).join()) return 'thirteen';
    return 'custom';
  }
  function setHolesMode(r: RoundRow, mode: 'all' | 'front' | 'thirteen' | 'custom') {
    choosingHoles[r.id] = mode === 'custom';
    if (mode === 'all') r.holes = null;
    else if (mode === 'front') r.holes = range(9);
    else if (mode === 'thirteen') r.holes = range(13);
    else r.holes = r.holes?.length ? r.holes : [...ALL_HOLES];
  }
  function toggleHole(r: RoundRow, hole: number, on: boolean) {
    const current = r.holes?.length ? r.holes : [...ALL_HOLES];
    r.holes = on ? [...new Set([...current, hole])].sort((a, b) => a - b) : current.filter((h) => h !== hole);
  }

  const saveRound = (r: RoundRow) =>
    act(
      () =>
        must(
          supabase
            .from('rounds')
            .update({
              name: r.name,
              course_id: r.course_id,
              date: r.date || null,
              allowance_pct: Number(r.allowance_pct),
              better_ball_points: Number(r.better_ball_points),
              singles_enabled: r.singles_enabled,
              singles_points: Number(r.singles_points),
              singles_allowance_pct: Number(r.singles_allowance_pct),
              singles_pairing: r.singles_pairing,
              fourball_format: r.fourball_format,
              holes: r.holes?.length && r.holes.length < 18 ? r.holes : null,
              pair_game: r.pair_game,
              three_game: r.three_game,
              stableford_pct: Number(r.stableford_pct),
              match_pct: Number(r.match_pct),
              match_off_low: r.match_off_low,
              scramble_low_pct: Number(r.scramble_low_pct),
              scramble_high_pct: Number(r.scramble_high_pct),
            })
            .eq('id', r.id),
        ).then(async () => {
          // A different course: players' tees from the old course no longer apply.
          const tees = teesOf(db.courses, courseName(r.course_id)).map((t) => t.id);
          await must(supabase.from('round_tees').delete().eq('round_id', r.id).not('course_id', 'in', `(${tees.join(',')})`));
          // By handicap means the straight line-up for every group (random/chosen are set on the pairings page).
          if (r.singles_pairing === 'handicap') await must(supabase.from('groups').update({ singles_crossed: false }).eq('round_id', r.id));
        }),
      `${r.name} saved`,
      `round:${r.id}`,
    ).then((ok) => ok && (openRounds[r.id] = false)); // saved: fold the day away
</script>

<p><a href="#/admin/events">← Events</a></p>
{#if msg && !msgAt}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

{#if event}
  <section class="card">
    <h2>Event</h2>
    <div class="field"><label for="evn">Name</label><input id="evn" bind:value={event.name} /></div>
    {#if !individual}
    <div class="teams">
      <div class="field">
        <label for="ta">Team A name</label>
        <span class="team"><input id="ta" bind:value={event.team_a_name} /><input aria-label="Team A colour" type="color" bind:value={event.team_a_colour} /></span>
      </div>
      <div class="field">
        <label for="tb">Team B name</label>
        <span class="team"><input id="tb" bind:value={event.team_b_name} /><input aria-label="Team B colour" type="color" bind:value={event.team_b_colour} /></span>
      </div>
    </div>
    {/if}
    <label class="setting"><span>Active event<span class="sub">Shown on the leaderboard</span></span><input class="switch" type="checkbox" bind:checked={event.is_active} /></label>
    <button onclick={() => saveDetails('event')}>Save event</button>
    {#if msg && msgAt === 'event'}<p class="saved" class:error={msg.startsWith('Error')}>{msg}</p>{/if}
  </section>

  {#if season}
    <!-- Every season day uses these points: 1 v 1 and 2 v 1 days count for the teams too. -->
    <section class="card" data-testid="season-points">
      <h2>Points for each format</h2>
      <div class="ptable">
        <span></span><span class="h">Win</span><span class="h">Halve</span>
        {#each POINT_ROWS as row (row.key)}
          <span class="fmt">{row.label}</span>
          <input type="number" step="0.5" min="0" aria-label="{row.label} win" bind:value={event.points[row.key].win} />
          <input type="number" step="0.25" min="0" aria-label="{row.label} halve" bind:value={event.points[row.key].halve} />
        {/each}
      </div>
      <button onclick={savePoints}>Save points</button>
      {#if msg && msgAt === 'points'}<p class="saved" class:error={msg.startsWith('Error')}>{msg}</p>{/if}
    </section>
  {/if}

  <ShareLink {event} />

  <details class="card fold" bind:open={playersOpen}>
    <summary class="tile">
      {#if individual || smallGroup}
        <span><h2>Players</h2><span class="sub">{playingIds.length} playing{smallGroup ? ` · a ${playingIds.length}-ball` : ''}</span></span>
        <span class="pill" class:todo={playingIds.length < 2}>{playingIds.length >= 2 ? 'Players ✓' : 'Pick players'}</span>
      {:else}
        <span><h2>Players</h2><span class="sub">{savedPlaying} playing · {countA} v {countB}</span></span>
        <span class="pill" class:todo={!savedPlaying || unassigned.length > 0}>{savedPlaying && !unassigned.length ? 'Teams ✓' : 'Set teams'}</span>
      {/if}
    </summary>
    {#if !smallGroup}
    <div class="steps" role="tablist">
      <button role="tab" aria-selected={teamStep === 'who'} class:on={teamStep === 'who'} onclick={() => (teamStep = 'who')}>
        1 · Who's playing{teamStep === 'teams' && playingIds.length ? ' ✓' : ''}
      </button>
      <button role="tab" aria-selected={teamStep === 'teams'} class:on={teamStep === 'teams'} onclick={() => (teamStep = 'teams')}>2 · Teams</button>
    </div>
    {/if}

    {#if smallGroup || teamStep === 'who'}
      <p class="muted small">Tick everyone taking part. Handicap indexes are set on the <a href="#/admin/players">Players</a> page.</p>
      <input class="search" type="search" placeholder="Search players" bind:value={search} />
      <div class="pickbar">
        <strong>{playingIds.length} of {db.players.length} playing</strong>
        <span><button class="linkbtn" onclick={() => setAll(true)}>Select all</button><button class="linkbtn" onclick={() => setAll(false)}>Clear</button></span>
      </div>
      {#if smallGroup}
        <p class="muted small">2 or 3 players play one group: a 2-ball or 3-ball game. Pick 4 or more for teams and fourballs.</p>
        <button class="wide top" onclick={savePlayers}>Save players</button>
      {:else}
        <button class="wide top" disabled={!playingIds.length} onclick={() => ((teamStep = 'teams'), (search = ''))}>Next: pick teams ({playingIds.length}) →</button>
      {/if}
      <!-- Favourites first; scrolls inside its box (about 9 rows), headings pinned. -->
      <div class="picklist" data-testid="picklist">
        {#each [['Favourites', shownGroups.favourites], [shownGroups.favourites.length ? 'Everyone else' : '', shownGroups.others]] as const as [heading, list] (heading)}
          {#if heading && list.length}<div class="pickhead">{heading}{heading === 'Favourites' ? ` (${list.length})` : ''}</div>{/if}
          {#each list as p (p.id)}
            {@const fav = favs.includes(p.id)}
            <div class="pick" class:sel={members[p.id].playing} data-testid="pick-row">
              <label class="pickhit">
                <input type="checkbox" aria-label="{p.name} playing" bind:checked={members[p.id].playing} />
                <span class="pname">{p.name}</span>
                <span class="hcp">{members[p.id].handicap}</span>
              </label>
              <button class="star" class:on={fav} aria-label="{fav ? 'Unfavourite' : 'Favourite'} {p.name}" aria-pressed={fav} onclick={() => toggleFav(p.id)}>{fav ? '★' : '☆'}</button>
            </div>
          {/each}
        {/each}
        {#if !shown.length}<p class="muted small empty">No players match “{search}”.</p>{/if}
      </div>
    {:else}
      <div class="totals">
        <div class="tot" style="background:{event.team_a_colour}" data-testid="team-count-A"><span>{event.team_a_name}</span><strong>{countA}</strong><span>avg index {avg(onTeam('A'))}</span></div>
        <div class="tot" style="background:{event.team_b_colour}" data-testid="team-count-B"><span>{event.team_b_name}</span><strong>{countB}</strong><span>avg index {avg(onTeam('B'))}</span></div>
      </div>
      {#if countA === 2 && countB === 2}<p class="muted small">One fourball: it's paired automatically when you save.</p>{/if}
      <button class="wide top" disabled={unassigned.length > 0} onclick={saveMembers}>Save teams</button>

      {#if unassigned.length}<p class="warn">{unassigned.length} {unassigned.length === 1 ? 'player' : 'players'} not on a team yet</p>{/if}
      {#if !playingIds.length}<p class="muted">Nobody's playing yet — tick players in step 1.</p>{/if}
      <!-- In name order, fixed: rows don't move as teams are picked. -->
      {#each playingIds as id (id)}
        {@const p = db.players.find((x) => x.id === id)}
        <div class="teamrow" data-testid="team-row">
          <span class="pname">{p?.name}<br /><span class="hcp small">{members[id].handicap}</span></span>
          <span class="seg">
            <button aria-label="{p?.name}: {event.team_a_name}" aria-pressed={members[id].team === 'A'} style={members[id].team === 'A' ? `background:${event.team_a_colour};color:#fff` : ''} onclick={() => (members[id].team = 'A')}>{event.team_a_name}</button>
            <button aria-label="{p?.name}: {event.team_b_name}" aria-pressed={members[id].team === 'B'} style={members[id].team === 'B' ? `background:${event.team_b_colour};color:#fff` : ''} onclick={() => (members[id].team = 'B')}>{event.team_b_name}</button>
          </span>
        </div>
      {/each}
    {/if}
  </details>
  {#if msg && msgAt === 'players'}<p class="saved" class:error={msg.startsWith('Error')}>{msg}</p>{/if}

  <section class="card">
    <div class="rhead">
      <h2>Rounds</h2>
      {#if !adding}<button class="addbtn" onclick={() => (adding = true)}>+ Add round</button>{/if}
    </div>
    {#each rounds as r (r.id)}
      <details class="round" bind:open={openRounds[r.id]} data-testid="round">
        <summary class="tile">
          <span><strong>{r.name} · {courseName(r.course_id)}</strong><span class="sub">{roundDate(r.date)}{season ? ` · ${golfersOf(r).length} golfers` : ''}{r.holes?.length && r.holes.length < 18 ? ` · ${r.holes.length} holes` : ''} · {roundGame(r)}</span></span>
          <span class="pill" class:todo={!pairingStatus(r).endsWith('✓')}>{pairingStatus(r).replace('Pairings set ✓', 'Paired ✓').replace('Pairings not set yet', 'Not paired').replace(' fourballs paired', ' paired')}</span>
        </summary>
        <div class="row">
          <div class="field"><label for="rn-{r.id}">Name</label><input id="rn-{r.id}" bind:value={r.name} /></div>
          <div class="field"><label for="rd-{r.id}">Date</label><input id="rd-{r.id}" type="date" bind:value={r.date} /></div>
        </div>
        <div class="field">
          <label for="rc-{r.id}">Course</label>
          <select id="rc-{r.id}" value={courseName(r.course_id)} onchange={(e) => (r.course_id = teesOf(db.courses, (e.currentTarget as HTMLSelectElement).value)[0].id)}>
            {#each courseGroups(db.courses) as g (g.name)}<option value={g.name}>{g.name}</option>{/each}
          </select>
        </div>
        {#if teesOf(db.courses, courseName(r.course_id)).some((t) => t.tee)}
          <div class="field">
            <label for="rt-{r.id}">Tees</label>
            <select id="rt-{r.id}" bind:value={r.course_id}>
              {#each teesOf(db.courses, courseName(r.course_id)) as t (t.id)}<option value={t.id}>{t.tee ?? 'Main'} tees</option>{/each}
            </select>
          </div>
          <details class="player-tees">
            <summary>Players on different tees</summary>
            <p class="muted small">Everyone plays the tees above unless picked here. Save the round first if you changed its course or tees.</p>
            {#each Object.entries(members).filter(([, m]) => m.playing && (m.team || individual)) as [pid] (pid)}
              {@const p = db.players.find((x) => x.id === pid)}
              <div class="member">
                <span class="pname">{p?.name}</span>
                <select
                  aria-label="{p?.name} tee on {r.name}"
                  value={teeOfPlayer(r.id, pid)}
                  disabled={lockedIn(r.id, pid)}
                  onchange={(e) => setPlayerTee(r, pid, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">Main tee</option>
                  {#each teesOf(db.courses, courseName(r.course_id)).filter((t) => t.id !== r.course_id) as t (t.id)}<option value={t.id}>{t.tee} tees</option>{/each}
                </select>
              </div>
            {/each}
          </details>
        {/if}
        <!-- Holes played: all 18, or fewer (e.g. a quick 9, or winter: 1–9, 14 and 18). Handicaps scale to them. -->
        <fieldset class="holes">
          <legend>Holes played</legend>
          {#each [['all', 'All 18'], ['front', 'Front 9'], ['thirteen', '1–13'], ['custom', 'Choose holes']] as [mode, label] (mode)}
            <label class="choice"><input type="radio" name="holes-{r.id}" checked={holesMode(r) === mode} onchange={() => setHolesMode(r, mode as 'all' | 'front' | 'thirteen' | 'custom')} /> {label}</label>
          {/each}
          {#if holesMode(r) === 'custom'}
            <div class="holegrid">
              {#each ALL_HOLES as h (h)}
                <label class="hole" class:on={(r.holes ?? ALL_HOLES).includes(h)}>
                  <input type="checkbox" aria-label="Play hole {h}" checked={(r.holes ?? ALL_HOLES).includes(h)} onchange={(e) => toggleHole(r, h, (e.currentTarget as HTMLInputElement).checked)} />{h}
                </label>
              {/each}
            </div>
          {/if}
          {#if holesMode(r) === 'custom' && !r.holes?.length}<p class="error small">Pick at least one hole.</p>{/if}
          {#if r.holes?.length && r.holes.length < 18}<p class="muted small"><span data-testid="holes-count">{r.holes.length} holes</span> · handicaps scale to {r.holes.length}/18.</p>{/if}
        </fieldset>
        {#if guideFor(r)}
          <a class="guidebtn" href="#/admin/events/{eventId}/guide/{r.course_id}">View course guide →</a>
        {:else}
          <p class="muted small">No course guide yet · <a href="#/admin/guide/{r.course_id}">add photos</a></p>
        {/if}
        {#if season}
          <details class="player-tees" data-testid="day-golfers" bind:open={openGolfers[r.id]}>
            <summary>Golfers ({golfersOf(r).length})</summary>
            {#if editGolfers[r.id]}
              <SeasonGolfers players={seasonPlayers} {teamName} bind:selected={editGolfers[r.id]} />
              <button disabled={!('format' in seasonDayCheck(editGolfers[r.id], seasonTeamOf))} onclick={() => saveGolfers(r)}>Save golfers</button>
            {:else}
              <p class="small">{golfersOf(r).map((id) => db.players.find((p) => p.id === id)?.short_name ?? '?').join(', ')}</p>
              <button class="secondary" disabled={golfersOf(r).some((id) => lockedIn(r.id, id))} onclick={() => (editGolfers[r.id] = [...golfersOf(r)])}>Change golfers</button>
            {/if}
          </details>
          {#if msg && msgAt === `golfers:${r.id}`}<p class="saved" class:error={msg.startsWith('Error')}>{msg}</p>{/if}
        {/if}
        {#if individual || seasonGameDay(r)}
          {@const games = gamesOf(r)}
          {@const both = games.pair && games.three}
          {#if games.pair}
            <div class="field">
              <label for="rpg-{r.id}">{both ? 'Game for groups of 2' : '2-player game'}</label>
              <select id="rpg-{r.id}" bind:value={r.pair_game}>
                {#each gamesFor(2, { teams: !individual, rows: db.games, keep: r.pair_game }) as g (g.key)}<option value={g.key}>{g.name}</option>{/each}
              </select>
            </div>
            {#if r.pair_game === 'stableford_match'}
              <label class="row"><input type="checkbox" bind:checked={r.match_off_low} /> Stableford match play off the low man</label>
              {#if r.match_off_low}
                <div class="field"><label for="rmp-{r.id}">Low man %</label><input id="rmp-{r.id}" type="number" min="0" max="100" bind:value={r.match_pct} /></div>
              {/if}
            {/if}
          {/if}
          {#if games.three}
            <div class="field">
              <label for="rtg-{r.id}">{both ? 'Game for groups of 3' : '3-player game'}</label>
              <select id="rtg-{r.id}" bind:value={r.three_game}>
                {#each gamesFor(3, { teams: !individual, rows: db.games, keep: r.three_game }) as g (g.key)}<option value={g.key}>{g.name}</option>{/each}
              </select>
            </div>
            {#if r.three_game.startsWith('two_v_one')}
              <p class="muted small">2 v 1: the single against the pair's better ball. Choose who plays alone on the groups page.</p>
            {/if}
          {/if}
          {#if both}<p class="muted small">Groups of 2 play the first game, groups of 3 the second. Once the day's groups are set, only the games they need are shown.</p>{/if}
          <!-- Stableford % only matters to the games played off it. -->
          {#if (games.pair && r.pair_game === 'stableford') || (games.three && !['six_flat', 'two_v_one_flat'].includes(r.three_game))}
            <div class="field"><label for="rspc-{r.id}">Stableford %</label><input id="rspc-{r.id}" type="number" min="0" max="100" bind:value={r.stableford_pct} /></div>
          {/if}
        {:else}
        <div class="field">
          <label for="rf-{r.id}">Fourball game</label>
          <select id="rf-{r.id}" bind:value={r.fourball_format}>
            {#each gamesFor(4, { teams: true, rows: db.games, keep: fourballKey(r.fourball_format) }) as g (g.key)}<option value={g.fourballFormat}>{g.name}</option>{/each}
          </select>
        </div>
        <div class="row">
          <!-- Stableford plays off full course handicaps and flat has no shots, so the allowance doesn't apply. -->
          {#if r.fourball_format === 'matchplay'}
            <div class="field"><label for="ra-{r.id}">Allowance %</label><input id="ra-{r.id}" type="number" min="0" max="100" bind:value={r.allowance_pct} /></div>
          {/if}
          <div class="field"><label for="rp-{r.id}">Fourball pts</label><input id="rp-{r.id}" type="number" step="0.5" bind:value={r.better_ball_points} /></div>
        </div>
        {#if r.fourball_format === 'scramble'}
          <!-- Team handicap: this % of the lower partner's handicap plus this % of the higher. -->
          <div class="row">
            <div class="field"><label for="rsl-{r.id}">Low handicap %</label><input id="rsl-{r.id}" type="number" min="0" max="100" bind:value={r.scramble_low_pct} /></div>
            <div class="field"><label for="rsh-{r.id}">High handicap %</label><input id="rsh-{r.id}" type="number" min="0" max="100" bind:value={r.scramble_high_pct} /></div>
          </div>
          <p class="calc" data-testid="scramble-example">
            Example: 8 &amp; 20 → {Number(r.scramble_low_pct)}% × 8 + {Number(r.scramble_high_pct)}% × 20 =
            {((Number(r.scramble_low_pct) * 8 + Number(r.scramble_high_pct) * 20) / 100).toFixed(1)} →
            <strong>team plays off {scrambleHandicap(8, 20, Number(r.scramble_low_pct), Number(r.scramble_high_pct))}</strong>
          </p>
        {/if}
        <!-- A scramble is one ball per team, so there are no singles that day. -->
        {#if r.fourball_format !== 'scramble'}
          <label class="row"><input type="checkbox" bind:checked={r.singles_enabled} /> Also play 2 singles in each fourball</label>
        {/if}
        {#if r.singles_enabled && r.fourball_format !== 'scramble'}
          <div class="row">
            <div class="field"><label for="rsp-{r.id}">Singles pts</label><input id="rsp-{r.id}" type="number" step="0.5" bind:value={r.singles_points} /></div>
            <div class="field"><label for="rsa-{r.id}">Singles allowance %</label><input id="rsa-{r.id}" type="number" min="0" max="100" bind:value={r.singles_allowance_pct} /></div>
          </div>
          <div class="field">
            <label for="rsm-{r.id}">Singles pairings</label>
            <select id="rsm-{r.id}" bind:value={r.singles_pairing}>
              <option value="handicap">By handicap (low v low, high v high)</option>
              <option value="random">Random draw</option>
              <option value="selected">Chosen by admin</option>
            </select>
          </div>
        {/if}
        {/if}
        <button disabled={holesMode(r) === 'custom' && !r.holes?.length} onclick={() => saveRound(r)}>Save round</button>
        <!-- Pairings: who plays with whom in each fourball (scores and the leaderboard need them). -->
        <div class="pairing">
          {#if !seasonGameDay(r)}<a class="pairbtn" href="#/admin/pairings/{r.id}">{individual ? 'Set groups →' : 'Set pairings →'}</a>{/if}
          <span class="pstatus" class:ok={pairingStatus(r).endsWith('✓')} data-testid="pairing-status">{pairingStatus(r)}</span>
        </div>
      </details>
      {#if msg && msgAt === `round:${r.id}`}<p class="saved" class:error={msg.startsWith('Error')}>{msg}</p>{/if}
    {/each}

    {#if adding}
      <AddRound
        nextName="Day {Math.max(0, ...rounds.map((r) => r.round_no)) + 1}"
        courses={db.courses}
        rows={db.games}
        {season}
        players={savedPlayers.length}
        {seasonPlayers}
        unsaved={season ? playingIds.filter((id) => !seasonPlayers.some((p) => p.id === id)).length : 0}
        {sameGolfers}
        sameLabel={lastRound ? `Same as ${lastRound.name}` : `Everyone (${seasonPlayers.length})`}
        {teamName}
        points={season ? event.points : null}
        canCancel={rounds.length > 0}
        onAdd={addRound}
        onCancel={() => (adding = false)}
      />
    {/if}
  </section>

  {#if nudge}
    <div class="backdrop">
      <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="nudge-title">
        <h3 id="nudge-title">Teams saved — now set the pairings</h3>
        <p>Scores and the leaderboard won't show these players until pairings are set.</p>
        <a class="pairbtn" href="#/admin/pairings/{nudge.id}" onclick={() => (nudge = null)}>Set pairings for {nudge.name} →</a>
        <button class="secondary" onclick={() => (nudge = null)}>OK, later</button>
      </div>
    </div>
  {/if}

  <!-- Occasional settings, kept out of the way of setting up the event. -->
  <details class="more" bind:open={moreOpen}>
    <summary>More options</summary>
    <section class="card">
      <h2>What players see</h2>
      <label class="setting"><span>Leaderboard tab<span class="sub">Off: players go straight to Scores</span></span><input class="switch" type="checkbox" aria-label="Show the Leaderboard tab to players" bind:checked={event.show_leaderboard} /></label>
      <label class="setting"><span>Form tab<span class="sub">Rankings by gross, net, points, birdies…</span></span><input class="switch" type="checkbox" aria-label="Show the Form tab to players" bind:checked={event.show_form} /></label>
      <label class="setting"><span>Player photos<span class="sub">{withPhotos} of {playingIds.length} players have one · off shows initials for everyone</span></span><input class="switch" type="checkbox" aria-label="Show player photos" bind:checked={event.show_photos} /></label>
      <button onclick={() => saveDetails('more').then((ok) => ok && (moreOpen = false))}>Save settings</button>
    </section>
    {#key event.id}<ConfirmedResults {event} />{/key}
    {#if rounds.length}
      <ResetScores {event} {rounds} onDone={load} />
    {/if}
  </details>
  {#if msg && msgAt === 'more'}<p class="saved" class:error={msg.startsWith('Error')}>{msg}</p>{/if}
{:else}
  <p class="center muted">Loading…</p>
{/if}

<style>
  section h2 { margin-bottom: 10px; }
  section button { margin-top: 8px; }
  .member { display: grid; grid-template-columns: 1fr 120px 80px; gap: 6px; align-items: center; margin-bottom: 6px; }
  .steps { display: flex; gap: 6px; margin-bottom: 10px; }
  .steps button { flex: 1; min-height: 40px; background: var(--surface); color: var(--muted); border: 1px solid var(--line); font-size: 0.85rem; margin-top: 0; }
  .steps button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .pickbar { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 6px; }
  .linkbtn { background: none; color: var(--accent); min-height: 0; padding: 0 0 0 12px; margin-top: 0; }
  .picklist { border: 1px solid var(--line); border-radius: 12px; max-height: 405px; overflow-y: auto; overscroll-behavior: contain; margin-bottom: 10px; }
  .pickhead { position: sticky; top: 0; z-index: 1; background: var(--bg); color: var(--muted); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 12px; border-bottom: 1px solid var(--line); }
  .pick { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
  .pickhit { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 10px 0 10px 12px; cursor: pointer; }
  .star { background: none; color: var(--muted); min-height: 0; margin-top: 0; padding: 8px 12px; font-size: 1.2rem; line-height: 1; }
  .star.on { color: #c58a12; }
  .empty { padding: 10px 12px; margin: 0; }
  .wide.top { margin: 0 0 8px; }
  .saved { margin: 6px 2px 12px; font-weight: 600; color: var(--ok, #155d27); }
  .saved.error { color: var(--danger, #b00020); }
  .pick:last-child { border-bottom: 0; }
  .pick.sel { background: #eef5f0; }
  .pick input { width: 22px; height: 22px; accent-color: var(--accent); }
  .pickhit .pname { flex: 1; font-weight: 600; }
  .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .tot { border-radius: 12px; padding: 8px 12px; color: #fff; display: flex; flex-direction: column; }
  .tot strong { font-size: 1.4rem; }
  .tot span { font-size: 0.78rem; opacity: 0.9; }
  .warn { background: #fff4e5; border: 1px solid #f0c27a; border-radius: 10px; padding: 8px 12px; font-size: 0.85rem; }
  .teamrow { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .teamrow .pname { flex: 1; font-weight: 600; }
  .seg { display: flex; flex: none; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .seg button { margin-top: 0; min-height: 40px; border-radius: 0; background: var(--surface); color: var(--muted); padding: 6px 10px; font-size: 0.8rem; }
  .seg button + button { border-left: 1px solid var(--line); }
  .wide { width: 100%; }
  .rhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .rhead h2 { margin: 0; }
  .addbtn { margin-top: 0; min-height: 38px; padding: 8px 14px; background: var(--surface); color: var(--accent); border: 2px solid var(--accent); }
  .pairing { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .pairbtn {
    display: block; text-align: center; padding: 12px 16px; border-radius: 10px; font-weight: 700; text-decoration: none;
    background: var(--surface); color: var(--accent); border: 2px solid var(--accent);
  }
  .pstatus { font-size: 0.85rem; color: #a0521a; text-align: center; }
  .pstatus.ok { color: var(--shot-text); }
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); display: grid; place-items: center; padding: 16px; z-index: 50; }
  .dialog { max-width: 420px; width: 100%; display: flex; flex-direction: column; gap: 10px; }
  .dialog h3 { margin: 0; }
  .dialog p { margin: 0; }
  .dialog button { margin-top: 0; }
  .hcp { text-align: center; color: var(--muted); }
  .pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .round { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
  .round[open] > summary { margin-bottom: 12px; }
  .tile { display: flex; justify-content: space-between; align-items: center; gap: 10px; cursor: pointer; list-style: none; }
  .tile::-webkit-details-marker { display: none; }
  .tile > span:first-child { min-width: 0; }
  .tile strong { display: block; }
  .sub { display: block; font-size: 0.8rem; color: var(--muted); font-weight: 400; }
  .pill { flex: none; font-size: 0.75rem; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: #e3efe7; color: var(--shot-text); white-space: nowrap; }
  .pill.todo { background: #fff4e5; color: #a0521a; }
  .fold[open] > summary { margin-bottom: 12px; }
  /* Players reads as a section heading, like Rounds. */
  .fold h2 { margin: 0 0 2px; }
  .fold .sub { font-size: 0.9rem; }
  .teams { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .team { display: flex; gap: 6px; }
  .team input[type='color'] { width: 44px; flex: none; }
  .setting { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
  .setting:last-of-type { border-bottom: 0; }
  .guidebtn { display: block; text-align: center; padding: 10px 16px; margin-bottom: 12px; border-radius: 10px; font-weight: 600; text-decoration: none; border: 1.5px solid var(--accent); }
  .holes { border: 0; padding: 0; margin: 0 0 12px; }
  .holes legend { font-size: 0.9rem; color: var(--muted); margin-bottom: 4px; padding: 0; }
  .holegrid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin: 6px 0; }
  .hole { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 0.8rem; padding: 4px 0; border: 1px solid var(--line); border-radius: 8px; margin: 0; }
  .hole.on { border-color: var(--accent); background: #e3efe7; }
  .hole input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
  .ptable { display: grid; grid-template-columns: 1fr 72px 72px; gap: 6px 8px; align-items: center; margin-bottom: 8px; }
  .ptable .h { font-size: 0.75rem; color: var(--muted); text-align: center; }
  .ptable .fmt { font-weight: 600; font-size: 0.9rem; }
  .choice { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .choice input { width: 18px; height: 18px; margin: 0; }
  .calc { background: #e3efe7; border-radius: 10px; padding: 8px 12px; font-size: 0.85rem; margin: 0 0 12px; font-variant-numeric: tabular-nums; }
  .player-tees summary { cursor: pointer; font-weight: 600; margin: 4px 0 8px; }
  .more summary { cursor: pointer; font-weight: 700; padding: 12px 0; color: var(--muted); }
  input[type='color'] { padding: 4px; }
</style>
