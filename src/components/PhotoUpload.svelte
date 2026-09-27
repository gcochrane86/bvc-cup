<script lang="ts">
  import { uploadPlayerPhoto } from '../lib/photos';
  import { loadAll } from '../lib/data/store.svelte';

  let { playerId, label = 'Upload photo' }: { playerId: string; label?: string } = $props();
  let busy = $state(false);

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
      await uploadPlayerPhoto(playerId, file);
      await loadAll();
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      busy = false;
      input.value = '';
    }
  }
</script>

<label class="upload">
  <input type="file" accept="image/*" onchange={onPick} data-testid="photo-input-{playerId}" />
  <span>{busy ? 'Uploading…' : label}</span>
</label>

<style>
  .upload { display: inline-flex; margin: 0; }
  input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  span {
    display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer;
  }
</style>
