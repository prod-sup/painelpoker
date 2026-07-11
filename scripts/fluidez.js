/* ============================================================
   SONDA DE FLUIDEZ — Suprema OS
   Cole este arquivo inteiro no Console (F12) de qualquer painel
   ABERTO E VISÍVEL e leia a tabela. Rode antes de cada deploy
   que mexa em CSS/JS pesado e compare com a última medição.

   O que cada número significa (e o alvo):
   · longTasks / piorMs ... travadas >50ms desde o load (alvo: 0–2, pior <200ms)
   · fpsMedio ............. taxa de quadros em 2s de scroll (alvo: >50)
   · nosDom ............... tamanho do DOM (alarme acima de ~15k)
   · blur ................. superfícies com backdrop-filter (alarme acima de ~15)
   · animacoes ............ animações CSS ativas agora
   · reflow20ms ........... custo de 20 layouts forçados (alvo: <40ms)
   · pointermove300ms ..... custo de 300 eventos de mouse (alvo: <10ms)
   ============================================================ */
(async function fluidez(){
  const out = { pagina: location.pathname };

  // travadas registradas desde o load
  try {
    const entries = [];
    new PerformanceObserver(l => entries.push(...l.getEntries()))
      .observe({ type: 'longtask', buffered: true });
    await new Promise(r => setTimeout(r, 120));
    out.longTasks = entries.length;
    out.piorMs = entries.length ? Math.round(Math.max(...entries.map(e => e.duration))) : 0;
  } catch (e) { out.longTasks = 'n/d'; }

  // FPS durante 2s de scroll sintético (só funciona com a aba visível)
  if (!document.hidden) {
    out.fpsMedio = await new Promise(res => {
      const deltas = []; let last = performance.now(), n = 0, dir = 1;
      const sc = setInterval(() => { scrollBy(0, 80 * dir); if (scrollY > 2500) dir = -1; if (scrollY <= 0) dir = 1; }, 16);
      const loop = t => {
        deltas.push(t - last); last = t;
        if (++n < 120) requestAnimationFrame(loop);
        else { clearInterval(sc); scrollTo(0, 0); res(Math.round(1000 / (deltas.reduce((a, b) => a + b) / deltas.length))); }
      };
      requestAnimationFrame(loop);
    });
  } else out.fpsMedio = 'aba oculta';

  out.nosDom = document.querySelectorAll('*').length;
  out.animacoes = document.getAnimations().length;

  let blur = 0;
  document.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el);
    if (s.backdropFilter && s.backdropFilter !== 'none') blur++;
  });
  out.blur = blur;

  const t1 = performance.now();
  for (let i = 0; i < 20; i++) { document.body.style.paddingBottom = (i % 2) + 'px'; void document.body.offsetHeight; }
  document.body.style.paddingBottom = '';
  out.reflow20ms = Math.round(performance.now() - t1);

  const alvo = document.querySelector('.tile, .tcard, .card, .kpi');
  if (alvo) {
    const r = alvo.getBoundingClientRect();
    const t0 = performance.now();
    for (let i = 0; i < 300; i++)
      alvo.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 10 + (i % 40), clientY: r.top + 10, bubbles: true }));
    out.pointermove300ms = Math.round(performance.now() - t0);
  }

  console.table([out]);
  return out;
})();
