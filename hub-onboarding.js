  /* tour de 1ª visita do hub — só pra quem já entrou (tem sessão salva) */
  (function(){
    var logged = false;
    try { logged = !!JSON.parse(localStorage.getItem('suprema_session_v1')||'null'); } catch(e){}
    if(!logged) return;
    SupremaOnboarding.start('hub', [
      { el:'.t-painel', title:'Suas ferramentas', text:'Cada card abre um produto da operação. O Painel do Dia é o coração: grade de torneios, GU e conferências.', side:'right' },
      { el:'#avisosSection', title:'Avisos da casa', text:'Erros de atualização e informativos importantes aparecem aqui no topo. Você pode dispensar cada um.', side:'bottom' },
      { el:'#themeBtn', title:'Tema claro ou escuro', text:'Alterna a aparência — e a escolha te acompanha em todos os painéis.', side:'left' },
      { el:'#lbBoard', title:'Mesa dos campeões', text:'Quanto mais você usa o Suprema OS, mais XP e títulos desbloqueia. Acompanhe o ranking aqui.', side:'top' }
    ], { accent:'#18a36b', label:'Suprema OS' });
  })();
