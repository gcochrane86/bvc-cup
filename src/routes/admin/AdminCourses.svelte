<script lang="ts">
  import { db } from '../../lib/data/store.svelte';
</script>

<p><a href="#/admin">← Admin</a></p>
<h1>Courses</h1>
<a class="card" href="#/admin/courses/new"><strong>+ Add a course</strong></a>
{#each db.courses as c (c.id)}
  <a class="card" href="#/admin/courses/{c.id}">
    {c.name}
    <span class="muted small">· {db.courseHoles.filter((h) => h.course_id === c.id).length} holes</span>
  </a>
{:else}
  <p class="muted">No courses yet.</p>
{/each}
