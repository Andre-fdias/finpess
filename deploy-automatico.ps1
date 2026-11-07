# ==============================================================================
# Script de Implantação Automática — Finanças Inteligentes
# Planilha Alvo: 1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c
# ==============================================================================

$ErrorActionPreference = "Stop"
$SpreadsheetId = "1MLW8MLoAdPG8lYZhwwV0UHrSV5wIn2mHJjXgcYsyw9c"

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host " INICIANDO IMPLANTAÇÃO AUTOMÁTICA NA SUA PLANILHA GOOGLE" -ForegroundColor Cyan
Write-Host " Planilha ID: $SpreadsheetId" -ForegroundColor Cyan
Write-Host "==============================================================`n" -ForegroundColor Cyan

# 1. Verifica login no Clasp
if (-not (Test-Path "$env:USERPROFILE\.clasprc.json")) {
    Write-Host "[1/4] Fazendo login na sua conta Google via Clasp..." -ForegroundColor Yellow
    npx.cmd @google/clasp login
} else {
    Write-Host "[1/4] Credenciais Clasp detectadas com sucesso." -ForegroundColor Green
}

# 2. Cria ou verifica vínculo do script com a planilha
$ PrecisaCriar = $true
if (Test-Path ".clasp.json") {
    $claspContent = Get-Content ".clasp.json" -Raw
    if ($claspContent -notmatch "SUBSTITUIR_PELO_SCRIPT_ID") {
        $PrecisaCriar = $false
        Write-Host "[2/4] Projeto Apps Script já vinculado em .clasp.json." -ForegroundColor Green
    } else {
        Remove-Item ".clasp.json" -Force
    }
}

if ($PrecisaCriar) {
    Write-Host "[2/4] Criando projeto Google Apps Script vinculado diretamente à sua planilha..." -ForegroundColor Yellow
    npx.cmd @google/clasp create --type sheets --parentId $SpreadsheetId --title "Financas Inteligentes" --rootDir ./src
    if (Test-Path "src\.clasp.json") {
        Move-Item -Path "src\.clasp.json" -Destination ".clasp.json" -Force
        $json = Get-Content ".clasp.json" | ConvertFrom-Json
        $json | Add-Member -NotePropertyName "rootDir" -NotePropertyValue "src" -Force
        $json | ConvertTo-Json | Set-Content ".clasp.json"
    }
}

# 3. Restaura appsscript.json com as permissões completas e envia os arquivos
$appsScriptManifest = @'
{
  "timeZone": "America/Sao_Paulo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
'@
Set-Content -Path "src\appsscript.json" -Value $appsScriptManifest -Encoding UTF8

Write-Host "[3/4] Enviando todos os 53 módulos (.gs e .html) para a sua planilha..." -ForegroundColor Yellow
npx.cmd @google/clasp push -f

# 4. Cria a implantação do Web App
Write-Host "[4/4] Publicando versão Web App..." -ForegroundColor Yellow
npx.cmd @google/clasp deploy --description "Implantação Automática Finanças Inteligentes"

Write-Host "`n==============================================================" -ForegroundColor Green
Write-Host " IMPLANTAÇÃO CONCLUÍDA COM SUCESSO!" -ForegroundColor Green
Write-Host " Abra sua planilha: https://docs.google.com/spreadsheets/d/$SpreadsheetId/edit" -ForegroundColor Green
Write-Host " E clique no menu superior: 💰 Finanças Inteligentes -> 🚀 1. Instalar / Verificar 28 Abas" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green

