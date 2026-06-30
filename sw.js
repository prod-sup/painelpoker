// Suprema Poker — Service Worker v2.1.0
const CACHE_NAME = 'suprema-painel-v2';
const STATIC_ASSETS = [
  '/painelpoker/',
  '/painelpoker/index.html',
];

// Instalar e cachear assets estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(()=>{});
    }).then(()=> self.skipWaiting())
  );
});

// Ativar e limpar caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))
    ).then(()=> self.clients.claim())
  );
});

// Fetch: Cache First para assets estáticos, Network First para Firebase/APIs
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase, APIs externas — sempre tenta rede primeiro
  if(url.hostname.includes('firebase') || url.hostname.includes('googleapis') ||
     url.hostname.includes('gstatic') || e.request.method !== 'GET'){
    return; // deixa o browser lidar
  }

  // HTML/JS/CSS do painel — Network First com fallback para cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Atualizar cache com versão mais recente
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Mensagens do cliente
self.addEventListener('message', e => {
  if(e.data === 'skipWaiting') self.skipWaiting();
});
