/* =========================================================================
   SUPREMA-FELTRO — o fundo em WebGL da Suprema TV.

   NÃO é um demo de partículas: é um fundo que CARREGA ESTADO. A máquina de
   cenas da TV dirige quatro entradas e a sala responde:

     accent(hex)  a cor da categoria da cena no ar (Main vermelho / Side azul /
                  Satélite violeta / dourado da casa). O fundo É a categoria.
     heat(0..1)   sobe quando há evento AO VIVO — a sala esquenta quando tem
                  torneio rolando.
     pulse()      onda de choque a cada corte de cena. É o "corte" da transmissão.
     boom()       celebração: bloom dourado e os motes disparam pra cima.

   POR QUE WEBGL, e não mais um canvas 2D:
   · O `SupremaMotion.network` custa O(n²) por frame — com 64 nós são 2016
     testes de distância, cada link com seu beginPath/stroke, 24h num telão.
   · O fundo em `linear-gradient(180deg,#0c0d12,#0b0c10,#090a0d)` espalha ~3
     níveis de luminância por 2000px+: em 4K isso FATURA EM FAIXAS. O dither
     do shader (interleaved gradient noise) mata o banding — é a razão técnica
     mais concreta de tudo isto existir.

   ORÇAMENTO (a TV roda em PC com GPU, mas precisa aguentar máquina fraca):
   · A névoa é de baixa frequência e os motes não têm borda dura, então NADA
     aqui precisa de resolução nativa. O backing store é limitado por tier
     (1600/1200/850px no maior lado) e o CSS reamplia com filtro bilinear —
     que é exatamente o que névoa e bokeh querem. Num telão 4K é a diferença
     entre 8,3M e 1,4M de fragmentos por frame, e é invisível.
   · Mede a MEDIANA do tempo de frame e cai de tier sozinho. Se nem o tier mais
     baixo segura, desmonta e chama onFallback() — o chamador volta pro canvas 2D.

   ROBUSTEZ (o telão nunca recarrega, e isso muda o que é "correto"):
   · webglcontextlost/restored: página aberta por horas PERDE o contexto (driver
     reinicia, máquina dorme, GPU troca). Sem preventDefault o navegador nem
     tenta restaurar — o telão apagava de madrugada e ninguém sabia por quê.
   · float32 degrada com o tempo ACUMULADO. Ver `pulse()`: o relógio é zerado
     dentro do corte de cena, o único instante em que o salto não aparece.
   · Pausa só com a aba escondida, nunca no blur da janela (a TV vive num
     segundo monitor; congelar quando o operador clica em outra janela seria
     o bug, não a economia).

   USO:
     const tv = SupremaFeltro.mount('.tv-bg', {
       gold:'#c9a84c', felt:'#22d47e', bg:'#0b0c10',
       onFallback: () => SupremaMotion.network('.tv-bg', {...})
     });
     tv.accent('#f06050'); tv.heat(1); tv.pulse(); tv.boom();

   Devolve null quando não monta (sem WebGL, html.lite) — aí o chamador decide.
   Os shaders são GLSL ES 1.00, que o contexto WebGL2 também aceita: um código
   só serve as duas versões, em vez de dois caminhos pra manter.
========================================================================= */
(function (global) {
  'use strict';

  /* mediump não segura o hash da névoa. O guard é o jeito padrão de pedir highp
     sem quebrar em GPU antiga (WebGL1 não GARANTE highp no fragment shader —
     no vertex shader, garante). */
  const FS_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif`;

  /* ── névoa: fBm com deformação de domínio ──
     OCTAVES entra por #define porque GLSL ES 1.00 exige limite de laço
     CONSTANTE — cair de tier recompila o shader (uma vez, não por frame).
     A rotação entre oitavas tira o alinhamento aos eixos; sem ela a névoa fica
     com cara de xadrez. */
  const FOG_FS = (octaves) => `${FS_PRECISION}
#define OCTAVES ${octaves}
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uBg, uGold, uFelt, uAccent;
uniform float uHeat, uPulse, uBoom;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++){
    v += a * noise(p);
    p = mat2(0.80, 0.60, -0.60, 0.80) * p * 2.03;
    a *= 0.5;
  }
  return v;
}
/* deformação de domínio: a névoa enrola em si mesma em vez de rolar reta */
float warp(vec2 p){
  vec2 q = vec2(fbm(p + vec2(0.0, uTime * 0.030)), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + uTime * 0.020),
                fbm(p + 2.0 * q + vec2(8.3, 2.8)));
  return fbm(p + 2.0 * r);
}
/* interleaved gradient noise — o dither que mata o banding em telão grande */
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

/* queda suave de 1 → 0. NÃO usar smoothstep(hi, lo, x) pra inverter: a spec do
   GLSL diz que o resultado é INDEFINIDO quando edge0 >= edge1. Funciona em todo
   driver que se conhece, mas "funciona na prática" não é garantia num telão que
   pode cair em qualquer GPU integrada de mini-PC. */
float falloff(float lo, float hi, float x){ return 1.0 - smoothstep(lo, hi, x); }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p  = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;   // corrigido pelo aspecto
  float f = warp(p * 1.6 + vec2(0.0, uTime * 0.012));
  float d = length(p);

  /* as duas luzes da casa — agora luzes DE VERDADE, não dois radial-gradient:
     dourado entrando pelo alto à direita, feltro subindo do rodapé à esquerda.

     AS INTENSIDADES SÃO CALIBRADAS PELO CSS QUE ELAS SUBSTITUEM, não pelo que
     "fica bonito num print": o tv.css pedia rgba(201,168,76,.14) no dourado e
     rgba(14,107,64,.22) no feltro. Passar disso estoura o canto superior
     direito — que é justamente onde o relógio e o badge AO VIVO são desenhados
     em texto branco por cima. Isto aqui é FUNDO; o palco é do texto. */
  float gold = falloff(0.0, 1.0, distance(uv, vec2(0.80,  1.06)) * 1.25);
  float felt = falloff(0.0, 1.0, distance(uv, vec2(0.08, -0.06)) * 1.15);

  vec3 col = uBg;
  col += uGold * gold * (0.05 + f * 0.13);
  col += uFelt * felt * (0.07 + f * 0.16);
  /* a categoria da cena tinge a névoa; AO VIVO sobe a intensidade */
  col += uAccent * (f * f) * (0.03 + uHeat * 0.15);

  /* corte de cena: anel que abre do centro enquanto o pulso decai */
  float ring = falloff(0.0, 0.06, abs(d - (1.0 - uPulse) * 1.6)) * uPulse;
  col += mix(uGold, uAccent, 0.5) * ring * 0.18;

  /* celebração: a sala inteira acende em dourado — o único momento em que o
     fundo tem licença pra subir, e ainda assim sem apagar o texto por cima */
  col += uGold * uBoom * (0.10 + f * 0.22) * falloff(0.0, 1.4, d);

  /* vinheta firme: protege os cantos, onde vive o chrome do canal */
  col *= 1.0 - 0.55 * smoothstep(0.35, 1.45, length(p * vec2(0.85, 1.0)));
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

  /* ══ VARIANTE 'mesa' — o fundo do HUB ══════════════════════════════════════
     Mesmos uniforms da névoa da TV (o maquinário não muda: tiers, dither,
     perda de contexto, fallback, reduced-motion — tudo reaproveitado). O que
     muda é a IMAGEM, porque o hub não é um telão de transmissão: é a porta de
     entrada, e a metáfora dele é a MESA.

     Três camadas, nesta ordem de leitura:
       1. o pano — trama de feltro, dois ruídos cruzados em ângulos diferentes.
          É o que dá textura de tecido em vez de gradiente liso.
       2. a luz rasante — o dourado da casa entrando pelo alto, como abajur
          sobre a mesa. Move devagar; é o que dá vida sem pedir atenção.
       3. a onda do cursor — uma ondulação suave que nasce onde o mouse está.
          É a única parte REATIVA, e é de propósito: o hub responde ao toque
          da pessoa, mas nada aqui pisca nem corre. Quem passa 10x por dia não
          pode ser agredido pelo próprio launcher.

     `uHeat` aqui é a PROGRESSÃO do operador (0..1 do nível): quanto mais alto,
     mais quente o dourado. O fundo conta quem você é na casa. */
  const MESA_FS = (octaves) => `${FS_PRECISION}
#define OCTAVES ${octaves}
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uBg, uGold, uFelt, uAccent;
uniform float uHeat, uPulse, uBoom;
uniform vec2  uMouse;          // 0..1 no espaço da tela; (-1,-1) = sem cursor

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
float falloff(float lo, float hi, float x){ return 1.0 - smoothstep(lo, hi, x); }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  /* CORREÇÃO 2 — normalizar pelo MENOR lado, não pelo Y.
     Dividir por uRes.y é o certo num quadro 16:9 (a TV). O hero do hub é uma
     faixa de ~6:1: ali o eixo X estica seis vezes e o ruído vira LISTRA
     horizontal. Pelo menor lado, o campo fica isotrópico em qualquer proporção. */
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);

  /* 1. O PANO.
     CORREÇÃO 1 — frequência BAIXA. A versão anterior tinha uma "trama" a 130×,
     e o Feltro reduz o backing store de propósito (1600/1200/850px) deixando o
     CSS reampliar em bilinear: detalhe fino nessa escala vira moiré e
     cintilação, não tecido. O cabeçalho deste arquivo já avisava que nada aqui
     pode depender de resolução nativa — a trama foi embora, fica só o volume. */
  float cloth = fbm(p * 1.5 + vec2(uTime * 0.005, uTime * 0.0035));
  vec3 col = uBg + uFelt * (0.028 + cloth * 0.070);

  /* 2. A LUZ RASANTE — abajur sobre a mesa.
     Ancorada em UV (0..1 do quadro), não no espaço isotrópico: assim ela fica
     no mesmo canto seja qual for a proporção. Intensidade calibrada pelo que
     substitui (os nós dourados a ~0.14 de alfa); acima disso come o contraste
     do título, que é texto claro por cima. Isto é FUNDO. */
  float lamp = falloff(0.0, 1.05, distance(uv, vec2(0.80, 1.00)) * 1.10);
  col += uGold * lamp * (0.050 + cloth * 0.10) * (0.75 + uHeat * 0.55);

  /* contraluz de feltro subindo pela esquerda — dá volume, tira o ar de papel */
  float rim = falloff(0.0, 1.0, distance(uv, vec2(0.06, -0.04)) * 1.15);
  col += uFelt * rim * (0.040 + cloth * 0.085);

  /* 3. A ONDA DO CURSOR — amortecida, e agora no mesmo espaço isotrópico do
     pano, senão o anel vira elipse achatada num hero largo. */
  if (uMouse.x >= 0.0){
    vec2 m = (uMouse * uRes - 0.5 * uRes) / min(uRes.x, uRes.y);
    float d = length(p - m);
    float wave = sin(d * 7.0 - uTime * 1.2) * falloff(0.0, 0.55, d);
    col += mix(uGold, uAccent, 0.35) * wave * 0.026;
  }

  /* pulso e boom continuam existindo (a API é a mesma) — aqui em dose menor:
     no hub eles marcam conquista, não corte de transmissão. */
  float d0 = length(p);
  float ring = falloff(0.0, 0.07, abs(d0 - (1.0 - uPulse) * 1.5)) * uPulse;
  col += mix(uGold, uAccent, 0.5) * ring * 0.12;
  col += uGold * uBoom * 0.10;

  /* dither: mata o banding do degradê em tela grande — a razão técnica de todo
     este arquivo existir (ver cabeçalho). */
  float dth = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (dth - 0.5) / 255.0;

  gl_FragColor = vec4(col, 1.0);
}`;

  /* um TRIÂNGULO que cobre a tela, não dois: sem a costura da diagonal e com
     menos invocação de vértice — o padrão pra passe fullscreen */
  const FOG_VS = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  /* ── motes dourados ──
     Posição calculada NO VERTEX SHADER a partir de uma semente fixa: zero
     trabalho de CPU por frame, ao contrário do confete/rede em canvas 2D.
     highp aqui não é luxo — em mediump o uTime acumulado vira degrau depois de
     alguns minutos no ar e os motes congelam. */
  const DUST_VS = `
precision highp float;
attribute vec3 aSeed;             // x,y: origem  ·  z: velocidade/tamanho
uniform highp float uTime, uPx;
/* uBoom e vA são MEDIUMP DE PROPÓSITO, e explicitamente: o fragment shader roda
   em mediump, e uniform/varying com o mesmo nome e precisões diferentes entre
   os estágios é ERRO DE LINK ("Precisions of uniform 'uBoom' differ between
   VERTEX and FRAGMENT shaders"). Ambos vivem em 0..1 — mediump sobra. */
uniform mediump float uBoom;
varying mediump float vA;
void main(){
  float t = uTime * (0.020 + aSeed.z * 0.05);
  float x = fract(aSeed.x + sin(t * 0.7 + aSeed.y * 6.2831) * 0.06);
  float y = fract(aSeed.y + t * (0.6 + uBoom * 4.0));   // sobe; dispara na celebração
  gl_Position  = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (1.0 + aSeed.z * 2.5) * uPx * (1.0 + uBoom * 1.5);
  /* apaga nas duas pontas: sem isto o mote PISCA ao dar a volta no fract().
     Os dois smoothstep têm edge0 < edge1 de propósito — invertido é indefinido
     pela spec (ver falloff() na névoa). */
  vA = smoothstep(0.0, 0.15, y) * (1.0 - smoothstep(0.85, 1.0, y)) * (0.25 + aSeed.z * 0.5);
}`;

  const DUST_FS = `
precision mediump float;
uniform vec3 uGold;
uniform mediump float uBoom;      // precisão CASA com o vertex (ver DUST_VS)
varying mediump float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = vA * (1.0 - smoothstep(0.0, 0.5, d));   // disco macio, borda nenhuma
  gl_FragColor = vec4(uGold * (1.0 + uBoom), a);    // aditivo (ver blendFunc)
}`;

  const TIERS = [
    { id: 'alto',  octaves: 5, maxDim: 1600, dust: 900 },
    { id: 'medio', octaves: 4, maxDim: 1200, dust: 520 },
    { id: 'baixo', octaves: 3, maxDim: 850,  dust: 240 },
  ];
  const SEIS_HORAS = 6 * 3600 * 1000;

  function hexRgb(hex){
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0]+h[0] + h[1]+h[1] + h[2]+h[2];
    const n = parseInt(h, 16);
    return isFinite(n) ? [ ((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255 ] : [0.5, 0.5, 0.5];
  }

  function compile(gl, type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.error('[Feltro] shader não compilou:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }
  function program(gl, vsSrc, fsSrc){
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)){
      console.error('[Feltro] program não linkou:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }
  /* localizações resolvidas UMA vez por build: getUniformLocation é uma busca
     por string no driver e não tem o que fazer dentro do laço de render */
  function locs(gl, prog, names){
    const m = {};
    names.forEach(n => { m[n] = gl.getUniformLocation(prog, n); });
    return m;
  }

  let cssDone = false;
  function injectCss(){
    if (cssDone || !document.head) return;
    cssDone = true;
    const s = document.createElement('style');
    s.textContent = '.sp-feltro{position:absolute;inset:0;z-index:0;pointer-events:none;' +
                    'width:100%;height:100%;display:block}';
    document.head.appendChild(s);
  }

  function mount(selector, opts){
    opts = opts || {};
    const host = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!host) return null;
    /* modo leve: o fundo em CSS já está lá e basta. Não é degradação de
       qualidade — é respeitar o interruptor global do OS. */
    if (document.documentElement.classList.contains('lite')) return null;
    if (host.__spFeltro) return host.__spFeltro;

    const calm = !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    injectCss();
    const cv = document.createElement('canvas');
    cv.className = 'sp-feltro';
    cv.setAttribute('aria-hidden', 'true');

    const attrs = { alpha:false, antialias:false, depth:false, stencil:false,
                    preserveDrawingBuffer:false, powerPreference:'high-performance' };
    const gl = cv.getContext('webgl2', attrs) || cv.getContext('webgl', attrs) ||
               cv.getContext('experimental-webgl', attrs);
    if (!gl){
      console.info('[Feltro] sem WebGL — devolvendo o fundo pro chamador');
      if (opts.onFallback) opts.onFallback();
      return null;
    }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.prepend(cv);

    const COL = {
      bg:   hexRgb(opts.bg   || '#0b0c10'),
      gold: hexRgb(opts.gold || '#c9a84c'),
      felt: hexRgb(opts.felt || '#22d47e'),
    };

    let tier = 0, dead = false, lost = false, raf = 0, last = 0;
    let fogP = null, dustP = null, fogU = null, dustU = null, fogA = 0, dustA = 0;
    let quadBuf = null, dustBuf = null;
    let dustN = 0;                 // quantos motes ESTE mount desenha (varia por variante)
    let W = 0, H = 0, px = 1;
    let t0 = performance.now();

    /* estado dirigido pela TV. O alvo é PERSEGUIDO, não atribuído: sem a
       suavização a cor da categoria trocaria num estalo no corte de cena. */
    let accent = hexRgb(opts.gold || '#c9a84c');
    let accentTo = accent.slice();
    let heat = 0, heatTo = 0, pulse = 0, boom = 0;
    /* (-1,-1) = sem cursor: o shader da mesa checa `uMouse.x >= 0.0` e pula a
       onda inteira. Em touch o ponteiro nunca chega, e é o certo — ondulação
       presa no último toque pareceria bug. */
    let mouse = [-1, -1], mouseTo = [-1, -1];

    function build(){
      const t = TIERS[tier];
      /* variante 'mesa' = fundo do hub; sem variante = a névoa da TV, byte a
         byte como antes (o caminho da TV não pode mudar por causa do hub). */
      const FS = opts.variant === 'mesa' ? MESA_FS : FOG_FS;
      fogP  = program(gl, FOG_VS, FS(t.octaves));
      dustP = program(gl, DUST_VS, DUST_FS);
      if (!fogP || !dustP) return false;

      /* uMouse só existe no shader da mesa. Pedir a location dele na TV devolve
         null, e `gl.uniform2f(null, …)` é no-op por especificação — então a
         mesma lista serve pras duas variantes, sem ramificação. */
      fogU  = locs(gl, fogP, ['uRes','uTime','uBg','uGold','uFelt','uAccent','uHeat','uPulse','uBoom','uMouse']);
      dustU = locs(gl, dustP, ['uTime','uBoom','uPx','uGold']);
      fogA  = gl.getAttribLocation(fogP, 'aPos');
      dustA = gl.getAttribLocation(dustP, 'aSeed');

      quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

      /* CORREÇÃO 3 — densidade de motes por VARIANTE.
         Os 900 do tier alto foram pensados pra atravessar um telão inteiro. No
         hero do hub (uma faixa de ~200px de altura) a mesma conta vira enxame:
         não lê como poeira dourada, lê como ruído. A mesa fica com um sexto. */
      dustN = opts.variant === 'mesa' ? Math.round(t.dust / 6) : t.dust;
      const seeds = new Float32Array(dustN * 3);
      for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
      dustBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
      gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      return true;
    }

    function size(){
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const t = TIERS[tier];
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      /* teto de resolução por tier — a névoa não ganha NADA com pixel nativo, e
         num 4K a conta seria 8,3M de fragmentos por frame à toa */
      const cap = Math.min(1, t.maxDim / Math.max(r.width, r.height));
      px = dpr * cap;
      W = cv.width  = Math.max(1, Math.round(r.width  * px));
      H = cv.height = Math.max(1, Math.round(r.height * px));
      gl.viewport(0, 0, W, H);
    }

    function draw(now){
      const t = (now - t0) / 1000;

      gl.useProgram(fogP);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(fogA);
      gl.vertexAttribPointer(fogA, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(fogU.uRes, W, H);
      gl.uniform1f(fogU.uTime, t);
      gl.uniform3fv(fogU.uBg, COL.bg);
      gl.uniform3fv(fogU.uGold, COL.gold);
      gl.uniform3fv(fogU.uFelt, COL.felt);
      gl.uniform3fv(fogU.uAccent, accent);
      /* cursor: perseguição AMORTECIDA, não 1:1. Seguir exato parece
         cursor-glow de CSS; o atraso é o que dá peso de matéria. */
      mouse[0] += (mouseTo[0] - mouse[0]) * 0.06;
      mouse[1] += (mouseTo[1] - mouse[1]) * 0.06;
      gl.uniform2f(fogU.uMouse, mouse[0], mouse[1]);
      gl.uniform1f(fogU.uHeat, heat);
      gl.uniform1f(fogU.uPulse, pulse);
      gl.uniform1f(fogU.uBoom, boom);
      gl.blendFunc(gl.ONE, gl.ZERO);                 // a névoa É o fundo: escreve por cima
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(dustP);
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
      gl.enableVertexAttribArray(dustA);
      gl.vertexAttribPointer(dustA, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(dustU.uTime, t);
      gl.uniform1f(dustU.uBoom, boom);
      gl.uniform1f(dustU.uPx, px);
      gl.uniform3fv(dustU.uGold, COL.gold);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);            // motes ADITIVOS: são luz, não tinta
      /* dustN, NÃO TIERS[tier].dust: a mesa usa um sexto dos motes, e pedir a
         contagem do tier desenharia além do buffer de sementes. */
      gl.drawArrays(gl.POINTS, 0, dustN);
    }

    /* ── vigia de performance: mede e cai de tier sozinho ──
       Usa a MEDIANA, não a média: um único frame ruim (GC, compilação, o
       primeiro paint) não pode condenar uma GPU boa a rodar no tier baixo. */
    let samples = [], watching = true;
    function watchPerf(dt){
      if (!watching) return;
      samples.push(dt);
      if (samples.length < 90) return;
      samples.sort((a, b) => a - b);
      const median = samples[45];
      samples = [];
      if (median <= 20){ watching = false; return; }        // ~50fps ou mais: está bom
      if (tier < TIERS.length - 1){
        tier++;
        console.info(`[Feltro] ${median.toFixed(1)}ms por frame — caindo pro tier "${TIERS[tier].id}"`);
        teardownGl();
        if (!build()){ giveUp(); return; }
        size();
      } else {
        console.info(`[Feltro] ${median.toFixed(1)}ms no tier mais baixo — devolvendo o fundo`);
        giveUp();
      }
    }
    function giveUp(){
      destroy();
      if (opts.onFallback) opts.onFallback();
    }

    function frame(now){
      raf = 0;
      if (dead || lost) return;
      const dt = last ? Math.min(100, now - last) : 16;   // clamp: uma aba que voltou não pode dar um salto
      last = now;

      const k = Math.min(1, dt / 260);
      for (let i = 0; i < 3; i++) accent[i] += (accentTo[i] - accent[i]) * k;
      heat  += (heatTo - heat) * Math.min(1, dt / 900);
      pulse *= Math.exp(-dt / 260);                        // corte: estala e some
      boom  *= Math.exp(-dt / 1400);                       // celebração: segura mais
      if (pulse < 0.002) pulse = 0;
      if (boom  < 0.002) boom  = 0;

      draw(now);
      watchPerf(dt);
      if (!dead && !lost) raf = requestAnimationFrame(frame);
    }
    function wake(){
      if (dead || lost || raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop(){ if (raf){ cancelAnimationFrame(raf); raf = 0; } }
    function drawOnce(){ if (!dead && !lost) draw(performance.now()); }

    function teardownGl(){
      stop();
      if (quadBuf) gl.deleteBuffer(quadBuf);
      if (dustBuf) gl.deleteBuffer(dustBuf);
      if (fogP) gl.deleteProgram(fogP);
      if (dustP) gl.deleteProgram(dustP);
      quadBuf = dustBuf = fogP = dustP = null;
    }

    /* ── ciclo de vida ── os handlers ficam guardados pra sair limpo no destroy */
    const onLost = (e) => {
      e.preventDefault();               // sem isto o navegador NEM TENTA restaurar
      lost = true; stop();
      console.warn('[Feltro] contexto WebGL perdido — aguardando restauração');
    };
    const onRestored = () => {
      console.info('[Feltro] contexto restaurado — remontando');
      lost = false;
      if (!build()){ giveUp(); return; }
      size();
      if (calm) drawOnce(); else wake();
    };
    const onVis = () => { if (document.hidden) stop(); else if (!calm) wake(); };
    let rsz = 0;
    const onResize = () => {
      clearTimeout(rsz);
      rsz = setTimeout(() => { size(); if (calm) drawOnce(); }, 150);
    };
    cv.addEventListener('webglcontextlost', onLost);
    cv.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', onVis);
    global.addEventListener('resize', onResize, { passive:true });

    function destroy(){
      if (dead) return;
      dead = true;
      teardownGl();
      cv.removeEventListener('webglcontextlost', onLost);
      cv.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVis);
      global.removeEventListener('resize', onResize);
      clearTimeout(rsz);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      if (cv.isConnected) cv.remove();
      host.__spFeltro = null;
    }

    if (!build()){                       // shader não compilou nesta GPU
      destroy();
      if (opts.onFallback) opts.onFallback();
      return null;
    }
    size();

    /* reduced-motion: UM frame estático, e só. O visual continua (a névoa e o
       dither não são "animação" — e são melhores que o gradiente CSS), mas nada
       se mexe. Desligar tudo puniria quem só pediu pra não ter movimento. */
    if (calm) drawOnce(); else wake();

    const api = {
      /* a cor da categoria da cena no ar.
         Em reduced-motion NÃO há rAF, logo ninguém persegue o alvo — sem o
         snap abaixo a névoa ficaria presa no dourado inicial pra sempre. */
      accent(hex){
        accentTo = hexRgb(hex);
        if (calm){ accent = accentTo.slice(); drawOnce(); }
        return api;
      },
      /* 0..1 — quanto de "AO VIVO" tem no ar agora */
      heat(v){
        heatTo = Math.max(0, Math.min(1, +v || 0));
        if (calm){ heat = heatTo; drawOnce(); }
        return api;
      },
      /* o corte da transmissão */
      pulse(){
        if (calm) return api;
        pulse = 1;
        /* O RELÓGIO É ZERADO AQUI, e só aqui. float32 perde resolução conforme
           uTime cresce: depois de muitas horas no ar (o telão nunca recarrega)
           a névoa passa a andar em degraus. Zerar t0 dá um salto na névoa — e o
           corte de cena, com a tela trocando e o anel abrindo, é o único
           instante em que esse salto não aparece. */
        if (performance.now() - t0 > SEIS_HORAS) t0 = performance.now();
        wake();
        return api;
      },
      /* premiação bateu o garantido */
      boom(){ if (!calm){ boom = 1; wake(); } return api; },
      tier(){ return TIERS[tier].id; },
      /* posição do cursor em 0..1 (x da esquerda, y de BAIXO — espaço do
         gl_FragCoord). `null` solta o cursor e a onda some.
         Só a variante 'mesa' usa; na TV é no-op silencioso. */
      mouse(x, y){
        if (x === null || x === undefined){ mouseTo = [-1, -1]; mouse = [-1, -1]; }
        else { mouseTo = [x, y]; if (mouse[0] < 0) mouse = [x, y]; }  // 1ª leitura não varre a tela
        if (calm) drawOnce(); else wake();
        return api;
      },
      destroy,
    };
    host.__spFeltro = api;
    return api;
  }

  global.SupremaFeltro = { mount };
})(window);
