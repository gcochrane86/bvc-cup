<script lang="ts">
  import { db } from '../../lib/data/store.svelte';
  import { courseGroups } from '../../lib/courses';
  import { guideStatus } from '../../lib/guides';

  /** Holes with at least one uploaded guide photo, for a course. */
  const photoHoles = (name: string) => new Set(db.guidePhotos.filter((p) => p.course_name === name).map((p) => p.hole)).size;
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Courses</h1>
<a class="card" href="#/admin/courses/new"><strong>+ Add a course</strong></a>
{#each courseGroups(db.courses) as g (g.name)}
  {@const status = guideStatus(g.name, photoHoles(g.name))}
  <div class="card" data-testid="course-group">
    <div class="top">
      <strong>{g.name}</strong>
      {#if status.kind === 'builtin'}<span class="badge ok">Guide ✓</span>
      {:else if status.kind === 'photos'}<span class="badge part">Photo guide · {status.holes} of 18 holes</span>
      {:else}<span class="badge none">No guide yet</span>{/if}
    </div>
    <div class="tees">
      {#each g.tees as t (t.id)}
        <span>
          <a href="#/admin/courses/{t.id}">{t.tee ? `${t.tee} tees` : 'Edit'}</a>
          <span class="muted small">· {db.courseHoles.filter((h) => h.course_id === t.id).length} holes</span>
        </span>
      {/each}
      <a href="#/admin/courses/new/{g.tees[0].id}">+ Add a tee</a>
    </div>
    {#if status.kind !== 'builtin'}
      <a class="guidebtn" href="#/admin/guide/{g.tees[0].id}">{status.kind === 'photos' ? 'Edit guide photos →' : 'Add guide photos →'}</a>
    {/if}
  </div>
{:else}
  <p class="muted">No courses yet.</p>
{/each}

<style>
  .tees { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .badge { font-size: 0.75rem; font-weight: 800; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
  .badge.ok { background: #dff3e2; color: var(--shot-text); }
  .badge.part { background: #fff1dd; color: #9a5a12; }
  .badge.none { background: #eceeec; color: var(--muted); }
  .guidebtn { display: block; text-align: center; margin-top: 10px; padding: 10px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; border: 2px solid var(--accent); color: var(--accent); }
</style>
