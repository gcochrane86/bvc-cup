-- Per-event switch for the players' Form tab (rankings by gross, net, points, birdies, trebles).
alter table public.events add column show_form boolean not null default false;
