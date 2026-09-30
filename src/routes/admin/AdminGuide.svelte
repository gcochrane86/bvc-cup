<script lang="ts">
  // Guide photos for one course (all its tees share them): add or remove photos hole by hole.
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { guidePhotoUrls, removeGuidePhoto, uploadGuidePhoto } from '../../lib/guidePhotos';
  import type { GuidePhotoRow } from '../../lib/data/types';

  let { courseId }: { courseId: string } = $props();

  const course = $derived(db.courses.find((c) => c.id === courseId) ?? null);
  const holes = $derived(
    Array.from({ length: 18 }, (_, i) => {
      const h = db.courseHoles.find((x) => x.course_id === courseId && x.hole === i + 1);
      return { hole: i + 1, par: h?.par, si: h?.stroke_index };
    }),
  );
  const photosFor = (hole: number): GuidePhotoRow[] => db.guidePhotos.filter((p) => p.course_name === course?.name && p.hole === hole);

  let urls = $state<Record<string, string>>({});
  $effect(() => {
    const paths = db.guidePhotos.filter((p) => p.course_name === course?.name).map((p) => p.path);
    if (paths.length) void guidePhotoUrls(paths).then((u) => (urls = { ...urls, ...u }));
  });

  let busy = $state<number | null>(null);
  let msg = $state<string | null>(null);

  async function add(hole: number, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!course || !files.length) return;
    busy = hole;
    msg = null;
    try {
      for (const f of files) await uploadGuidePhoto(course.name, hole, f);
      await loadAll();
    } catch (err) {
      msg = `Error: ${(err as Error).message}`;
    } finally {
      busy = null;
    }
  }

  async function remove(photo: GuidePhotoRow, n: number) {
    if (!confirm(`Remove photo ${n} for hole ${photo.hole}?`)) return;
    try {
      await removeGuidePhoto(photo);
      await loadAll();
    } catch (err) {
      msg = `Error: ${(err as Error).message}`;
    }
  }
</script>

<p><a href="#/admin/courses">← Courses</a></p>
{#if !course}
  <p class="muted">Course not found.</p>
{:else}
  <h1>{course.name} guide</h1>
  <p class="muted small">
    Add photos for each hole — e.g. strokesaver pages or screenshots. They show in the Courses tab for any event at
    {course.name} (all tees).
  </p>
  {#if msg}<p class="error">{msg}</p>{/if}
  <div class="card list">
    {#each holes as h (h.hole)}
      {@const photos = photosFor(h.hole)}
      <div class="hole">
        <span class="hn" class:done={photos.length > 0}>{h.hole}</span>
        <div class="info">
          <strong>Hole {h.hole}</strong>
          <span class="muted small">{h.par ? `Par ${h.par} · SI ${h.si} · ` : ''}{photos.length} photo{photos.length === 1 ? '' : 's'}</span>
          {#if photos.length}
            <div class="thumbs">
              {#each photos as p, i (p.id)}
                <span class="th">
                  {#if urls[p.path]}<img src={urls[p.path]} alt="Hole {h.hole} photo {i + 1}" />{/if}
                  <button class="x" aria-label="Remove hole {h.hole} photo {i + 1}" onclick={() => remove(p, i + 1)}>×</button>
                </span>
              {/each}
            </div>
          {/if}
        </div>
        <label class="add" class:busy={busy === h.hole}>
          {busy === h.hole ? 'Uploading…' : '+ Add photo'}
          <input type="file" accept="image/*" multiple aria-label="Add photos for hole {h.hole}" disabled={busy !== null} onchange={(e) => add(h.hole, e)} />
        </label>
      </div>
    {/each}
  </div>
{/if}

<style>
  .list { padding: 4px 14px; }
  .hole { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .hole:last-child { border-bottom: 0; }
  .hn { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--line); display: grid; place-items: center; font-weight: 800; font-size: 0.85rem; flex: none; }
  .hn.done { background: var(--accent); color: #fff; border-color: var(--accent); }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .th { position: relative; width: 54px; height: 54px; border-radius: 8px; overflow: hidden; background: var(--line); }
  .th img { width: 100%; height: 100%; object-fit: cover; }
  .x { position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; min-height: 0; padding: 0; border-radius: 50%; background: rgb(0 0 0 / 0.6); color: #fff; font-size: 13px; line-height: 1; }
  .add { flex: none; border: 2px dashed #b9c4bd; border-radius: 10px; padding: 8px 10px; font-weight: 700; color: var(--accent); font-size: 0.85rem; cursor: pointer; }
  .add.busy { opacity: 0.6; }
  .add input { position: absolute; width: 1px; height: 1px; opacity: 0; }
</style>
