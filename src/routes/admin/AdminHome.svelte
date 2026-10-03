<script lang="ts">
  import { isAdmin, logout } from '../../lib/auth.svelte';
  import { db } from '../../lib/data/store.svelte';
  import { GAMES } from '../../lib/games';
</script>

<h1>Admin</h1>
<p class="muted">Active event: <strong>{db.event?.name ?? 'none'}</strong></p>
{#if !isAdmin()}<p class="rolebar" data-testid="organiser-note">You're an organiser: you can run events and add players and courses.</p>{/if}

<div class="tiles">
  <a class="tile wide" href="#/admin/events"><span class="icon" aria-hidden="true">🏆</span><strong>Events</strong><span class="sub">Teams, rounds, pairings &amp; results</span></a>
  <a class="tile" href="#/admin/players"><span class="icon" aria-hidden="true">🏌️</span><strong>Players</strong><span class="sub">Handicaps</span></a>
  <a class="tile" href="#/admin/courses"><span class="icon" aria-hidden="true">⛳</span><strong>Courses</strong><span class="sub">Tees &amp; guides</span></a>
  {#if isAdmin()}
  <a class="tile wide" href="#/admin/games"><span class="icon" aria-hidden="true">🎯</span><strong>Games</strong><span class="sub">{GAMES.filter((g) => db.games.find((r) => r.key === g.key)?.enabled ?? true).length} of {GAMES.length} games on</span></a>
  <a class="tile wide quiet" href="#/admin/access"><span class="icon" aria-hidden="true">🔑</span><strong>Access</strong><span class="sub">Approve people, choose organisers</span></a>
  {/if}
</div>

{#if isAdmin()}
<button class="secondary" onclick={logout}>Sign out of admin</button>
<p class="muted small">Tip: sign out and back in with the trip password to see exactly what everyone else sees.</p>
{/if}

<style>
  .rolebar { background: #efe7f8; color: #6b3fa0; border-radius: 10px; padding: 8px 12px; font-size: 0.9rem; font-weight: 600; margin: 8px 0 0; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0 20px; }
  .tile { display: flex; flex-direction: column; gap: 2px; padding: 16px 14px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); color: var(--text); text-decoration: none; }
  .tile.wide { grid-column: 1 / -1; }
  .tile strong { font-size: 1.1rem; }
  .tile .icon { font-size: 1.5rem; line-height: 1; margin-bottom: 6px; }
  .tile .sub { color: var(--muted); font-size: 0.85rem; }
  .tile:not(.quiet):first-child { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tile:not(.quiet):first-child .sub { color: rgba(255, 255, 255, 0.85); }
  .tile.quiet { flex-direction: row; align-items: center; gap: 10px; padding: 12px 14px; margin-top: 6px; }
  .tile.quiet .icon { margin: 0; font-size: 1.2rem; }
  .tile.quiet .sub { margin-left: auto; }
</style>
