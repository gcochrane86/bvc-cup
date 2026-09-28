<script lang="ts">
  import { db, flushOutbox, loadAll } from '../lib/data/store.svelte';
  import { hasPendingFor } from '../lib/data/merge';
  import { must, supabase } from '../lib/supabase';
  import { isAdmin } from '../lib/auth.svelte';
  import { buildEventView, findGroup, matchLabel } from '../lib/view';
  import { resultFromState, type MatchType } from '../lib/scoring';
  import MatchCard from '../components/MatchCard.svelte';
  import HoleGrid from '../components/HoleGrid.svelte';
  import { readScoringGroup } from '../lib/scoringMemory';
  import Scorecard from '../components/Scorecard.svelte';

  let { groupId, matchType }: { groupId: string; matchType: MatchType } = $props();

  const view = $derived(buildEventView(db));
  const found = $derived(view ? findGroup(view, groupId) : null);
  const mv = $derived(found?.group.matches.find((m) => m.def.type === matchType) ?? null);
  let busy = $state(false);

  async function confirmResult() {
    if (!mv || !found) return;
    const preview = resultFromState(mv.def, mv.state);
    if (!preview) return;
    if (!confirm(`Confirm ${matchLabel(mv.def.type)}: ${preview.resultText}? This locks the scores for this match.`)) return;
    busy = true;
    try {
      // Queued scores must reach the server first, or the lock would reject them.
      await flushOutbox();
      if (hasPendingFor(db.pending, found.round.round.id, [...mv.def.sideA, ...mv.def.sideB])) {
        alert("Some scores for this match are still waiting to send. Try again when you've got signal.");
        return;
      }
      const snap = resultFromState(mv.def, mv.state); // recompute with anything that just synced
      if (!snap) {
        alert('The result changed while syncing — please check the scores.');
        return;
      }
      const r = await must(
        supabase.rpc('confirm_match', {
          p_group_id: snap.groupId,
          p_match_type: snap.matchType,
          p_winner: snap.winner,
          p_points_a: snap.pointsA,
          p_points_b: snap.pointsB,
          p_result_text: snap.resultText,
          p_final_hole: snap.finalHole,
        }),
      );
      if (r === 'already_confirmed') alert('This match had already been confirmed.');
      await loadAll();
    } catch (e) {
      alert(`Could not confirm: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }

  async function unlock() {
    if (!confirm('Unlock this result? Its points go back to projected and its scores can be edited again.')) return;
    busy = true;
    try {
      await must(supabase.from('match_results').delete().eq('group_id', groupId).eq('match_type', matchType));
      await loadAll();
    } catch (e) {
      alert(`Could not unlock: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }
</script>

<p><a href="#/">← Leaderboard</a></p>
{#if !found || !mv || !view}
  <p class="center">Match not found.</p>
{:else}
  <h2>{found.round.round.name}</h2>
  <MatchCard {mv} teeTime={found.group.group.tee_time} link={false} />
  {#if mv.state.decided && !mv.result}
    <button class="wide" disabled={busy} onclick={confirmResult}>Confirm result</button>
  {/if}
  {#if mv.result && isAdmin()}
    <button class="wide secondary" disabled={busy} onclick={unlock}>Unlock result</button>
  {/if}
  <h3>Match summary</h3>
  <HoleGrid state={mv.state} editHref={readScoringGroup() === groupId ? (h) => `#/score/${groupId}/${h}` : null} />
  <h3>Scorecard</h3>
  <Scorecard def={mv.def} holes={found.round.holes} scores={found.group.scores} teamOf={view.teamOf} playingHcp={found.group.playingHcp} />
  <p class="muted small">• = shot received on that hole in this match. P = picked up.</p>
{/if}

<style>
  .wide { width: 100%; margin-bottom: 16px; }
  h3 { margin-top: 20px; }
</style>
