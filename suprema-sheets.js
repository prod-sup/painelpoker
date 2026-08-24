/* =========================================================================
   SUPREMA-SHEETS — backup do dia para o Google Sheets (formato Acompanhamento)

   POR QUÊ
   -------
   Um formato SÓ, usado em dois lugares:
     • Admin  → botão "Enviar hoje para Sheets" (envio manual).
     • Painel → auto-backup quando o ÚLTIMO resultado do dia é preenchido.
   Se ficasse duplicado em cada arquivo, um dia divergiria do outro. Aqui mora a
   verdade: cabeçalho, agrupamento (Main/Side/Satélite, em ordem cronológica) e o
   cálculo de Ações/Overlay.

   UMA ABA POR DIA: o nome da aba é a data (DD/MM/AAAA) — SEMPRE a mesma pro mesmo
   dia. O Apps Script limpa e reescreve essa aba, então puxar de novo no mesmo dia
   SOBRESCREVE com os dados atualizados; nunca cria "dois dia 30".

   Colunas (nesta ordem):
     Torneio · Hora · Late · Garantido · Buy-in · Arrecadado · Overlay · Field · Ações · Status
   ("Arrecadado" = a antiga "Premiação".)
   ========================================================================= */
(function (root) {
  'use strict';

  var HEADER = ['Torneio', 'Hora', 'Late', 'Garantido', 'Buy-in', 'Arrecadado', 'Overlay', 'Field', 'Ações', 'Status'];

  /* Seções na ordem do Acompanhamento. "reg" (regulares) fecha a lista se sobrar algo. */
  var SECTIONS = [
    { key: 'main', label: 'MAIN EVENT' },
    { key: 'side', label: 'SIDE EVENT' },
    { key: 'sat',  label: 'SATÉLITE' },
    { key: 'reg',  label: 'REGULARES' },
  ];

  function tmin(h) {
    var m = /(\d{1,2}):(\d{2})/.exec(String(h || ''));
    return m ? (+m[1]) * 60 + (+m[2]) : 99999;   // sem hora → fim da lista
  }
  function n(v) {
    if (v == null || v === '') return null;
    var x = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
    return isNaN(x) ? null : x;
  }
  /* Célula numérica pro Sheets (número de verdade → dá pra somar); vazio se não há. */
  function cell(v) { var x = n(v); return x == null ? '' : x; }

  function hasCampanha(nome) {
    var u = String(nome || '').toUpperCase();
    return u.includes('#AS') || u.includes('SPT') || u.includes('SPS');
  }
  /* Buy-in líquido quando NÃO há fee da GU: satélite 5%, campanha 12%, resto 10%
     — espelha o PainelCalc. */
  function rakeFactor(cat, camp) { return cat === 'sat' ? 0.95 : camp ? 0.88 : 0.90; }

  /* Rake da GU: colunas FEE + ADMIN FEE que vêm coladas na linha. É esta que
     manda; a regra por categoria acima só responde por linha sem as colunas
     (dado antigo, Liga Principal). Espelha PainelCalc.guRates — este arquivo é
     carregado sozinho em algumas páginas e não pode depender dele. */
  function guFrac(v) {
    var x = n(v);
    if (x == null || !isFinite(x) || x < 0) return null;
    var f = x > 1 ? x / 100 : x;
    return f >= 1 ? null : f;
  }
  function guTotal(r) {
    var fee = guFrac(r.fee);
    if (fee == null) return null;
    var adm = guFrac(r.adminFee) || 0;
    var t = fee + adm;
    return t >= 1 ? null : t;
  }

  /* Ações = premiação ÷ buy-in líquido (ou field, antes da premiação sair). */
  function acoesOf(r) {
    var prem = n(r.premiacao), buyin = n(r.buyin), field = n(r.field);
    if (buyin != null && buyin > 0) {
      var gu = guTotal(r);
      var liq = buyin * (gu != null ? (1 - gu) : rakeFactor(r.cat, hasCampanha(r.nome)));
      if (prem != null && prem > 0 && liq > 0) return Math.round((prem / liq) * 10) / 10;
      if (field != null && field > 0) return field;
    }
    return null;
  }
  /* Overlay = premiação − garantido, só quando negativo (a casa cobriu). */
  function overlayOf(r) {
    var prem = n(r.premiacao), gar = n(r.garantido);
    if (prem == null || gar == null) return null;
    var d = prem - gar;
    return d < 0 ? d : null;
  }
  function statusLabel(r) {
    if (r.status) {
      var s = String(r.status).toLowerCase();
      if (s === 'nf' || s.indexOf('não form') === 0 || s.indexOf('nao form') === 0) return 'Não formou';
      if (s === 'fechado') return 'Fechado';
      if (s === 'aberto') return 'Aberto';
      return r.status;
    }
    if (String(r.id || '').toUpperCase() === 'NF') return 'Não formou';
    return n(r.premiacao) != null ? 'Fechado' : 'Aberto';
  }
  function catOf(r) {
    var c = (r.cat || '').toLowerCase();
    return (c === 'main' || c === 'side' || c === 'sat') ? c : 'reg';
  }

  /* YYYY-MM-DD → DD/MM/AAAA — nome ESTÁVEL da aba (mesmo dia = mesma aba). */
  function sheetLabel(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : String(iso || '');
  }

  /* rows: [{nome,hora,late,cat,garantido,buyin,premiacao,field,status?,id?}]
     → { grid:[[...]], style:{headerRow, sectionRows:[...]} } */
  function buildGrid(rows) {
    var grid = [HEADER.slice()];
    var sectionRows = [];
    SECTIONS.forEach(function (sec) {
      var list = (rows || []).filter(function (r) { return r && r.nome && catOf(r) === sec.key; })
                             .sort(function (a, b) { return tmin(a.hora) - tmin(b.hora); });
      if (!list.length) return;
      sectionRows.push(grid.length);                 // índice (0-based) da linha da seção
      var head = [sec.label]; while (head.length < HEADER.length) head.push('');
      grid.push(head);
      list.forEach(function (r) {
        grid.push([
          r.nome || '', r.hora || '', r.late || '',
          cell(r.garantido), cell(r.buyin), cell(r.premiacao),
          cell(overlayOf(r)), cell(r.field), cell(acoesOf(r)),
          statusLabel(r),
        ]);
      });
    });
    return { grid: grid, style: { headerRow: 0, sectionRows: sectionRows } };
  }

  /* POST resiliente. cfg:{url,secret}. isoDate:'YYYY-MM-DD'. built = buildGrid(...).
     O Apps Script responde via redirect pro googleusercontent SEM header CORS, então
     res.json() estoura mesmo com o POST entregue — por isso o fallback no-cors. */
  function send(cfg, isoDate, built) {
    var url = cfg && cfg.url;
    if (!url) return Promise.resolve({ ok: false, sent: false, confirmed: false, error: 'sem-url', rows: 0 });
    var dataRows = Math.max(0, built.grid.length - 1 - built.style.sectionRows.length);
    var payload = JSON.stringify({
      date:  sheetLabel(isoDate),
      grid:  built.grid,
      style: built.style,
      secret: (cfg.secret || ''),
    });
    var out = { ok: false, sent: false, confirmed: false, error: '', rows: dataRows };
    return fetch(url, { method: 'POST', redirect: 'follow', body: payload })
      .then(function (res) {
        out.sent = true;
        return res.json().then(function (json) {
          if (json && json.ok) { out.confirmed = true; }
          else if (json && json.error) { out.error = json.error; }
        }).catch(function () { /* CORS: não dá pra ler, mas o POST foi entregue */ });
      })
      .catch(function () {
        return fetch(url, { method: 'POST', mode: 'no-cors', body: payload })
          .then(function () { out.sent = true; })
          .catch(function () { out.sent = false; });
      })
      .then(function () { out.ok = out.confirmed || out.sent; return out; });
  }

  /* Assinatura do estado do dia — pra só reenviar quando algo REALMENTE mudou
     (o auto-backup dispara em cada listener; sem isso, mandaria igual à toa). */
  function signature(rows) {
    return (rows || []).filter(function (r) { return r && r.nome; })
      .map(function (r) {
        return [r.nome, r.hora, n(r.premiacao), n(r.field), n(r.garantido), r.id || '', statusLabel(r)].join('~');
      }).sort().join('|');
  }

  root.SupremaSheets = {
    HEADER: HEADER,
    buildGrid: buildGrid,
    send: send,
    sheetLabel: sheetLabel,
    signature: signature,
  };
})(typeof window !== 'undefined' ? window : this);
