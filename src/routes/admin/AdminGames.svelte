<script lang="ts">
  // Admin → Games: every game by group size. Switch games on/off (off: gone from every day's picker; days
  // already using a game keep it) and set the defaults a new day starts from.
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import { GAMES, defaultsFor, type GameInfo, type SettingKey } from '../../lib/games';

  const SIZES = [
    { size: 2, title: '2 golfers' },
    { size: 3, title: '3 golfers' },
    { size: 4, title: '4+ golfers' },
  ] as const;
  const LABELS: Record<SettingKey, string> = {
    match_off_low: 'Off the low man (off: full handicaps)',
    match_pct: 'Low man %',
    stableford_pct: 'Stableford %',
    allowance_pct: 'Allowance %',
    scramble_low_pct: 'Low handicap %',
    scramble_high_pct: 'High handicap %',
  };

  let editing = $state<string | null>(null);
  let draft = $state<Partial<Record<SettingKey, number | boolean>>>({});
  let msg = $state<string | null>(null);

  const enabled = (key: string) => db.games.find((g) => g.key === key)?.enabled ?? true;
  /** e.g. "Low man 85%" or "35% low · 15% high". */
  function summary(g: GameInfo): string {
    const d = defaultsFor(g.key, db.games);
    if (g.key === 'stableford_match') return d.match_off_low ? `Off the low man ${d.match_pct}%` : 'Full handicaps';
    if (g.key === 'scramble') return `${d.scramble_low_pct}% low · ${d.scramble_high_pct}% high`;
    if (d.allowance_pct !== undefined) return `Allowance ${d.allowance_pct}%`;
    if (d.stableford_pct !== undefined) return `Stableford ${d.stableford_pct}%`;
    return g.key === 'fourball_stableford' ? 'Full handicaps' : 'No shots';
  }

  async function save(key: string, row: { enabled?: boolean; defaults?: object }, ok: string) {
    msg = null;
    try {
      const current = db.games.find((g) => g.key === key);
      await must(
        supabase.from('games').upsert({ key, enabled: row.enabled ?? current?.enabled ?? true, defaults: row.defaults ?? current?.defaults ?? {} }),
      );
      await loadAll();
      msg = ok;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    }
  }
  const toggle = (g: GameInfo, on: boolean) => save(g.key, { enabled: on }, `${g.name} ${on ? 'on' : 'off'}`);
  function edit(g: GameInfo) {
    editing = editing === g.key ? null : g.key;
    draft = { ...defaultsFor(g.key, db.games) };
  }
  async function saveDefaults(g: GameInfo) {
    const defaults = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === 'boolean' ? v : Number(v)]));
    await save(g.key, { defaults }, `${g.name} saved`);
    editing = null;
  }
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Games</h1>
<p class="muted small">Every event picks its games from here. Off: gone from every day's choices (days already using it keep it). Defaults are where a new day starts — each day can still change them. Six pointers are never offered in team events.</p>
{#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

{#each SIZES as group (group.size)}
  <section class="card">
    <h2>{group.title}</h2>
    {#each GAMES.filter((g) => g.size === group.size) as g (g.key)}
      <div class="game" data-testid="game-{g.key}">
        <div class="head">
          <span class="who">
            <strong>{g.name}</strong>
            <span class="sub">{summary(g)}{g.teamOk ? '' : ' · normal events only'}</span>
          </span>
          {#if Object.keys(g.defaults).length}
            <button class="linkbtn" aria-label="Edit {g.name}" onclick={() => edit(g)}>{editing === g.key ? 'Close' : 'Edit'}</button>
          {/if}
          <input class="switch" type="checkbox" aria-label="{g.name} on" checked={enabled(g.key)} onchange={(e) => toggle(g, (e.currentTarget as HTMLInputElement).checked)} />
        </div>
        <p class="about muted small">{g.about}</p>
        {#if editing === g.key}
          <div class="defaults">
            {#each Object.keys(g.defaults) as k (k)}
              {@const key = k as SettingKey}
              {#if typeof g.defaults[key] === 'boolean'}
                <label class="row"><input type="checkbox" bind:checked={draft[key] as boolean} /> {LABELS[key]}</label>
              {:else if key !== 'match_pct' || draft.match_off_low}
                <div class="field">
                  <label for="{g.key}-{key}">{LABELS[key]}</label>
                  <input id="{g.key}-{key}" type="number" min="0" max="100" bind:value={draft[key] as number} />
                </div>
              {/if}
            {/each}
            <button aria-label="Save {g.name}" onclick={() => saveDefaults(g)}>Save</button>
          </div>
        {/if}
      </div>
    {/each}
  </section>
{/each}

<style>
  h2 { margin-bottom: 4px; }
  .game { padding: 10px 0; border-bottom: 1px solid var(--line); }
  .game:last-child { border-bottom: 0; }
  .head { display: flex; align-items: center; gap: 10px; }
  .who { flex: 1; min-width: 0; }
  .who strong { display: block; }
  .sub { display: block; font-size: 0.8rem; color: var(--muted); }
  .about { margin: 4px 0 0; }
  .linkbtn { background: none; color: var(--accent); min-height: 0; padding: 4px 6px; }
  .defaults { margin-top: 8px; padding: 10px; border-radius: 10px; background: var(--bg); }
  .defaults button { margin-top: 4px; }
</style>
