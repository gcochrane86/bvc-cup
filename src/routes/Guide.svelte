<script lang="ts">
  import { db } from '../lib/data/store.svelte';
  import { GUIDES, guideFlyover, guideForCourse, guideNotes, guidePages, readGuideMemory, rememberGuideHole, type GuideMemory } from '../lib/guides';
  import { defaultRoundId, today } from '../lib/view';
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

  // No memory yet: open today's course if it has a guide, else the first guide.
  function initialCourse(): string {
    if (mem.course) return mem.course;
    const rid = defaultRoundId(db.rounds, today());
    const round = db.rounds.find((r) => r.id === rid);
    const course = db.courses.find((c) => c.id === round?.course_id);
    return (course && guideForCourse(course.name)?.slug) ?? GUIDES[0].slug;
  }
  let slug = $state(initialCourse());
  const hole = $derived(mem.holes[slug] ?? 1);
  const guide = $derived(GUIDES.find((g) => g.slug === slug)!);
  const pages = $derived(guidePages(slug, hole));
  const notes = $derived(guideNotes(slug, hole));
  const flyover = $derived(guideFlyover(slug, hole));

  // Par and stroke index from the course set up in admin (if it's in this event's data).
  const info = $derived.by(() => {
    const course = db.courses.find((c) => guide.match.test(c.name));
    return course ? db.courseHoles.find((h) => h.course_id === course.id && h.hole === hole) : undefined;
  });

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
  {#each GUIDES as g (g.slug)}
    <button role="tab" aria-selected={g.slug === slug} class:active={g.slug === slug} onclick={() => go(g.slug, mem.holes[g.slug] ?? 1)}>
      {g.short}
    </button>
  {/each}
</div>

<div class="strip">
  {#each Array.from({ length: 18 }, (_, i) => i + 1) as h (h)}
    <button class="hole" class:current={h === hole} aria-label="Guide hole {h}" onclick={() => go(slug, h)}>{h}</button>
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
      class:pdf={pages.length > 1}
      {src}
      alt={pages.length > 1 ? (i === 0 ? `Hole ${hole} layout with yardages` : `Hole ${hole} approach and description`) : `Hole ${hole} aerial view`}
      loading={i === 0 ? 'eager' : 'lazy'}
      data-testid={i === 0 ? 'guide-layout' : undefined}
    />
  {/each}
{/key}


<div class="nav">
  <button class="secondary" disabled={hole === 1} onclick={() => go(slug, hole - 1)}>← Hole {hole - 1}</button>
  <button class="secondary" disabled={hole === 18} onclick={() => go(slug, hole + 1)}>Hole {hole + 1} →</button>
</div>
<p class="muted small">
  {#if slug === 'dundonald'}From the Dundonald Links hole-by-hole guide.{:else}From the Trump Turnberry course guide. Yardages are to the front of the green.{/if}
  Pinch to zoom.
</p>

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
  .page:not(.pdf) { max-height: 60vh; object-fit: contain; }
  .page.pdf { aspect-ratio: 900 / 1406; background: #efe9dc; }
  .course-name { margin: -6px 0 8px; }
  .notes h3 { margin-bottom: 6px; }
  .notes p { margin: 0; line-height: 1.45; }
  .nav { display: flex; justify-content: space-between; gap: 8px; }
  .nav button { flex: 1; }
  .nav button:disabled { visibility: hidden; }
</style>
