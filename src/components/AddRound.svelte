<script lang="ts" module>
  import type { SeasonDay as Day } from '../lib/scoring';
  import type { RoundRow as Round } from '../lib/data/types';
  /** What the form hands back: the day's basics, its golfers (season events) and its round fields. */
  export interface AddRoundPayload {
    name: string;
    date: string | null;
    course_id: string;
    golfers: string[] | null;
    day: Day | null;
    round: Partial<Round>;
    /** "I'll choose" singles on a one-fourball day: true = A1 v B2 & A2 v B1. */
    singlesCrossed: boolean;
  }
</script>

<script lang="ts">
  // Add a day, filling in as you go: when and where → tees and holes → who's playing (season events) → the
  // game for that many golfers and its settings. The day is fully set before it's added.
  import SeasonGolfers from './SeasonGolfers.svelte';
  import SinglesSettings from './SinglesSettings.svelte';
  import { singlesLineup } from '../lib/singles';
  import { courseGroups, defaultTee, teesOf } from '../lib/courses';
  import { defaultsFor, gameInfo, gamesFor, newRoundDefaults, type GameRow, type SettingKey } from '../lib/games';
  import { holesFor, type HolesMode } from '../lib/holes';
  import { seasonDayCheck, type SeasonDay, type SeasonPoints, type Team } from '../lib/scoring';
  import { formatPoints } from '../lib/scoring';
  import type { CourseRow, RoundRow } from '../lib/data/types';


  let {
    nextName,
    courses,
    rows,
    season,
    players,
    seasonPlayers,
    unsaved = 0,
    sameGolfers,
    sameLabel,
    teamName,
    points,
    canCancel,
    fourballFor,
    nameOf,
    onAdd,
    onCancel,
  }: {
    nextName: string;
    courses: CourseRow[];
    rows: GameRow[];
    season: boolean;
    /** Normal events: how many players the event has (2 or 3 → one individual group; 4+ → fourballs). */
    players: number;
    seasonPlayers: { id: string; name: string; short: string; team: Team }[];
    /** Season events: players ticked on Who's playing whose teams aren't saved yet (not offered for a day). */
    unsaved?: number;
    sameGolfers: string[];
    sameLabel: string;
    teamName: (t: Team) => string;
    points: SeasonPoints | null;
    canCancel: boolean;
    /** The day's one fourball if its golfers (null: the event's players) are exactly 2 a side; else null. */
    fourballFor: (golfers: string[] | null) => { a: string[]; b: string[] } | null;
    nameOf: (id: string) => string;
    onAdd: (p: AddRoundPayload) => void;
    onCancel: () => void;
  } = $props();

  let name = $state('');
  let date = $state('');
  let course = $state('');
  let courseId = $state('');
  let holesMode = $state<HolesMode>('all');
  let holesTo = $state(13);
  let chosenHoles = $state<number[]>(Array.from({ length: 18 }, (_, i) => i + 1));
  let golferMode = $state<'same' | 'different'>('same');
  let newGolfers = $state<string[]>([]);
  let game = $state('');
  let settings = $state<Partial<Record<SettingKey, number | boolean>>>({});
  // Singles in each fourball (4+ golfers, not a scramble).
  let singles = $state({ enabled: false, points: 0.5, pairing: 'handicap' as 'handicap' | 'random' | 'selected', crossed: false });
  const lineupText = (fb: { a: string[]; b: string[] }, crossed: boolean) =>
    singlesLineup(fb, crossed).map(([a, b]) => `${nameOf(a)} v ${nameOf(b)}`).join(' · ');

  const tees = $derived(teesOf(courses, course));
  function pickCourse(c: string) {
    course = c;
    courseId = defaultTee(teesOf(courses, c))?.id ?? '';
  }
  const holes = $derived(holesMode === 'custom' ? (chosenHoles.length && chosenHoles.length < 18 ? chosenHoles : chosenHoles.length ? null : []) : holesFor(holesMode, holesTo));

  const golfers = $derived(season ? (golferMode === 'same' ? sameGolfers : newGolfers) : null);
  const teamOf = $derived(Object.fromEntries(seasonPlayers.map((p) => [p.id, p.team])) as Record<string, Team>);
  const day = $derived(golfers ? seasonDayCheck(golfers, teamOf) : null);
  /** Golfers in a group for the game: the day's (season) or the event's (normal); null = can't tell yet. */
  const size = $derived.by((): 2 | 3 | 4 | null => {
    const n = golfers ? (day && 'format' in day ? golfers.length : 0) : players;
    return n >= 4 ? 4 : n === 3 ? 3 : n === 2 ? 2 : null;
  });
  // Team events (season, or 4+ fourballs) never offer the six pointer.
  /** One fourball (2 a side, teams set): its singles line-up can be picked here. */
  const sole = $derived(size === 4 ? fourballFor(season ? golfers : null) : null);
  const options = $derived(size ? gamesFor(size, { teams: season || size === 4, rows }) : []);
  $effect(() => {
    if (options.length && !options.some((g) => g.key === game)) chooseGame(options[0].key);
  });
  function chooseGame(key: string) {
    game = key;
    settings = { ...defaultsFor(key, rows) };
  }
  const chosen = $derived(gameInfo(game));
  const uses = (k: SettingKey) => chosen?.defaults[k] !== undefined;

  /** What the game is worth in a season event. */
  const worth = $derived.by(() => {
    if (!season || !points || !size) return '';
    if (size === 2) return `Worth: ${formatPoints(points.one_v_one.win)} for a win (halve ${formatPoints(points.one_v_one.halve)})`;
    if (size === 3)
      return `Worth: single wins ${formatPoints(points.two_v_one_single.win)} (halve ${formatPoints(points.two_v_one_single.halve)}) · the pair wins ${formatPoints(points.two_v_one_pair.win)} (halve ${formatPoints(points.two_v_one_pair.halve)})`;
    return `Worth: ${formatPoints(points.fourball.win)} a fourball${singles.enabled ? `, ${formatPoints(points.singles.win)} a singles` : ''}`;
  });

  const ready = $derived(!!courseId && (holes === null || holes.length > 0) && (!season || (!!day && 'format' in day)));
  const title = $derived(name.trim() || nextName);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!ready) return;
    const round = { ...newRoundDefaults(rows, season), holes } as Partial<RoundRow>;
    if (chosen) {
      if (chosen.size === 2) round.pair_game = chosen.key as RoundRow['pair_game'];
      else if (chosen.size === 3) round.three_game = chosen.key as RoundRow['three_game'];
      else round.fourball_format = chosen.fourballFormat!;
      for (const [k, v] of Object.entries(settings)) (round as Record<string, unknown>)[k] = typeof v === 'boolean' ? v : Number(v);
      const withSingles = chosen.size === 4 && chosen.key !== 'scramble' && singles.enabled;
      round.singles_enabled = withSingles;
      if (withSingles) Object.assign(round, { singles_points: Number(singles.points), singles_allowance_pct: Number(settings.allowance_pct ?? 90), singles_pairing: singles.pairing });
    }
    const singlesCrossed = !!(round.singles_enabled && singles.pairing === 'selected' && sole && singles.crossed);
    onAdd({ name: title, date: date || null, course_id: courseId, golfers, day, round, singlesCrossed });
  }
</script>

<form class="round add" onsubmit={submit}>
  <h3>Add {title}{#if course}<small>{course}{tees.find((t) => t.id === courseId)?.tee ? ` · ${tees.find((t) => t.id === courseId)?.tee}` : ''}</small>{/if}</h3>

  <div class="step">
    <div class="pair">
      <div class="field"><label for="nrn">Name</label><input id="nrn" bind:value={name} placeholder={nextName} /></div>
      <div class="field"><label for="nrd">Date</label><input id="nrd" type="date" bind:value={date} /></div>
    </div>
    <div class="field">
      <label for="nrc">Course</label>
      <select id="nrc" value={course} required onchange={(e) => pickCourse((e.currentTarget as HTMLSelectElement).value)}>
        <option value="" disabled>Choose a course</option>
        {#each courseGroups(courses) as g (g.name)}<option value={g.name}>{g.name}</option>{/each}
      </select>
    </div>
  </div>

  {#if course}
    <div class="step">
      {#if tees.some((t) => t.tee)}
        <span class="lbl">Tees</span>
        <div class="chips">
          {#each tees as t (t.id)}
            <label class="chip" class:on={courseId === t.id}><input type="radio" name="nr-tee" aria-label="{t.tee ?? 'Main'} tees" checked={courseId === t.id} onchange={() => (courseId = t.id)} />{t.tee ?? 'Main'}</label>
          {/each}
        </div>
      {/if}
      <span class="lbl">Holes</span>
      <div class="chips">
        {#each [['all', 'All 18'], ['front', 'Front 9'], ['to', 'Holes 1 to…'], ['custom', 'Choose holes']] as [m, label] (m)}
          <label class="chip" class:on={holesMode === m}><input type="radio" name="nr-holes" aria-label={label} checked={holesMode === m} onchange={() => (holesMode = m as HolesMode)} />{label}</label>
        {/each}
      </div>
      {#if holesMode === 'to'}
        <div class="stepper">
          <span>Holes 1 to</span>
          <button type="button" class="secondary" aria-label="Fewer holes" disabled={holesTo <= 1} onclick={() => (holesTo = Math.max(1, holesTo - 1))}>−</button>
          <strong data-testid="holes-to">{holesTo}</strong>
          <button type="button" class="secondary" aria-label="More holes" disabled={holesTo >= 17} onclick={() => (holesTo = Math.min(17, holesTo + 1))}>+</button>
        </div>
      {:else if holesMode === 'custom'}
        <div class="holegrid">
          {#each Array.from({ length: 18 }, (_, i) => i + 1) as h (h)}
            <label class="hole" class:on={chosenHoles.includes(h)}>
              <input type="checkbox" aria-label="Play hole {h}" checked={chosenHoles.includes(h)} onchange={(e) => (chosenHoles = (e.currentTarget as HTMLInputElement).checked ? [...chosenHoles, h].sort((a, b) => a - b) : chosenHoles.filter((x) => x !== h))} />{h}
            </label>
          {/each}
        </div>
      {/if}
      {#if holes?.length}<p class="muted small">{holes.length} holes · handicaps scale to {holes.length}/18</p>{/if}
      {#if holes && !holes.length}<p class="error small">Pick at least one hole.</p>{/if}
    </div>

    {#if season}
      <div class="step">
        <span class="lbl">Golfers</span>
        {#if unsaved}<p class="note small">{unsaved} {unsaved === 1 ? 'player' : 'players'} picked but not saved yet — tap Save teams above to include them.</p>{/if}
        {#if seasonPlayers.length}
          <div class="seg">
            <label class:on={golferMode === 'same'}><input type="radio" name="nr-golfers" checked={golferMode === 'same'} onchange={() => (golferMode = 'same')} />{sameLabel}</label>
            <label class:on={golferMode === 'different'}><input type="radio" name="nr-golfers" checked={golferMode === 'different'} onchange={() => ((golferMode = 'different'), (newGolfers = [...sameGolfers]))} />Different golfers</label>
          </div>
          {#if golferMode === 'different'}
            <SeasonGolfers players={seasonPlayers} {teamName} bind:selected={newGolfers} />
          {:else}
            <SeasonGolfers players={seasonPlayers} {teamName} selected={sameGolfers} picking={false} />
          {/if}
        {/if}
      </div>
    {/if}

    <div class="step">
      <span class="lbl">Game</span>
      {#if !size}
        <p class="muted small">{season ? (seasonPlayers.length ? 'Pick golfers first.' : 'Save the teams first.') : 'Pick the players (Players above) to choose the game — or add the day now and set it later.'}</p>
      {:else}
        <div class="games" role="radiogroup" aria-label="Game">
          {#each options as g (g.key)}
            <label class="game" class:on={game === g.key}>
              <input type="radio" name="nr-game" aria-label={g.name} checked={game === g.key} onchange={() => chooseGame(g.key)} />
              <span><strong>{g.name}</strong><span class="sub">{g.about}</span></span>
            </label>
          {/each}
        </div>
        {#if game === 'stableford_match'}
          <label class="row setting"><input type="checkbox" bind:checked={settings.match_off_low as boolean} /> Off the low man</label>
          {#if settings.match_off_low}<div class="set"><label for="nr-mp">Low man %</label><input id="nr-mp" type="number" min="0" max="100" bind:value={settings.match_pct as number} /></div>{/if}
        {/if}
        {#if game === 'wolf_stableford'}
          <label class="row setting"><input type="checkbox" bind:checked={settings.wolf_off_low as boolean} /> Off the low (off: full handicaps)</label>
        {/if}
        {#if uses('stableford_pct')}<div class="set"><label for="nr-sp">Stableford %</label><input id="nr-sp" type="number" min="0" max="100" bind:value={settings.stableford_pct as number} /></div>{/if}
        {#if uses('allowance_pct')}<div class="set"><label for="nr-ap">Fourball allowance %</label><input id="nr-ap" type="number" min="0" max="100" bind:value={settings.allowance_pct as number} /></div>{/if}
        {#if game === 'scramble'}
          <div class="set"><label for="nr-sl">Low handicap %</label><input id="nr-sl" type="number" min="0" max="100" bind:value={settings.scramble_low_pct as number} /></div>
          <div class="set"><label for="nr-sh">High handicap %</label><input id="nr-sh" type="number" min="0" max="100" bind:value={settings.scramble_high_pct as number} /></div>
        {/if}
        {#if size === 4 && game !== 'scramble'}
          <SinglesSettings
            id="nr-singles"
            bind:enabled={singles.enabled}
            bind:points={singles.points}
            format={chosen?.fourballFormat}
            allowance={Number(settings.allowance_pct ?? 90)}
            bind:pairing={singles.pairing}
            fixedPoints={season && points ? points.singles.win : null}
            choose={sole ? lineups : undefined}
          />
        {/if}
        {#if worth}<p class="muted small">{worth}</p>{/if}
      {/if}
    </div>
  {/if}

  <div class="actions">
    <button type="submit" disabled={!ready}>Add {title}{chosen && size ? ` · ${chosen.name}` : ''}</button>
    {#if canCancel}<button type="button" class="secondary" onclick={onCancel}>Cancel</button>{/if}
  </div>
</form>

{#snippet lineups()}
  {#if sole}
    <div class="fb">
      <span class="fbt"><b>Fourball 1</b> · {nameOf(sole.a[0])} &amp; {nameOf(sole.a[1])} v {nameOf(sole.b[0])} &amp; {nameOf(sole.b[1])}</span>
      {#each [false, true] as crossed (crossed)}
        <label class="lineup" class:on={singles.crossed === crossed}>
          <input type="radio" name="nr-lineup" aria-label="Fourball 1: {lineupText(sole, crossed)}" checked={singles.crossed === crossed} onchange={() => (singles.crossed = crossed)} />
          {lineupText(sole, crossed)}
        </label>
      {/each}
    </div>
  {/if}
{/snippet}

<style>
  .add h3 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 10px; }
  .add h3 small { font-size: 0.8rem; color: var(--muted); font-weight: 500; }
  .step { border-top: 1px solid var(--line); padding: 10px 0 4px; }
  .step:first-of-type { border-top: 0; padding-top: 0; }
  .pair { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; }
  .lbl { display: block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { display: inline-flex; align-items: center; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 0.85rem; cursor: pointer; margin: 0; }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  /* The radio covers its whole chip/row (invisible), so a tap anywhere on it picks it. */
  .chip, .seg label, .game { position: relative; }
  .chip input, .seg input, .game input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .chip:has(input:focus-visible), .seg label:has(input:focus-visible), .game:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .stepper { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .stepper button { width: 40px; min-height: 40px; padding: 0; font-size: 1.2rem; }
  .stepper strong { font-size: 1.3rem; min-width: 28px; text-align: center; }
  .holegrid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin: 6px 0; }
  .hole { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 0.8rem; padding: 4px 0; border: 1px solid var(--line); border-radius: 8px; margin: 0; }
  .hole.on { border-color: var(--accent); background: #e3efe7; }
  .hole input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin-bottom: 6px; }
  .seg label { position: relative; flex: 1; text-align: center; padding: 9px 4px; font-size: 0.85rem; color: var(--muted); cursor: pointer; margin: 0; }
  .seg label + label { border-left: 1px solid var(--line); }
  .seg label.on { background: var(--accent); color: #fff; font-weight: 600; }
  .games { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .game { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; margin: 0; }
  .game::before { content: ''; flex: none; width: 14px; height: 14px; margin-top: 2px; border-radius: 50%; border: 2px solid var(--muted); }
  .game.on { border-color: var(--accent); background: #e3efe7; }
  .game.on::before { border-color: var(--accent); background: radial-gradient(var(--accent) 45%, transparent 50%); }
  .game strong { display: block; font-size: 0.9rem; }
  .game .sub { font-size: 0.78rem; color: var(--muted); }
  .set { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 6px; }
  .set label { font-size: 0.9rem; }
  .set input { width: 80px; }
  .setting { margin: 4px 0 6px; }
  .actions { display: flex; gap: 8px; margin-top: 10px; }
  .actions button[type='submit'] { flex: 1; }
  .note { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: var(--bg); color: var(--ink, inherit); }
  .fb { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 8px; display: grid; gap: 6px; }
  .fbt { font-size: 0.8rem; color: var(--muted); }
  .fbt b { color: var(--text); }
  .lineup { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; cursor: pointer; font-size: 0.9rem; }
  .lineup.on { border-color: var(--accent); background: #eef5f0; font-weight: 600; }
  .lineup input { margin: 0; accent-color: var(--accent); }
</style>
