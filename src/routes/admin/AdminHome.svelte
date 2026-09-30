<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { db } from '../../lib/data/store.svelte';
</script>

<h1>Admin</h1>
<p class="muted">Active event: <strong>{db.event?.name ?? 'none'}</strong></p>

<nav class="tiles">
  <a class="tile wide" href="#/admin/events"><span class="icon" aria-hidden="true">🏆</span><strong>Events</strong><span class="sub">Teams, rounds, pairings &amp; results</span></a>
  <a class="tile" href="#/admin/players"><span class="icon" aria-hidden="true">🏌️</span><strong>Players</strong><span class="sub">Handicaps</span></a>
  <a class="tile" href="#/admin/courses"><span class="icon" aria-hidden="true">⛳</span><strong>Courses</strong><span class="sub">Tees &amp; guides</span></a>
  <a class="tile wide quiet" href="#/admin/access"><span class="icon" aria-hidden="true">🔑</span><strong>Access</strong><span class="sub">Approve or remove people</span></a>
</nav>

<button class="secondary" onclick={logout}>Sign out of admin</button>
<p class="muted small">Tip: sign out and back in with the trip password to see exactly what everyone else sees.</p>

<style>
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
