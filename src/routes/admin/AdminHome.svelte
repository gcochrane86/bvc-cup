<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { db } from '../../lib/data/store.svelte';
</script>

<h1>Admin</h1>
<p class="muted">Active event: <strong>{db.event?.name ?? 'none'}</strong></p>
<a class="card" href="#/admin/events">Events, teams, rounds &amp; pairings →</a>
<a class="card" href="#/admin/players">Players &amp; handicaps →</a>
<a class="card" href="#/admin/courses">Courses (par &amp; stroke index) →</a>
<button class="secondary" onclick={logout}>Sign out of admin</button>
<p class="muted small">Tip: sign out and back in with the trip password to see exactly what everyone else sees.</p>
