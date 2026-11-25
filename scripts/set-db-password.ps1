# Pide la contraseña de la base de datos de Supabase sin mostrarla y la escribe en .env
# (reemplaza [YOUR-DATABASE-PASSWORD] en DATABASE_URL y DATABASE_URL_MIGRATIONS).
# Uso, desde la raíz del repo:  powershell -ExecutionPolicy Bypass -File scripts\set-db-password.ps1

$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) { Write-Host "No existe .env en la raíz." -ForegroundColor Red; exit 1 }

function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
}

$plain = Read-Secret "Contraseña de la BASE DE DATOS (no la secret key sb_secret_...)"
if (-not $plain) { Write-Host "No escribiste nada." -ForegroundColor Red; exit 1 }
$again = Read-Secret "Escríbela otra vez para confirmar"
if ($plain -cne $again) {
  Write-Host "No coinciden (ojo con mayúsculas y Bloq Mayús). No se guardó nada." -ForegroundColor Red; exit 1
}
Write-Host ("Largo: {0} caracteres. Compáralo con la que escribiste en Supabase." -f $plain.Length)
if ($plain.StartsWith("sb_")) {
  Write-Host "Eso es una API key de Supabase, no la contraseña de la base de datos. No se guardó nada." -ForegroundColor Red
  Write-Host "Ve a Database > Settings > Reset database password, genera una y cópiala con su botón de copiar."
  exit 1
}

$encoded = [Uri]::EscapeDataString($plain)
$content = [IO.File]::ReadAllText($envPath)
if (-not $content.Contains("[YOUR-DATABASE-PASSWORD]")) {
  Write-Host "No encontré [YOUR-DATABASE-PASSWORD] en .env (¿ya estaba puesta?)." -ForegroundColor Yellow; exit 1
}
[IO.File]::WriteAllText($envPath, $content.Replace("[YOUR-DATABASE-PASSWORD]", $encoded), (New-Object Text.UTF8Encoding $false))
Write-Host "Listo: contraseña guardada en .env (2 líneas)." -ForegroundColor Green
