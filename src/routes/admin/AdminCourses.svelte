<script lang="ts">
  import { db } from '../../lib/data/store.svelte';
  import { courseGroups } from '../../lib/courses';
  import { guideStatus } from '../../lib/guides';

  /** Holes with at least one uploaded guide photo, for a course. */
  const photoHoles = (name: string) => new Set(db.guidePhotos.filter((p) => p.course_name === name).map((p) => p.hole)).size;
  const holeCount = (id: string) => db.courseHoles.filter((h) => h.course_id === id).length;

  /** A dot in the tee's colour, when its name is one ("Black", "Gold", "Red (ladies)"…). */
  const TEE_COLOURS: Record<string, string> = {
    black: '#1b1b1b', blue: '#2f6fd6', white: '#ffffff', yellow: '#f2c200', gold: '#c9a227',
    red: '#d23a2e', green: '#2e8b4a', silver: '#b8bec4', orange: '#f28c28', purple: '#7b4bb3',
  };
  const teeColour = (tee: string) => TEE_COLOURS[tee.trim().split(/\s+/)[0].toLowerCase()] ?? '#c9cdc9';
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Courses</h1>
<a class="add" href="#/admin/courses/new">+ Add a course</a>
{#each courseGroups(db.courses) as g (g.name)}
  {@const status = guideStatus(g.name, photoHoles(g.name))}
  <div class="card course" data-testid="course-group">
    <div class="top">
      <strong>{g.name}</strong>
      {#if status.kind === 'builtin'}<span class="badge ok">Guide ✓{status.holes ? ` · your photos on ${status.holes} hole${status.holes === 1 ? '' : 's'}` : ''}</span>
      {:else if status.kind === 'photos'}<span class="badge part">Photo guide · {status.holes} of 18 holes</span>
      {:else}<span class="badge none">No guide yet</span>{/if}
    </div>
    <div class="chips">
      {#each g.tees as t (t.id)}
        {@const n = holeCount(t.id)}
        <a class="chip" href="#/admin/courses/{t.id}" aria-label={t.tee ? `${t.tee} tees` : 'Edit'}>
          {#if t.tee}<span class="dot" style="background:{teeColour(t.tee)}"></span>{t.tee}{:else}Edit holes{/if}
          {#if n !== 18}<span class="warn">· {n} holes</span>{/if}
        </a>
      {/each}
      <a class="chip new" href="#/admin/courses/new/{g.tees[0].id}" aria-label="+ Add a tee">+ Tee</a>
    </div>
    <a class="guidebtn" href="#/admin/guide/{g.tees[0].id}">
      <span aria-hidden="true">📷</span>{status.kind !== 'none' && status.holes ? 'Edit guide photos →' : 'Add guide photos →'}
    </a>
  </div>
{:else}
  <p class="muted">No courses yet.</p>
{/each}

<style>
  .add { display: block; text-align: center; padding: 14px; margin-bottom: 12px; border: 2px dashed var(--line); border-radius: var(--radius); color: var(--accent); font-weight: 700; text-decoration: none; }
  .course { padding-bottom: 6px; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .top strong { font-size: 1.05rem; }
  .badge { font-size: 0.75rem; font-weight: 800; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
  .badge.ok { background: #dff3e2; color: var(--shot-text); }
  .badge.part { background: #fff1dd; color: #9a5a12; }
  .badge.none { background: #eceeec; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: 0.85rem; font-weight: 600; text-decoration: none; }
  .chip.new { border-style: dashed; color: var(--accent); background: transparent; }
  .dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(0, 0, 0, 0.25); }
  .warn { color: #9a5a12; font-weight: 500; }
  .guidebtn { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 10px 0 6px; border-top: 1px solid var(--line); color: var(--accent); font-weight: 700; font-size: 0.9rem; text-decoration: none; }
</style>
