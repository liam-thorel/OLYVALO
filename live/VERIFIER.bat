@echo off
setlocal
title OLYCITY LIVE - Statut
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%runtime\node.exe"

echo.
echo   === OLYCITY LIVE - VERIFIER ===
echo.

if not exist "%NODE_EXE%" (
    echo   [ERREUR] Runtime portable introuvable.
    echo   Retelcharge le ZIP officiel.
    echo.
    pause
    exit /b
)
echo   Runtime portable OK
if not exist "%SCRIPT_DIR%node_modules\ws\index.js" (
    echo   [ERREUR] Dependances embarquees introuvables.
    echo   Retelcharge le ZIP officiel.
    pause
    exit /b
)
echo   Dependances embarquees OK
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%manage.ps1" status >nul 2>&1
if %errorlevel% equ 0 (
    echo   Script : EN COURS
) else (
    echo   Script : ARRETE - Relancement...
    start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
    timeout /t 3 /nobreak >nul
    echo   Script : LANCE
)

echo.
echo   === Derniers logs ===
if exist "%~dp0olycity.log" (
    powershell -Command "Get-Content '%~dp0olycity.log' -Encoding UTF8 -Tail 25" 2>nul
) else (
    echo   Pas encore de logs - lance Valorant et entre dans une game.
)
echo.
pause
