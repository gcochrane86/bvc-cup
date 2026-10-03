<script lang="ts">
  import { untrack } from 'svelte';
  import { db, loadAll } from '../../lib/data/store.svelte';
  import { must, supabase } from '../../lib/supabase';
  import { validateHoles, validateRating, type HoleInfo } from '../../lib/scoring';
  import { isAdmin } from '../../lib/auth.svelte';

  // copyFrom: a new tee for an existing course — its name, par and SI come from that tee.
  let { courseId, copyFrom = null }: { courseId: string; copyFrom?: string | null } = $props();

  // Initial values are read once; App wraps this page in {#key courseId}.
  const sourceId = untrack(() => (courseId === 'new' ? copyFrom : courseId));
  function initialName(): string {
    return db.courses.find((c) => c.id === sourceId)?.name ?? '';
  }
  function initialHoles(): HoleInfo[] {
    return Array.from({ length: 18 }, (_, i) => {
      const h = db.courseHoles.find((x) => x.course_id === sourceId && x.hole === i + 1);
      return { hole: i + 1, par: h?.par ?? 4, strokeIndex: h?.stroke_index ?? i + 1 };
    });
  }

  let name = $state(initialName());
  const existing = untrack(() => db.courses.find((c) => c.id === courseId));
  let tee = $state(existing?.tee ?? '');
  let slope = $state<number | null>(existing?.slope_rating ?? null);
  let rating = $state<number | null>(existing?.course_rating != null ? Number(existing.course_rating) : null);
  let holes = $state(initialHoles());
  let errors = $state<string[]>([]);
  let busy = $state(false);
  const isNew = $derived(courseId === 'new');
  const totalPar = $derived(holes.reduce((s, h) => s + (Number(h.par) || 0), 0));

  async function save() {
    const clean = holes.map((h) => ({ hole: h.hole, par: Number(h.par), strokeIndex: Number(h.strokeIndex) }));
    // An emptied number input can come back as '' or undefined; treat both as blank.
    const s = slope === null || slope === undefined || (slope as unknown) === '' ? null : Number(slope);
    const r = rating === null || rating === undefined || (rating as unknown) === '' ? null : Number(rating);
    errors = [...validateRating(s, r), ...validateHoles(clean)];
    if (!name.trim()) errors = ['Course name is required', ...errors];
    if (errors.length) return;
    busy = true;
    try {
      await must(
        supabase.rpc('save_course', {
          p_course_id: isNew ? null : courseId,
          p_name: name.trim(),
          p_holes: clean.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
          p_slope_rating: s,
          p_course_rating: r,
          p_tee: tee.trim(), // '' clears the tee name (null would keep it)
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

  /** Admin only. A course a day is played on can't go (the database refuses). */
  async function remove() {
    if (!confirm(`Delete ${name}${tee ? ` (${tee})` : ''}? This can't be undone.`)) return;
    busy = true;
    try {
      await must(supabase.from('courses').delete().eq('id', courseId));
      await loadAll();
      location.hash = '#/admin/courses';
    } catch (e) {
      const m = (e as Error).message;
      errors = [/foreign key|violates/.test(m) ? 'A day is played on this course: change that day\'s course first.' : m];
    } finally {
      busy = false;
    }
  }
</script>

<p><a href="#/admin/courses">← Courses</a></p>
<h1>{isNew ? (copyFrom ? 'New tee' : 'New course') : 'Edit course'}</h1>
<div class="field"><label for="cn">Course name</label><input id="cn" bind:value={name} /></div>
<div class="field"><label for="ct">Tee</label><input id="ct" bind:value={tee} placeholder="e.g. Gold (blank if the course has one tee)" /></div>
<div class="row">
  <div class="field"><label for="cs">Slope</label><input id="cs" type="number" inputmode="numeric" min="55" max="155" placeholder="e.g. 125" bind:value={slope} /></div>
  <div class="field"><label for="cr">Course rating</label><input id="cr" type="number" inputmode="decimal" step="0.1" placeholder="e.g. 71.3" bind:value={rating} /></div>
</div>
<p class="muted small">From the scorecard, for the tees you'll play. Each player's Handicap Index is converted to a course handicap with these. Leave both blank to use indexes as they are.</p>
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
{#if isAdmin() && !isNew}<button class="wide secondary" disabled={busy} onclick={remove}>Delete course</button>{/if}

<style>
  .grid { display: grid; grid-template-columns: 56px 1fr 1fr; gap: 6px; align-items: center; }
  .hdr { font-weight: 700; color: var(--muted); font-size: 0.85rem; }
  .hole { font-weight: 700; text-align: center; }
  .wide { width: 100%; }
</style>
