# Genera .env.vercel.local (ignorado por git) con solo las variables que la web necesita en Vercel.
# Ábrelo con el Bloc de notas, copia todo y pégalo en Vercel → Environment Variables (acepta pegar un .env entero).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\vercel-env.ps1 [-AppUrl https://tu-app.vercel.app]
param([string]$AppUrl = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$wanted = @("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN", "RESEND_API_KEY", "RESEND_FROM", "LLM_API_KEY", "LLM_MODEL", "WORKER_USER_AGENT")

$lines = @()
foreach ($line in Get-Content (Join-Path $root ".env")) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$' -and $wanted -contains $Matches[1] -and $Matches[2].Trim()) {
    $lines += "$($Matches[1])=$($Matches[2].Trim())"
  }
}
if ($AppUrl) { $lines += "APP_URL=$AppUrl" }

$out = Join-Path $root ".env.vercel.local"
$lines | Set-Content -Path $out -Encoding utf8
Write-Host "Listo: .env.vercel.local con $($lines.Count) variables (sin mostrar valores)."
Write-Host "Borralo cuando termines de pegarlo en Vercel."
