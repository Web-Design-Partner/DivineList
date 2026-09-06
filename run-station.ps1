[CmdletBinding()]
param([ValidateRange(1, 65535)][int]$Port = 8790)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$stationOllama = Join-Path $env:LOCALAPPDATA 'DivineList\ollama-0.33.3\ollama.exe'
$stationModels = Join-Path $env:LOCALAPPDATA 'DivineList\models'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js krävs för att starta DivineList.' }
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 }
catch {
    if (Test-Path -LiteralPath $stationOllama) {
        $env:OLLAMA_HOST = '127.0.0.1:11434'
        $env:OLLAMA_NO_CLOUD = '1'
        $env:OLLAMA_NUM_PARALLEL = '1'
        $env:OLLAMA_MAX_LOADED_MODELS = '1'
        $env:OLLAMA_CONTEXT_LENGTH = '4096'
        $env:OLLAMA_MODELS = $stationModels
        Start-Process -FilePath $stationOllama -ArgumentList 'serve' -WindowStyle Hidden
    }
}
Write-Host "DivineList Skeppet: http://127.0.0.1:$Port/" -ForegroundColor Cyan
Write-Host 'Öppna adressen i webbläsaren. Stationen kör medan detta fönster är öppet. Ctrl+C stoppar kön.'
& node .\scripts\start-station.mjs --port $Port
if ($LASTEXITCODE -ne 0) { throw 'Stationen kunde inte startas. Se felmeddelandet ovan.' }
