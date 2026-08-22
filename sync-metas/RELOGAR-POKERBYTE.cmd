@echo off
title Relogar no PokerByte
REM =========================================================================
REM  Atalho de duplo clique pra refazer o login do PokerByte quando a sessao
REM  expira (o painel avisa em vermelho na secao Metas).
REM
REM  SEM ACENTO NESTE ARQUIVO, DE PROPOSITO.
REM  O interpretador do Windows le o .cmd em bytes ANTES de o chcp valer. Com
REM  acento em UTF-8, ele quebra as linhas no meio e pedacos de texto viram
REM  comando ("'de' nao e reconhecido..."). Este arquivo fica em ASCII puro.
REM
REM  POR QUE PARA O SERVICO ANTES
REM  O Chromium TRAVA a pasta do perfil enquanto esta aberto. Com o servico
REM  rodando, abrir o login no mesmo perfil falha com "profile is already in
REM  use". Entao: para o servico, deixa a pessoa logar, religa o servico.
REM =========================================================================
setlocal

set "APP=%~dp0"
set "NODE=%LOCALAPPDATA%\node-portable\node-v24.18.0-win-x64"
set "PATH=%NODE%;%PATH%"
set "TAREFA=Suprema - Sync Metas PokerByte"

cd /d "%APP%"

echo.
echo  ===========================================================
echo    RELOGAR NO POKERBYTE
echo  ===========================================================
echo.
echo  Vai abrir uma janela do navegador.
echo  Faca o login normalmente: email, senha e o codigo do e-mail.
echo.
echo  Nao feche esta janela preta.
echo.

echo  [1/3] pausando o servico de sync...
schtasks /End /TN "%TAREFA%" >nul 2>&1
REM da tempo do Chromium soltar a trava da pasta do perfil
timeout /t 5 /nobreak >nul
echo        ok

echo  [2/3] abrindo o navegador. Faca o login...
echo.
node "login.mjs"
set "RESULTADO=%ERRORLEVEL%"

echo.
echo  [3/3] religando o servico de sync...
schtasks /Run /TN "%TAREFA%" >nul 2>&1
echo        ok
echo.

if "%RESULTADO%"=="0" goto :ok
goto :falhou

:ok
echo  ===========================================================
echo    PRONTO. Sessao renovada.
echo    O painel volta a atualizar sozinho em ate 10 minutos.
echo  ===========================================================
goto :fim

:falhou
echo  ===========================================================
echo    NAO DEU CERTO. O login nao foi concluido.
echo    Rode este atalho de novo e complete o login na janela.
echo  ===========================================================

:fim
echo.
pause
