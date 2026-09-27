<script lang="ts">
  import { router } from '../lib/router.svelte';
  import { isAdmin } from '../lib/auth.svelte';

  const items = $derived([
    { href: '#/', label: 'Leaderboard', active: ['home', 'match'].includes(router.route.name) },
    { href: '#/score', label: 'Scores', active: router.route.name === 'score' },
    // Players (photo uploads) is admin-only; everyone else just sees the leaderboard and scores.
    ...(isAdmin()
      ? [
          { href: '#/players', label: 'Players', active: router.route.name === 'players' },
          { href: '#/admin', label: 'Admin', active: router.route.name.startsWith('admin') },
        ]
      : []),
  ]);
</script>

<nav>
  {#each items as item (item.href)}
    <a href={item.href} class:active={item.active}>{item.label}</a>
  {/each}
</nav>

<style>
  nav {
    position: fixed; bottom: 0; left: 0; right: 0; display: flex;
    background: var(--surface); border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom);
  }
  a {
    flex: 1; text-align: center; padding: 14px 4px; min-height: 48px;
    color: var(--muted); text-decoration: none; font-weight: 600; font-size: 0.9rem;
  }
  a.active { color: var(--accent); }
</style>
