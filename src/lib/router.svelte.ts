import { parseRoute, type Route } from './route';

export const router = $state<{ route: Route }>({ route: parseRoute(location.hash) });

window.addEventListener('hashchange', () => {
  router.route = parseRoute(location.hash);
  window.scrollTo(0, 0);
});
