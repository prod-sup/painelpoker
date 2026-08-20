@echo off
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
set "NODE=%LOCALAPPDATA%\node-portable\node-v24.18.0-win-x64"
set "PATH=%NODE%;%PATH%"

set WATCH=1
set INTERVALO_MIN=10

cd /d "%APP%"
if not exist "%ESTADO%" mkdir "%ESTADO%"

echo. >> "%ESTADO%\servico.log"
echo ===== arranque %DATE% %TIME% ===== >> "%ESTADO%\servico.log"

node "sync.mjs" >> "%ESTADO%\servico.log" 2>&1

REM se chegou aqui, o processo caiu - a Tarefa Agendada reinicia sozinha
echo ===== saiu com codigo %ERRORLEVEL% em %DATE% %TIME% ===== >> "%ESTADO%\servico.log"
exit /b %ERRORLEVEL%
