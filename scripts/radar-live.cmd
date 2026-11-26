@echo off
rem Radar en tiempo real: corre radar-live y lo reinicia al minuto si se cae (sin conexion, PC que desperto, etc.).
rem Registro en %LOCALAPPDATA%\Rastreador\radar-live.log (se reinicia cuando pasa de ~1 MB).
cd /d "%~dp0.."
set "LOGDIR=%LOCALAPPDATA%\Rastreador"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\radar-live.log"
:loop
for %%A in ("%LOG%") do if %%~zA GTR 1000000 del "%LOG%"
echo ==== inicio %date% %time% >> "%LOG%"
"C:\Program Files\nodejs\node.exe" apps\worker\node_modules\tsx\dist\cli.mjs --use-system-ca apps\worker\src\radar-live.ts >> "%LOG%" 2>&1
echo ==== se detuvo %date% %time%, reinicio en 60 s >> "%LOG%"
timeout /t 60 /nobreak > nul
goto loop
