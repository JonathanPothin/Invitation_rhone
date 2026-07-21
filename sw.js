/* Service worker — cache léger pour la PWA UDR Rhône.
   Stratégie "network first" : on sert toujours la version en ligne si possible,
   le cache ne sert qu'en secours (hors connexion). Ainsi, pas de risque
   d'afficher une vieille version de la page (date, lieu, montants...). */
const CACHE = 'udr-rentree-v3'; // ⚠️ incrémenter (v2, v3...) à chaque mise à jour du site
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // On ne met jamais en cache les appels externes (Supabase, HelloAsso, fonts...)
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
