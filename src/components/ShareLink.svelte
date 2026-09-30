<script lang="ts">
  // An event's share link: anyone with it can follow and score this event without signing in.
  import { must, supabase } from '../lib/supabase';
  import { newWatchToken, watchLink } from '../lib/watch.svelte';
  import type { EventRow } from '../lib/data/types';

  let { event }: { event: EventRow } = $props();

  let busy = $state(false);
  let note = $state<string | null>(null);
  const link = $derived(event.watch_token ? watchLink(event.watch_token) : null);

  async function setToken(token: string | null, done: string) {
    busy = true;
    note = null;
    try {
      await must(supabase.from('events').update({ watch_token: token }).eq('id', event.id));
      event.watch_token = token;
      note = done;
    } catch (e) {
      note = `Error: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link!);
      note = 'Link copied';
    } catch {
      note = 'Press and hold the link to copy it';
    }
  }
  const share = () => navigator.share({ title: event.name, text: `Follow ${event.name} live`, url: link! }).catch(() => {});
  const replace = () => {
    if (confirm('Make a new link? The current link stops working straight away.')) void setToken(newWatchToken(), 'New link made — the old one no longer works');
  };
  const turnOff = () => {
    if (confirm('Turn the share link off? Anyone using it will need to sign in instead.')) void setToken(null, 'Share link turned off');
  };
</script>

<section class="card" data-testid="share-link">
  <h2>Share link</h2>
  {#if link}
    <p class="muted small">Anyone with this link can follow and score {event.name} without signing in. Setup, unlocking and resets stay with you.</p>
    <p class="link" data-testid="share-url">{link}</p>
    <div class="actions">
      <button onclick={copy} disabled={busy}>Copy</button>
      {#if 'share' in navigator}<button onclick={share} disabled={busy}>Share…</button>{/if}
    </div>
    <div class="actions">
      <button class="secondary" onclick={replace} disabled={busy}>New link</button>
      <button class="secondary" onclick={turnOff} disabled={busy}>Turn off</button>
    </div>
  {:else}
    <p class="muted small">Make a private link to send round (e.g. WhatsApp): anyone with it can follow this event live and enter scores, without signing in.</p>
    <button onclick={() => setToken(newWatchToken(), 'Share link made')} disabled={busy}>Create share link</button>
  {/if}
  {#if note}<p class="small" class:error={note.startsWith('Error')}>{note}</p>{/if}
</section>

<style>
  .link { word-break: break-all; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 0.85rem; user-select: all; }
  .actions { display: flex; gap: 8px; margin-top: 8px; }
  .actions button { flex: 1; }
</style>
