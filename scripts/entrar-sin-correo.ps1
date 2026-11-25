# Atajo de desarrollo: guarda la secret key si falta y abre tu sesión sin enviar correo.
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\entrar-sin-correo.ps1

$envPath = Join-Path $PSScriptRoot "..\.env"
$hasKey = Select-String -Path $envPath -Pattern '^SUPABASE_SECRET_KEY=sb_secret_' -Quiet
if (-not $hasKey) {
  & (Join-Path $PSScriptRoot "set-secret-key.ps1")
  if ($LASTEXITCODE -ne 0) { exit 1 }
}
node (Join-Path $PSScriptRoot "dev-login.mjs")
