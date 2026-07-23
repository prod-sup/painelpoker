// Suprema Poker — Service Worker
// IMPORTANTE: incremente SW_VERSION a cada deploy — é isso que faz as abas abertas
// receberem o aviso de "nova versão disponível" e ninguém operar com código velho
const SW_VERSION = '3.37.0';
const CACHE_NAME = `suprema-painel-v${SW_VERSION}`;
// BASE derivada da própria URL do SW: '/' na Vercel (painelpoker.vercel.app/) e
// '/painelpoker/' no GitHub Pages. Os assets abaixo são RELATIVOS e recebem a base
// no .map() — assim o precache funciona nos dois hosts sem hardcode de caminho.
const BASE = self.location.pathname.replace(/sw\.js$/, '');
const STATIC_ASSETS = [
  'index.html',
  'criacao-noturna.html',
  'gu-parser.js',
  'conf-dia.js',
  'scripts/lite.js',
  'suprema-xlsx.js',
  // NÃO precache o xlsx.full.min.js (861KB): o suprema-xlsx.js existe justamente pra baixá-lo
  // só na PRIMEIRA importação/exportação. Precachear aqui trazia os 861KB na instalação do SW
  // pra todo operador, inclusive quem nunca exporta — anulando o carregamento sob demanda.
  // Quem usar a exportação baixa uma vez e o runtime cache (network-first, abaixo) guarda.
  'suprema-onboarding.js',
  /* cada .html precacheado precisa dos SEUS js/css também — senão a página abre
     offline mas sem cérebro/estilo na primeira visita sem rede */
  'hub.html',
  'hub.js',
  'hub-onboarding.js',   // o hub.html carrega — estava fora do precache
  'hub.css',
  'admin.html',
  'admin.js',
  // sem admin-actions os [data-act] do admin ficam mudos (nenhum botão responde)
  'admin-actions.js',
  'admin.css',
  'criacao-noturna.js',
  // criacao-noturna.js DEPENDE de criacao-calc (parsing/fee/early bird):
  // sem ele offline, a receita não renderiza.
  'criacao-calc.js',
  'criacao-noturna.css',
  'dashboard-mesa-cash.html',
  'dashboard-mesa-cash.js',
  'dashboard-mesa-cash.css',
  'eventos.html',
  'eventos.css',
  'eventos.js',
  'radar-core.js',
  'analytics.html',
  'analytics.css',
  'analytics.js',
  'analytics-core.js',
  // o Worker de parse da Global: sem ele no cache, o Radar/TV offline perdem o
  // caminho rápido e caem no parse síncrono (funciona, mas trava a aba)
  'suprema-global-worker.js',
  'tv.html',
  'tv.css',
  'tv.js',
  // O Feltro: o fundo em WebGL da TV. Sem ele o canal cai na rede de nós 2D.
  'suprema-feltro.js',
  'suprema-tokens.css',
  // PWA: manifest + ícones precisam existir offline pro app instalado abrir sem rede
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  // shell do "OS": os módulos compartilhados precisam existir offline, senão o
  // gate/sessão/presença/tema não sobem sem rede e a promessa de OS se quebra
  'suprema-auth.js',
  'suprema-shell.js',
  'suprema-palette.js',
  'suprema-copiloto.js',
  'suprema-db.js',
  'suprema-presence.js',
  'suprema-motion.js',
  'suprema-insights.js',
  'painel.css',
  'painel.js',
  // painel.js DEPENDE de painel-calc (classify/toNumber/acoes) — sem ele offline
  // o painel não renderiza. painel-actions traduz os [data-act] em cliques:
  // sem ele os botões da nav e dos filtros ficam mudos.
  'painel-calc.js',
  'painel-actions.js',
  // deps do dashboard cash agora locais (offline-safe)
  'vendor/chart.umd.js',
  'vendor/phosphor/regular.css',
  'vendor/phosphor/fill.css',
  'vendor/phosphor/Phosphor.woff2',
  'vendor/phosphor/Phosphor-Fill.woff2',
].map(p => BASE + p);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // allSettled + add individual: um asset que falhe (404) não derruba o precache
      // inteiro — ao contrário do addAll, que é atômico (uma falha zera tudo).
      .then(cache => Promise.allSettled(STATIC_ASSETS.map(a => cache.add(a))))
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
