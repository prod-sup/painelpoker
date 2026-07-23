// Suprema Poker — Service Worker
// IMPORTANTE: incremente SW_VERSION a cada deploy — é isso que faz as abas abertas
// receberem o aviso de "nova versão disponível" e ninguém operar com código velho
const SW_VERSION = '3.31.0';
const CACHE_NAME = `suprema-painel-v${SW_VERSION}`;
const STATIC_ASSETS = [
  '/painelpoker/',
  '/painelpoker/index.html',
  '/painelpoker/criacao-noturna.html',
  '/painelpoker/gu-parser.js',
  '/painelpoker/conf-dia.js',
  '/painelpoker/scripts/lite.js',
  '/painelpoker/suprema-xlsx.js',
  // NÃO precache o xlsx.full.min.js (861KB): o suprema-xlsx.js existe justamente pra baixá-lo
  // só na PRIMEIRA importação/exportação. Precachear aqui trazia os 861KB na instalação do SW
  // pra todo operador, inclusive quem nunca exporta — anulando o carregamento sob demanda.
  // Quem usar a exportação baixa uma vez e o runtime cache (network-first, abaixo) guarda.
  '/painelpoker/suprema-onboarding.js',
  /* cada .html precacheado precisa dos SEUS js/css também — senão a página abre
     offline mas sem cérebro/estilo na primeira visita sem rede */
  '/painelpoker/hub.html',
  '/painelpoker/hub.js',
  '/painelpoker/hub-onboarding.js',   // o hub.html carrega — estava fora do precache
  '/painelpoker/hub.css',
  '/painelpoker/admin.html',
  '/painelpoker/admin.js',
  // sem admin-actions os [data-act] do admin ficam mudos (nenhum botão responde)
  '/painelpoker/admin-actions.js',
  '/painelpoker/admin.css',
  '/painelpoker/criacao-noturna.js',
  // criacao-noturna.js DEPENDE de criacao-calc (parsing/fee/early bird):
  // sem ele offline, a receita não renderiza.
  '/painelpoker/criacao-calc.js',
  '/painelpoker/criacao-noturna.css',
  '/painelpoker/dashboard-mesa-cash.html',
  '/painelpoker/dashboard-mesa-cash.js',
  '/painelpoker/dashboard-mesa-cash.css',
  '/painelpoker/eventos.html',
  '/painelpoker/eventos.css',
  '/painelpoker/eventos.js',
  '/painelpoker/radar-core.js',
  '/painelpoker/analytics.html',
  '/painelpoker/analytics.css',
  '/painelpoker/analytics.js',
  '/painelpoker/analytics-core.js',
  // o Worker de parse da Global: sem ele no cache, o Radar/TV offline perdem o
  // caminho rápido e caem no parse síncrono (funciona, mas trava a aba)
  '/painelpoker/suprema-global-worker.js',
  '/painelpoker/tv.html',
  '/painelpoker/tv.css',
  '/painelpoker/tv.js',
  // O Feltro: o fundo em WebGL da TV. Sem ele o canal cai na rede de nós 2D.
  '/painelpoker/suprema-feltro.js',
  '/painelpoker/suprema-tokens.css',
  // PWA: manifest + ícones precisam existir offline pro app instalado abrir sem rede
  '/painelpoker/manifest.json',
  '/painelpoker/icon-192.png',
  '/painelpoker/icon-512.png',
  // shell do "OS": os módulos compartilhados precisam existir offline, senão o
  // gate/sessão/presença/tema não sobem sem rede e a promessa de OS se quebra
  '/painelpoker/suprema-auth.js',
  '/painelpoker/suprema-shell.js',
  '/painelpoker/suprema-palette.js',
  '/painelpoker/suprema-copiloto.js',
  '/painelpoker/suprema-db.js',
  '/painelpoker/suprema-presence.js',
  '/painelpoker/suprema-motion.js',
  '/painelpoker/suprema-insights.js',
  '/painelpoker/painel.css',
  '/painelpoker/painel.js',
  // painel.js DEPENDE de painel-calc (classify/toNumber/acoes) — sem ele offline
  // o painel não renderiza. painel-actions traduz os [data-act] em cliques:
  // sem ele os botões da nav e dos filtros ficam mudos.
  '/painelpoker/painel-calc.js',
  '/painelpoker/painel-actions.js',
  // deps do dashboard cash agora locais (offline-safe)
  '/painelpoker/vendor/chart.umd.js',
  '/painelpoker/vendor/phosphor/regular.css',
  '/painelpoker/vendor/phosphor/fill.css',
  '/painelpoker/vendor/phosphor/Phosphor.woff2',
  '/painelpoker/vendor/phosphor/Phosphor-Fill.woff2',
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
