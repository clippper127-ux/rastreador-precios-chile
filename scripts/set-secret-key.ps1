# Pide la secret key de Supabase (sb_secret_...) sin mostrarla y la guarda en .env como SUPABASE_SECRET_KEY.
# Uso, desde la raíz del repo:  powershell -ExecutionPolicy Bypass -File scripts\set-secret-key.ps1

$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) { Write-Host "No existe .env en la raíz." -ForegroundColor Red; exit 1 }

$s = Read-Host "Pega la SECRET KEY de Supabase (empieza con sb_secret_)" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
if (-not $plain.StartsWith("sb_secret_")) {
  Write-Host "Eso no parece una secret key (debe empezar con sb_secret_). No se guardó nada." -ForegroundColor Red; exit 1
}

$lines = [System.Collections.Generic.List[string]](Get-Content $envPath -Encoding UTF8)
$found = $false
for ($k = 0; $k -lt $lines.Count; $k++) {
  if ($lines[$k] -match '^SUPABASE_SECRET_KEY=') { $lines[$k] = "SUPABASE_SECRET_KEY=$plain"; $found = $true }
}
if (-not $found) { $lines.Add("SUPABASE_SECRET_KEY=$plain") }
[IO.File]::WriteAllLines((Resolve-Path $envPath), $lines, (New-Object Text.UTF8Encoding $false))
Write-Host "Listo: secret key guardada en .env." -ForegroundColor Green
exit 0
