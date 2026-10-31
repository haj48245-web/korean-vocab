/* 离线缓存：首次访问后，断网也能继续背单词 */
var CACHE = 'hangul-step-v3';
var ASSETS = [
  './', './index.html', './css/style.css',
  './js/data-core.js', './js/words-1.js', './js/words-2.js', './js/words-3.js',
  './js/words-4.js', './js/words-5.js', './js/words-6.js', './js/words-extra.js',
  './js/notes.js', './js/grammar.js', './js/pron.js', './js/app.js',
  './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) {
        fetch(e.request).then(function (res) {
          if (res && res.status === 200) caches.open(CACHE).then(function (c) { c.put(e.request, res.clone()); });
        }).catch(function () {});
        return hit;
      }
      return fetch(e.request).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
