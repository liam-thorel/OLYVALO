@echo off
setlocal
title OLYCITY LIVE - Installation
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%runtime\node.exe"

echo.
echo   OLYCITY LIVE - Installation autonome
echo   ========================
echo.

if not exist "%NODE_EXE%" (
    echo   [ERREUR] Runtime portable manquant.
    echo   Retelcharge et decompresse completement le ZIP officiel.
    echo.
    pause
    exit /b
)
if not exist "%SCRIPT_DIR%node_modules\ws\index.js" (
    echo   [ERREUR] Dependances embarquees manquantes.
    echo   Retelcharge et decompresse completement le ZIP officiel.
    echo.
    pause
    exit /b
)
"%NODE_EXE%" --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERREUR] Le runtime portable ne peut pas demarrer sur ce PC.
    pause
    exit /b
)
echo   Runtime portable OK
echo   Dependances embarquees OK
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%manage.ps1" stop >nul 2>&1
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
schtasks /create /tn "OlycityLive" /tr "wscript.exe \"%SCRIPT_DIR%silent.vbs\"" /sc ONLOGON /rl LIMITED /f >nul 2>&1

if %errorlevel% neq 0 (
    echo   [ERREUR] Impossible de creer le demarrage automatique.
    echo   Essaie une fois avec clic droit puis Executer en administrateur.
    pause
    exit /b
)

echo   Tache planifiee creee.
start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
timeout /t 2 /nobreak >nul
echo   OLYCITY LIVE tourne en arriere-plan.
echo.
echo   Installation terminee.
echo.
pause
