// Suprema Poker — Service Worker
// IMPORTANTE: incremente SW_VERSION a cada deploy — é isso que faz as abas abertas
// receberem o aviso de "nova versão disponível" e ninguém operar com código velho
const SW_VERSION = '3.0.3';
const CACHE_NAME = `suprema-painel-v${SW_VERSION}`;
const STATIC_ASSETS = [
  '/painelpoker/',
  '/painelpoker/index.html',
  '/painelpoker/criacao-noturna.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      // avisa todas as abas abertas que uma versão nova assumiu — a página mostra o banner
      // de "recarregue" em vez de continuar rodando o código antigo sem ninguém perceber
      .then(() => self.clients.matchAll({type:'window'}))
      .then(clients => clients.forEach(c => c.postMessage({type:'sw-updated', version: SW_VERSION})))
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Ignorar Firebase, APIs externas, não-GET e requisições com Range header (status 206)
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    e.request.method !== 'GET' ||
    e.request.headers.get('range')  // Evita status 206 (partial content) no cache
  ) return;

  // Network First com fallback para cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Só cachear respostas completas (status 200)
        if (res.ok && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
