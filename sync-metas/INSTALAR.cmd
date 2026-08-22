@echo off
title Instalar o robo das Metas
REM =========================================================================
REM  INSTALADOR DE UM ARQUIVO SO.
REM
REM  Baixado pelo painel, duplo clique, e pronto. Ele mesmo resolve tudo:
REM    - baixa o Node se a maquina nao tiver
REM    - baixa o resto da ferramenta
REM    - pergunta o login do Suprema (uma vez) e CONFERE antes de salvar
REM    - agenda pra subir sozinho no logon e reiniciar se cair
REM    - abre o PokerByte pra pessoa logar com a conta DELA
REM
REM  SEM ACENTO NESTE ARQUIVO, DE PROPOSITO.
REM  O interpretador do Windows le o .cmd em bytes antes de qualquer chcp valer.
REM  Com acento em UTF-8 ele quebra linhas no meio e pedacos de texto viram
REM  comando ("'de' nao e reconhecido como um comando").
REM
REM  ONDE FICA O QUE
REM    codigo : %LOCALAPPDATA%\SupremaSyncMetas\app   (substituivel)
REM    estado : %LOCALAPPDATA%\SupremaSyncMetas       (senha, sessao - secreto)
REM
REM  Rodar em varias maquinas e o esperado: uma trava no Firebase deixa so uma
REM  sincronizando por vez; as outras sao reserva e assumem em ~3 min se a
REM  primeira desligar.
REM =========================================================================
setlocal

set "BASE=https://painelpoker.vercel.app/sync-metas"
if not "%~1"=="" set "BASE=%~1"

set "ESTADO=%LOCALAPPDATA%\SupremaSyncMetas"
set "APP=%ESTADO%\app"
set "NODEDIR=%LOCALAPPDATA%\node-portable"
set "NODEBIN=%NODEDIR%\node-v24.18.0-win-x64"
set "TAREFA=Suprema - Sync Metas PokerByte"
set "AQUI=%~dp0"

echo.
echo  ===========================================================
echo    ROBO DAS METAS - INSTALACAO
echo  ===========================================================
echo.
echo   Isso deixa este computador ajudando a alimentar o painel
echo   com os prints das metas. Leva uns 2 minutos.
echo.

if not exist "%ESTADO%" mkdir "%ESTADO%"
if not exist "%APP%"    mkdir "%APP%"

echo  [1/5] Node...
if exist "%NODEBIN%\node.exe" goto :temnode
echo        baixando (uns 30 MB, pode demorar)...
if not exist "%NODEDIR%" mkdir "%NODEDIR%"
curl -f -L -s -o "%TEMP%\node-sync-metas.zip" "https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip"
if errorlevel 1 goto :semrede
tar -xf "%TEMP%\node-sync-metas.zip" -C "%NODEDIR%"
del "%TEMP%\node-sync-metas.zip" >nul 2>&1
if not exist "%NODEBIN%\node.exe" goto :semrede
:temnode
echo        ok
set "PATH=%NODEBIN%;%PATH%"

echo  [2/5] ferramenta...
if exist "%AQUI%sync.mjs" goto :copialocal
REM -f e obrigatorio: sem ele o curl grava a pagina de erro DENTRO do arquivo e
REM o instalador segue como se tivesse baixado. Falha silenciosa que so aparece
REM horas depois, com o robo quebrando por "sintaxe invalida" num .mjs.
for %%F in (_browser.mjs firebase.mjs lideranca.mjs match.mjs sync.mjs login.mjs servico.cmd RELOGAR-POKERBYTE.cmd) do (
  curl -f -L -s -o "%APP%\%%F" "%BASE%/%%F"
  if errorlevel 1 goto :semrede
)
curl -f -L -s -o "%APP%\painel-calc.js" "%BASE%/../painel-calc.js"
if errorlevel 1 goto :semrede
echo        baixada
goto :temferramenta
:copialocal
for %%F in (_browser.mjs firebase.mjs lideranca.mjs match.mjs sync.mjs login.mjs servico.cmd RELOGAR-POKERBYTE.cmd) do copy /y "%AQUI%%%F" "%APP%\" >nul
if exist "%AQUI%..\painel-calc.js" copy /y "%AQUI%..\painel-calc.js" "%APP%\" >nul
if exist "%AQUI%painel-calc.js"    copy /y "%AQUI%painel-calc.js"    "%APP%\" >nul
echo        copiada da pasta
:temferramenta
if not exist "%APP%\sync.mjs" goto :semrede
if not exist "%APP%\painel-calc.js" goto :semrede

echo  [3/5] login do Suprema...
if exist "%ESTADO%\.env" goto :temenv
echo.
echo        Digite o SEU login do painel Suprema.
echo        E o mesmo email e senha que voce usa pra entrar no
echo        painel do dia. Fica salvo so neste computador.
echo.
REM Confere ANTES de salvar. Sem isso, senha errada viraria um servico que
REM instala "com sucesso" e nunca escreve nada - falha silenciosa.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$k='AIzaSyAFy1GtRaJE3LHC1Rjtmq0uw2JC8bviXes';" ^
  "for($i=1;$i -le 3;$i++){" ^
  "  $e=Read-Host '        email';" ^
  "  $s=Read-Host '        senha' -AsSecureString;" ^
  "  $p=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s));" ^
  "  Write-Host '        conferindo...';" ^
  "  try{" ^
  "    Invoke-RestMethod -Method Post -Uri \"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$k\" -ContentType 'application/json' -Body (@{email=$e;password=$p;returnSecureToken=$true}|ConvertTo-Json) | Out-Null;" ^
  "    Set-Content -Path (Join-Path $env:LOCALAPPDATA 'SupremaSyncMetas\.env') -Value @(\"FB_EMAIL=$e\", \"FB_SENHA=$p\") -Encoding utf8;" ^
  "    Write-Host '        login confirmado' -ForegroundColor Green; exit 0;" ^
  "  }catch{" ^
  "    Write-Host '';" ^
  "    Write-Host '        NAO ENTROU. Senha errada, ou sua conta ainda nao' -ForegroundColor Yellow;" ^
  "    Write-Host '        passou pelo hub. Entre uma vez no hub e tente aqui.' -ForegroundColor Yellow;" ^
  "    Write-Host '';" ^
  "  }" ^
  "}" ^
  "exit 1"
if errorlevel 1 goto :semlogin
:temenv
echo        ok

echo  [4/5] agendando pra subir sozinho...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$n='%TAREFA%';" ^
  "$app=Join-Path $env:LOCALAPPDATA 'SupremaSyncMetas\app';" ^
  "$a=New-ScheduledTaskAction -Execute \"$env:SystemRoot\System32\cmd.exe\" -Argument ('/c \"' + (Join-Path $app 'servico.cmd') + '\"') -WorkingDirectory $app;" ^
  "$g=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME;" ^
  "$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew;" ^
  "$p=New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN,$env:USERNAME) -LogonType Interactive -RunLevel Limited;" ^
  "foreach($tp in '\','\^\'){try{Unregister-ScheduledTask -TaskName $n -TaskPath $tp -Confirm:$false -ErrorAction Stop}catch{}};" ^
  "Register-ScheduledTask -TaskName $n -TaskPath '\' -Action $a -Trigger $g -Settings $s -Principal $p -Description 'Alimenta a secao Metas do painel do dia.' | Out-Null;" ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "$k=$w.CreateShortcut($w.SpecialFolders('Desktop')+'\RELOGAR POKERBYTE.lnk');" ^
  "$k.TargetPath=(Join-Path $app 'RELOGAR-POKERBYTE.cmd');" ^
  "$k.WorkingDirectory=$app;" ^
  "$k.Description='Refaz o login do PokerByte quando o painel avisar';" ^
  "$k.IconLocation='shell32.dll,238';" ^
  "$k.Save()"
if errorlevel 1 goto :semtarefa
echo        ok

echo  [5/5] agora o PokerByte.
echo.
echo  ===========================================================
echo    ULTIMO PASSO
echo.
echo    Vai abrir uma janela do navegador.
echo    Faca login no PokerByte com a SUA conta:
echo    email, senha e o codigo que chega no seu e-mail.
echo  ===========================================================
echo.
pause

cd /d "%APP%"
node "login.mjs"
set "RES=%ERRORLEVEL%"
REM Sobe agora. NAO engolir o erro: se isto falhar em silencio, a pessoa fecha o
REM instalador achando que ficou pronto e o robo so acorda no proximo logon.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try{" ^
  "  Start-ScheduledTask -TaskName '%TAREFA%' -TaskPath '\' -ErrorAction Stop;" ^
  "  Write-Host '        robo no ar';" ^
  "}catch{" ^
  "  Write-Host '        NAO consegui subir o robo agora. Ele sobe sozinho no' -ForegroundColor Yellow;" ^
  "  Write-Host '        proximo logon; se preferir, reinicie o computador.' -ForegroundColor Yellow;" ^
  "}"

echo.
if "%RES%"=="0" goto :pronto
echo  ===========================================================
echo    O login do PokerByte nao foi concluido.
echo    De dois cliques em "RELOGAR POKERBYTE" na area de
echo    trabalho e tente de novo.
echo  ===========================================================
goto :fim

:pronto
echo  ===========================================================
echo    PRONTO. Este computador ja esta ajudando.
echo    Nao precisa deixar nada aberto. Pode fechar tudo.
echo  ===========================================================
goto :fim

:semrede
echo.
echo  ===========================================================
echo    NAO CONSEGUI BAIXAR OS ARQUIVOS.
echo    Verifique a internet e rode de novo.
echo  ===========================================================
goto :fim

:semlogin
echo.
echo  ===========================================================
echo    Nao consegui confirmar o login em 3 tentativas.
echo    A instalacao parou aqui. Rode de novo quando resolver.
echo  ===========================================================
goto :fim

:semtarefa
echo.
echo  ===========================================================
echo    FALHOU ao criar a tarefa agendada.
echo  ===========================================================

:fim
echo.
pause
