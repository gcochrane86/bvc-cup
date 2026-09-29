<script lang="ts">
  import { db } from '../../lib/data/store.svelte';
  import { courseGroups } from '../../lib/courses';
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Courses</h1>
<a class="card" href="#/admin/courses/new"><strong>+ Add a course</strong></a>
{#each courseGroups(db.courses) as g (g.name)}
  <div class="card" data-testid="course-group">
    <strong>{g.name}</strong>
    <div class="tees">
      {#each g.tees as t (t.id)}
        <span>
          <a href="#/admin/courses/{t.id}">{t.tee ? `${t.tee} tees` : 'Edit'}</a>
          <span class="muted small">· {db.courseHoles.filter((h) => h.course_id === t.id).length} holes</span>
        </span>
      {/each}
      <a href="#/admin/courses/new/{g.tees[0].id}">+ Add a tee</a>
    </div>
  </div>
{:else}
  <p class="muted">No courses yet.</p>
{/each}

<style>
  .tees { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; }
</style>
