<script lang="ts">
  // Tap-to-play flyover: the YouTube player (several MB) only loads once someone taps play.
  // It starts muted: phones only let a video start by itself when muted, so unmuted it needs a second tap.
  let { embed, hole }: { embed: string; hole: number } = $props();
  let playing = $state(false);
</script>

<div class="flyover" data-testid="guide-flyover">
  {#if playing}
    <iframe
      src={`${embed}&autoplay=1&mute=1`}
      title="Hole {hole} flyover"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
  {:else}
    <button class="play" onclick={() => (playing = true)}>
      <span class="icon" aria-hidden="true">▶</span>
      <span>Play hole {hole} flyover</span>
    </button>
  {/if}
</div>
<p class="muted small note">Hole {hole} flyover · Dundonald Links on YouTube (needs signal)</p>

<style>
  .flyover { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden; background: #0b3d2e; }
  .flyover iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .play {
    position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    background: linear-gradient(135deg, #0b3d2e, #1d6b4f); color: #fff; font-size: 1rem;
  }
  .icon { width: 56px; height: 56px; border-radius: 50%; background: rgb(255 255 255 / 0.2); display: grid; place-items: center; font-size: 1.4rem; padding-left: 4px; }
  .note { margin: 4px 0 12px; }
</style>
