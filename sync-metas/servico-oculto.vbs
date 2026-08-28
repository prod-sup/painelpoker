' =========================================================================
'  SERVICO-OCULTO - sobe o servico.cmd SEM console visivel.
'
'  POR QUE ESTE ARQUIVO EXISTE
'  ---------------------------
'  A Tarefa Agendada roda na sessao INTERATIVA do operador (LogonType
'  Interactive) e dispara de 5 em 5 minutos. Com a acao apontando direto pro
'  cmd.exe, o Windows abre um console DE VERDADE na tela a cada disparo - uma
'  janela preta piscando na cara de quem esta operando o dia inteiro.
'
'  A alternativa seria rodar a tarefa "esteja o usuario logado ou nao" (sessao
'  0), o que tambem esconde a janela - mas MUDA o ambiente em que o Edge do
'  robo roda, e o robo depende desse Edge. Este atalho nao muda ambiente
'  nenhum: e o MESMO processo, na MESMA sessao, so que sem janela.
'
'  O `True` NO FIM DO Run E ESSENCIAL
'  ----------------------------------
'  Ele faz o wscript ESPERAR o servico.cmd terminar. A tarefa esta configurada
'  com MultipleInstances=IgnoreNew, que so segura instancia nova enquanto a
'  anterior estiver viva. Com `False` o wscript sairia no mesmo instante, a
'  tarefa se daria por encerrada, e o disparo seguinte subiria um SEGUNDO robo
'  por cima do primeiro - dois lideres brigando e dois Edge na maquina.
'
'  O `0` e o estilo de janela: oculta.
'
'  ARQUIVO EM ASCII PURO, SEM BOM, DE PROPOSITO
'  --------------------------------------------
'  O motor de VBScript recusa o BOM do UTF-8 com "Caractere invalido" na linha
'  1, coluna 1 - e a tarefa passa a falhar sem nenhum sintoma util. Nao salve
'  este arquivo com acento nem por editor que insira BOM.
' =========================================================================
Option Explicit

Dim fso, sh, pasta, alvo

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

' resolve a pasta do PROPRIO script: a tarefa pode ser disparada de qualquer
' diretorio de trabalho, e um caminho relativo aqui viraria "arquivo nao
' encontrado" silencioso - a tarefa "roda", nada acontece, e nao ha log.
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
alvo  = pasta & "\servico.cmd"

' Se o servico.cmd sumiu, estoura erro visivel no log de eventos em vez de
' encerrar em silencio fingindo que rodou.
If Not fso.FileExists(alvo) Then
  WScript.Echo "servico.cmd nao encontrado em " & pasta
  WScript.Quit 2
End If

WScript.Quit sh.Run("cmd.exe /c """ & alvo & """", 0, True)
