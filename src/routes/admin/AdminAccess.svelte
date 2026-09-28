<script lang="ts">
  import { must, supabase } from '../../lib/supabase';
  import { groupMembers, type Member } from '../../lib/access';

  let members = $state<Member[]>([]);
  let msg = $state<string | null>(null);
  let busy = $state<string | null>(null);

  async function load() {
    members = (await must(supabase.from('members').select('*').order('created_at', { ascending: false }))) as Member[];
  }
  // Load now, and refresh when anyone logs in for the first time or a decision is made.
  $effect(() => {
    void load();
    const channel = supabase
      .channel('access-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  });

  const groups = $derived(groupMembers(members));
  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function decide(m: Member, status: Member['status']) {
    if (status === 'removed' && !confirm(`Remove access for ${m.email}? They'll be locked out straight away.`)) return;
    busy = m.user_id;
    msg = null;
    try {
      await must(supabase.from('members').update({ status, decided_at: new Date().toISOString() }).eq('user_id', m.user_id));
      await load();
      msg = `${m.email} ${status === 'approved' ? 'approved' : 'removed'}`;
    } catch (e) {
      msg = `Error: ${(e as Error).message}`;
    } finally {
      busy = null;
    }
  }
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Access</h1>
<p class="muted small">Everyone who logs in with the trip password appears here. Only people you approve can see and enter scores.</p>
{#if msg}<p class:error={msg.startsWith('Error')}>{msg}</p>{/if}

{#snippet list(title: string, rows: Member[], action: 'approve' | 'remove' | 'readmit')}
  {#if rows.length}
    <h2 class="group">{title} <span class="muted">({rows.length})</span></h2>
    {#each rows as m (m.user_id)}
      <div class="card row person" data-testid="access-row">
        <div class="who">
          <strong>{m.email}</strong>
          <span class="muted small">first logged in {when(m.created_at)}</span>
        </div>
        {#if action === 'approve'}
          <button disabled={busy === m.user_id} onclick={() => decide(m, 'approved')}>Approve</button>
          <button class="secondary" disabled={busy === m.user_id} onclick={() => decide(m, 'removed')}>Remove</button>
        {:else if action === 'remove'}
          <button class="secondary" disabled={busy === m.user_id} onclick={() => decide(m, 'removed')}>Remove</button>
        {:else}
          <button class="secondary" disabled={busy === m.user_id} onclick={() => decide(m, 'approved')}>Re-admit</button>
        {/if}
      </div>
    {/each}
  {/if}
{/snippet}

{@render list('Waiting for approval', groups.waiting, 'approve')}
{@render list('Approved', groups.approved, 'remove')}
{@render list('Removed', groups.removed, 'readmit')}
{#if !members.length}<p class="muted">No one has logged in yet.</p>{/if}

<style>
  .group { font-size: 1rem; margin: 18px 0 8px; }
  .person { flex-wrap: wrap; }
  .who { flex: 1; min-width: 180px; display: flex; flex-direction: column; overflow-wrap: anywhere; }
</style>
