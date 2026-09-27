<script lang="ts">
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import { validateHoles, type HoleInfo } from '../../lib/scoring';

  let { courseId }: { courseId: string } = $props();

  // Initial values are read once; App wraps this page in {#key courseId}.
  function initialName(): string {
    return db.courses.find((c) => c.id === courseId)?.name ?? '';
  }
  function initialHoles(): HoleInfo[] {
    return Array.from({ length: 18 }, (_, i) => {
      const h = db.courseHoles.find((x) => x.course_id === courseId && x.hole === i + 1);
      return { hole: i + 1, par: h?.par ?? 4, strokeIndex: h?.stroke_index ?? i + 1 };
    });
  }

  let name = $state(initialName());
  let holes = $state(initialHoles());
  let errors = $state<string[]>([]);
  let busy = $state(false);
  const isNew = $derived(courseId === 'new');
  const totalPar = $derived(holes.reduce((s, h) => s + (Number(h.par) || 0), 0));

  async function save() {
    const clean = holes.map((h) => ({ hole: h.hole, par: Number(h.par), strokeIndex: Number(h.strokeIndex) }));
    errors = validateHoles(clean);
    if (!name.trim()) errors = ['Course name is required', ...errors];
    if (errors.length) return;
    busy = true;
    try {
      await must(
        supabase.rpc('save_course', {
          p_course_id: isNew ? null : courseId,
          p_name: name.trim(),
          p_holes: clean.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
        }),
      );
      await loadAll();
      location.hash = '#/admin/courses';
    } catch (e) {
      errors = [(e as Error).message];
    } finally {
      busy = false;
    }
  }
</script>

<p><a href="#/admin/courses">← Courses</a></p>
<h1>{isNew ? 'New course' : 'Edit course'}</h1>
<div class="field"><label for="cn">Course name</label><input id="cn" bind:value={name} /></div>
<p class="muted small">Copy par and stroke index (SI) from the scorecard. Every SI from 1 to 18 must be used once. Total par: {totalPar}</p>

<div class="card grid">
  <div class="hdr">Hole</div><div class="hdr">Par</div><div class="hdr">SI</div>
  {#each holes as h (h.hole)}
    <div class="hole">{h.hole}</div>
    <input type="number" inputmode="numeric" min="3" max="6" aria-label="Hole {h.hole} par" bind:value={h.par} />
    <input type="number" inputmode="numeric" min="1" max="18" aria-label="Hole {h.hole} SI" bind:value={h.strokeIndex} />
  {/each}
</div>

{#each errors as err (err)}<p class="error">{err}</p>{/each}
<button class="wide" disabled={busy} onclick={save}>Save course</button>

<style>
  .grid { display: grid; grid-template-columns: 56px 1fr 1fr; gap: 6px; align-items: center; }
  .hdr { font-weight: 700; color: var(--muted); font-size: 0.85rem; }
  .hole { font-weight: 700; text-align: center; }
  .wide { width: 100%; }
</style>
