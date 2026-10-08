// Fonctionnement hors ligne : l'application est gardée en mémoire sur l'appareil.
// Avec internet, la dernière version est toujours récupérée ; sans internet, la copie enregistrée s'ouvre.
// Augmenter VERSION à chaque mise à jour des fichiers pour forcer le rafraîchissement.
const VERSION = 'v13';
const CACHE = 'sm-devis-' + VERSION;
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-192-maskable.png', './icon-512-maskable.png'];

// Outils de lecture des scans (OCR / PDF), mis en mémoire aussi : si le téléchargement échoue, l'appli fonctionne quand même.
const VENDOR = ['vendor/tesseract.min.js', 'vendor/worker.min.js', 'vendor/core/tesseract-core-simd-lstm.wasm.js', 'vendor/core/tesseract-core-lstm.wasm.js', 'vendor/lang/fra.traineddata.gz', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).then(() => Promise.allSettled(VENDOR.map(u => c.add(u))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sm-devis-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/.netlify/') || u.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
