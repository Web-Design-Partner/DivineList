[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8787,

    [switch]$Status
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js 22.13 eller senare saknas. Installera Node.js och kör skriptet igen.'
}

$nodeVersionText = (& node --version).Trim().TrimStart('v')
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]'22.13.0') {
    throw "Node.js $nodeVersionText är för gammal. DivineList kräver minst 22.13.0."
}

if ($Status) {
    & node .\scripts\local-status.mjs --port $Port
    exit $LASTEXITCODE
}

& node .\scripts\assert-local-port.mjs --silent --port $Port
if ($LASTEXITCODE -ne 0) {
    throw "Port $Port är inte tillgänglig på 127.0.0.1. Inget bygge eller serverstart utfördes."
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
    throw 'Beroenden saknas. Kör npm ci i DivineList-katalogen innan första starten.'
}

& node .\scripts\verify-release-report.mjs --silent
if ($LASTEXITCODE -ne 0) {
    throw 'Den aktuella källkoden och produktionsbyggnaden saknar en verifierad PASS-releaseattest. Kör npm run check och starta sedan igen. Servern startades inte.'
}

Write-Host "Startar DivineList lokalt på http://127.0.0.1:$Port/" -ForegroundColor Green
Write-Host 'Servern kör i förgrunden bara medan detta terminalfönster är öppet.' -ForegroundColor DarkGray
Write-Host 'Tryck Ctrl+C för att stoppa den. Ingen autostart eller bakgrundstjänst skapas.' -ForegroundColor DarkGray
& node .\scripts\start-local.mjs --port $Port
if ($LASTEXITCODE -ne 0) {
    throw "DivineList-servern stoppades med exitkod $LASTEXITCODE."
}
