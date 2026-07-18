# Deploy do Painel Suprema — roda no PowerShell: .\deploy.ps1
# 1) Incrementa a SW_VERSION no sw.js (é ela que faz as abas abertas receberem o aviso
#    de "nova versão — clique para atualizar"; sem o bump, a operação continua no código velho)
# 2) Se a pasta for um repositório git, commita e faz push (GitHub Pages publica sozinho)

$ErrorActionPreference = 'Stop'
$swPath = Join-Path $PSScriptRoot 'sw.js'
$sw = Get-Content $swPath -Raw -Encoding UTF8

if ($sw -notmatch "const SW_VERSION = '(\d+)\.(\d+)\.(\d+)'") {
  Write-Error "SW_VERSION não encontrada no sw.js — verifique o formato const SW_VERSION = 'X.Y.Z';"
}
$old = "$($Matches[1]).$($Matches[2]).$($Matches[3])"
$new = "$($Matches[1]).$($Matches[2]).$([int]$Matches[3] + 1)"
$sw = $sw -replace "const SW_VERSION = '$old'", "const SW_VERSION = '$new'"
[System.IO.File]::WriteAllText($swPath, $sw, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "SW_VERSION: $old -> $new" -ForegroundColor Green

if (Test-Path (Join-Path $PSScriptRoot '.git')) {
  Push-Location $PSScriptRoot
  try {
    git add -A
    git commit -m "deploy: v$new"
    git push
    Write-Host "Publicado (git push). GitHub Pages atualiza em ~1 min; as abas abertas verão o banner de nova versão." -ForegroundColor Green
  } finally { Pop-Location }
} else {
  Write-Host "Esta pasta não é um repositório git." -ForegroundColor Yellow
  Write-Host "Copie os arquivos para o repositório do GitHub Pages (prod-sup.github.io/painelpoker) e publique."
  Write-Host "A versão nova ($new) já está gravada no sw.js desta pasta."
}
