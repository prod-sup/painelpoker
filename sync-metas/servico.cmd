@echo off
title Suprema - Sync Metas (servico - nao abrir a mao)
REM =========================================================================
REM  Servico de sync das Metas (PokerByte -> painel).
REM
REM  Chamado pela Tarefa Agendada "Suprema - Sync Metas". Nao deve ser aberto
REM  a mao: quem opera e o painel.
REM
REM  SEM ACENTO NESTE ARQUIVO, DE PROPOSITO.
REM  O interpretador do Windows le o .cmd em bytes antes de qualquer chcp valer.
REM  Com acento em UTF-8 ele quebra linhas no meio e pedacos de texto viram
REM  comando. Foi o que derrubou o RELOGAR-POKERBYTE.cmd.
REM
REM  SE LOCALIZA SOZINHO (%~dp0 = a pasta deste arquivo), entao funciona tanto
REM  no repositorio quanto instalado em %LOCALAPPDATA%\SupremaSyncMetas\app.
REM
REM  Roda em laco (WATCH): sincroniza a cada INTERVALO_MIN e atende na hora o
REM  botao "Atualizar agora" da secao Metas.
REM =========================================================================
setlocal

set "APP=%~dp0"
set "ESTADO=%LOCALAPPDATA%\SupremaSyncMetas"

set WATCH=1
set INTERVALO_MIN=10


REM ---------------------------------------------------------------------
REM  TRAVA DE INSTANCIA UNICA
REM  Este arquivo roda em LACO INFINITO. Aberto a mao (duplo clique, ou
REM  arrastado pro terminal) ele: (a) deixa uma janela preta na tela do
REM  operador pra sempre; (b) sobe um SEGUNDO robo competindo com o da
REM  Tarefa Agendada - dois lideres e dois Edge na mesma maquina; e (c) se
REM  alguem aperta Ctrl+C nessa janela, o Windows pergunta "Deseja finalizar
REM  o arquivo em lotes (S/N)?" e fica parado esperando resposta.
REM  Se ja ha um robo vivo, sai avisando em vez de duplicar.
REM ---------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'sync.mjs' }) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo.
  echo  O robo das Metas JA esta rodando nesta maquina.
  echo  Nao precisa abrir este arquivo - quem cuida dele e a Tarefa Agendada.
  echo  Pode fechar esta janela.
  echo.
  timeout /t 10 /nobreak ^>nul
  exit /b 0
)
cd /d "%APP%"
if not exist "%ESTADO%" mkdir "%ESTADO%"

REM ---------------------------------------------------------------------
REM  ONDE ESTA O NODE - RESOLVE em vez de fixar UMA versao.
REM  Antes o caminho era a versao 24.18.0 e ponto final. Em maquina que baixou
REM  outra versao, ou que ja tinha Node no sistema, o comando "node" nao
REM  existia: o servico morria na hora e o log so mostrava um codigo de saida.
REM  O robo precisa subir em QUALQUER PC do turno.
REM  Ordem: versao fixada > qualquer node-portable presente > Node do sistema.
REM ---------------------------------------------------------------------
set "NODE="
if exist "%LOCALAPPDATA%\node-portable\node-v24.18.0-win-x64\node.exe" set "NODE=%LOCALAPPDATA%\node-portable\node-v24.18.0-win-x64"
if not defined NODE for /d %%D in ("%LOCALAPPDATA%\node-portable\node-v*-win-x64") do if exist "%%~fD\node.exe" set "NODE=%%~fD"
if defined NODE set "PATH=%NODE%;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo ===== SEM NODE nesta maquina em %DATE% %TIME% - rode o INSTALAR.cmd ===== >> "%ESTADO%\servico.log"
  exit /b 9
)

echo. >> "%ESTADO%\servico.log"
echo ===== arranque %DATE% %TIME% ===== >> "%ESTADO%\servico.log"

node "sync.mjs" >> "%ESTADO%\servico.log" 2>&1

REM se chegou aqui, o processo caiu - a Tarefa Agendada reinicia sozinha
echo ===== saiu com codigo %ERRORLEVEL% em %DATE% %TIME% ===== >> "%ESTADO%\servico.log"
exit /b %ERRORLEVEL%
