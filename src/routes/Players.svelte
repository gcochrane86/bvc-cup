<script lang="ts">
  import { db, photoUrl } from '../lib/data/store.svelte';
  import Avatar from '../components/Avatar.svelte';
  import PhotoUpload from '../components/PhotoUpload.svelte';

  const teams = $derived(
    (['A', 'B'] as const).map((team) => ({
      team,
      name: team === 'A' ? db.event?.team_a_name : db.event?.team_b_name,
      players: db.eventPlayers
        .filter((ep) => ep.team === team)
        .map((ep) => ({ ...ep, player: db.players.find((p) => p.id === ep.player_id) }))
        .filter((x) => x.player)
        .sort((x, y) => x.player!.name.localeCompare(y.player!.name)),
    })),
  );
</script>

<h1>Players</h1>
<p class="muted small">Tap "Upload photo" to add a headshot — a selfie works fine.</p>
{#each teams as t (t.team)}
  <h2 style="color:var(--team-{t.team === 'A' ? 'a' : 'b'})">{t.name}</h2>
  {#each t.players as ep (ep.player_id)}
    <div class="card prow" data-testid="player-row">
      <Avatar name={ep.player!.name} url={photoUrl(ep.player_id)} colour="var(--team-{t.team === 'A' ? 'a' : 'b'})" size={64} />
      <div class="who">
        <strong>{ep.player!.name}</strong>
        <div class="muted small">Handicap {ep.handicap}</div>
      </div>
      <PhotoUpload playerId={ep.player_id} label={ep.player!.photo_path ? 'Change' : 'Upload photo'} />
    </div>
  {/each}
{/each}

<style>
  .prow { display: flex; align-items: center; gap: 12px; }
  .who { flex: 1; min-width: 0; }
</style>
