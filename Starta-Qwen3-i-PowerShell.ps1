[CmdletBinding()]
param(
    [switch]$VisaInfo
)

$divineListOllamaExe = Join-Path $env:LOCALAPPDATA 'DivineList\ollama-0.33.3\ollama.exe'
$env:OLLAMA_HOST = 'http://127.0.0.1:11434'

if (-not (Test-Path -LiteralPath $divineListOllamaExe -PathType Leaf)) {
    throw "DivineLists lokala Ollama-program saknas: $divineListOllamaExe"
}

try {
    $null = Invoke-RestMethod -Uri "$env:OLLAMA_HOST/api/version" -TimeoutSec 3
}
catch {
    throw 'Ollama-servern svarar inte. Starta DivineList Skeppet och kör sedan skriptet igen.'
}

if ($VisaInfo) {
    & $divineListOllamaExe show 'qwen3:4b'
    exit $LASTEXITCODE
}

Write-Host 'Startar en lokal chatt med DivineLists modell qwen3:4b.' -ForegroundColor Cyan
Write-Host 'Skriv /bye när du vill avsluta chatten.' -ForegroundColor DarkGray
& $divineListOllamaExe run 'qwen3:4b'
exit $LASTEXITCODE
