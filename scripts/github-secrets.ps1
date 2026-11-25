# Copia a los secrets de GitHub Actions las claves de .env que el worker necesita.
# No muestra ningún valor. Requiere `gh auth login` y que el repo ya exista en GitHub.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\github-secrets.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$wanted = @("DATABASE_URL", "DATABASE_URL_MIGRATIONS", "TELEGRAM_BOT_TOKEN", "RESEND_API_KEY", "HEALTHCHECK_URL")

$values = @{}
foreach ($line in Get-Content (Join-Path $root ".env")) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
    $v = $Matches[2].Trim().Trim('"').Trim("'")
    if ($wanted -contains $Matches[1] -and $v) { $values[$Matches[1]] = $v }
  }
}

$tmp = Join-Path $env:TEMP ("gh-secrets-" + [guid]::NewGuid() + ".env")
try {
  ($values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) | Set-Content -Path $tmp -Encoding ascii
  & $gh secret set -f $tmp
  if ($LASTEXITCODE -ne 0) { throw "gh secret set falló" }
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Write-Host ""
Write-Host "Secrets cargados: $($values.Keys -join ', ')"
$missing = $wanted | Where-Object { -not $values.ContainsKey($_) }
if ($missing) { Write-Host "Vacios en .env (no se cargaron): $($missing -join ', ')" }
