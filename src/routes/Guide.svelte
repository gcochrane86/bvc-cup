<script lang="ts">
  import { untrack } from 'svelte';
  import { db } from '../lib/data/store.svelte';
  import { eventGuides, guideFlyover, guideNotes, guidePages, initialGuide, readGuideMemory, rememberGuideHole, type GuideMemory } from '../lib/guides';
  import FlyoverPlayer from '../components/FlyoverPlayer.svelte';

  const KEY = 'golf.guide';
  function load(): GuideMemory {
    try {
      return readGuideMemory(localStorage.getItem(KEY));
    } catch {
      return readGuideMemory(null);
    }
  }
  let mem = $state(load());

  // Only the active event's courses (BvC: Dundonald, Robert the Bruce, Ailsa — as before). Opens on the
  // course this phone last looked at, if this event has it, else the event's first course.
  const list = $derived(eventGuides(db.rounds, db.courses));
  let slug = $state(untrack(() => initialGuide(eventGuides(db.rounds, db.courses), mem.course).slug));
  const guide = $derived(list.find((g) => g.slug === slug) ?? list[0]);
  const hole = $derived(mem.holes[guide.slug] ?? 1);
  const pages = $derived(guidePages(guide.slug, hole));
  const notes = $derived(guideNotes(guide.slug, hole));
  const flyover = $derived(guideFlyover(guide.slug, hole));

  // Par and stroke index from admin: the course this event's day uses (so Black/White tees still match),
  // else any course with the guide's name.
  const info = $derived.by(() => {
    const course =
      db.rounds.map((r) => db.courses.find((c) => c.id === r.course_id)).find((c) => c && guide.match.test(c.name)) ??
      db.courses.find((c) => guide.match.test(c.name));
    return course ? db.courseHoles.find((h) => h.course_id === course.id && h.hole === hole) : undefined;
  });
  const alt = (i: number) =>
    guide.kind === 'turnberry'
      ? i === 0 ? `Hole ${hole} layout with yardages` : `Hole ${hole} approach and description`
      : guide.kind === 'yardage'
        ? i === 0 ? `Hole ${hole} map with yardages` : `Hole ${hole} green`
        : `Hole ${hole} aerial view`;

  function go(nextSlug: string, nextHole: number) {
    slug = nextSlug;
    mem = rememberGuideHole(mem, nextSlug, Math.min(18, Math.max(1, nextHole)));
    try {
      localStorage.setItem(KEY, JSON.stringify(mem));
    } catch {
      /* private mode: memory lasts until the page is closed */
    }
    window.scrollTo(0, 0);
  }
</script>

<h1>Courses</h1>

<div class="courses" role="tablist">
  {#each list as g (g.slug)}
    <button role="tab" aria-selected={g.slug === guide.slug} class:active={g.slug === guide.slug} onclick={() => go(g.slug, mem.holes[g.slug] ?? 1)}>
      {g.short}
    </button>
  {/each}
</div>

<div class="strip">
  {#each Array.from({ length: 18 }, (_, i) => i + 1) as h (h)}
    <button class="hole" class:current={h === hole} aria-label="Guide hole {h}" onclick={() => go(guide.slug, h)}>{h}</button>
  {/each}
</div>

<h2 class="title" data-testid="guide-title">
  Hole {hole}{#if info}<span class="muted">&nbsp;· Par {info.par} · SI {info.stroke_index}</span>{/if}
</h2>

<p class="course-name muted small">{guide.name}</p>

{#if notes}
  <section class="card notes" data-testid="guide-notes">
    <h3>Pro tips</h3>
    <p>{notes.tips}</p>
  </section>
{/if}

{#if flyover}
  {#key flyover.embed}
    <!-- Nothing loads from YouTube until someone taps play: keeps the Courses tab light on poor signal. -->
    <FlyoverPlayer embed={flyover.embed} {hole} />
  {/key}
{/if}

{#key pages[0]}
  {#each pages as src, i (src)}
    <img
      class="page"
      class:pdf={guide.kind === 'turnberry'}
      class:yardage={guide.kind === 'yardage'}
      {src}
      alt={alt(i)}
      loading={i === 0 ? 'eager' : 'lazy'}
      data-testid={i === 0 ? 'guide-layout' : undefined}
    />
  {/each}
{/key}


<div class="nav">
  <button class="secondary" disabled={hole === 1} onclick={() => go(guide.slug, hole - 1)}>← Hole {hole - 1}</button>
  <button class="secondary" disabled={hole === 18} onclick={() => go(guide.slug, hole + 1)}>Hole {hole + 1} →</button>
</div>
<p class="muted small">{guide.credit} Pinch to zoom.</p>

<style>
  .courses { display: flex; gap: 8px; margin-bottom: 10px; }
  .courses button { flex: 1; background: var(--surface); color: var(--text); border: 1px solid var(--line); padding: 10px 4px; font-size: 0.85rem; line-height: 1.15; }
  .courses button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .strip { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin-bottom: 12px; }
  .hole { min-height: 36px; padding: 0; border-radius: 8px; background: var(--surface); color: var(--text); border: 1px solid var(--line); font-size: 0.85rem; }
  .hole.current { background: var(--accent); color: #fff; border-color: var(--accent); }
  .title { font-size: 1.2rem; margin: 0 0 10px; }
  .title span { font-size: 0.95rem; font-weight: 500; }
  .page { display: block; width: 100%; height: auto; border-radius: var(--radius); margin-bottom: 12px; background: #fff; }
  .page:not(.pdf):not(.yardage) { max-height: 60vh; object-fit: contain; }
  .page.pdf { aspect-ratio: 900 / 1406; background: #efe9dc; }
  .course-name { margin: -6px 0 8px; }
  .notes h3 { margin-bottom: 6px; }
  .notes p { margin: 0; line-height: 1.45; }
  .nav { display: flex; justify-content: space-between; gap: 8px; }
  .nav button { flex: 1; }
  .nav button:disabled { visibility: hidden; }
</style>
