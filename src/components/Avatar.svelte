<script lang="ts">
  let { name, url = null, colour, size = 48 }: { name: string; url?: string | null; colour: string; size?: number } = $props();
  const initials = $derived(
    name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
  );
</script>

<span class="avatar" style="--c:{colour};--s:{size}px">
  {#if url}
    <img src={url} alt={name} />
  {:else}
    <span class="initials">{initials}</span>
  {/if}
</span>

<style>
  .avatar {
    width: var(--s); height: var(--s); flex: none; border-radius: 50%;
    border: 3px solid var(--c); background: var(--c); overflow: hidden;
    display: inline-grid; place-items: center; box-sizing: border-box;
  }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .initials { color: #fff; font-weight: 700; font-size: calc(var(--s) * 0.36); }
</style>
