@echo off
chcp 65001 >nul
title OLYCITY LIVE — Installation

echo.
echo   OLYCITY LIVE — Setup
echo   ========================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   Node.js n'est pas installe.
    echo   Le navigateur va s'ouvrir pour le telecharger.
    echo   Installe-le, puis relance ce fichier.
    echo.
    start https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi
    pause
    exit
)

echo   Node.js OK
echo   Installation des modules...
call npm install --silent 2>nul
echo   Modules OK
echo.

:: Create the VBS launcher (runs node silently, no window)
set SCRIPT_DIR=%~dp0
set VBS_PATH=%SCRIPT_DIR%olycity-live-silent.vbs

echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_PATH%"
echo WshShell.Run "cmd /c cd /d ""%SCRIPT_DIR%"" && node index.js >> ""%SCRIPT_DIR%olycity-live.log"" 2>&1", 0, False >> "%VBS_PATH%"

:: Register scheduled task to run at Windows startup
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
schtasks /create /tn "OlycityLive" /tr "wscript.exe \"%VBS_PATH%\"" /sc ONLOGON /rl HIGHEST /f >nul

if %errorlevel% neq 0 (
    echo   Erreur creation tache planifiee.
    echo   Relance ce fichier en tant qu'administrateur.
    pause
    exit
)

echo   Tache planifiee creee.
echo   OLYCITY LIVE demarrera automatiquement au prochain demarrage Windows.
echo.

:: Start it now too
start "" wscript.exe "%VBS_PATH%"
echo   OLYCITY LIVE demarre en arriere-plan maintenant.
echo.
echo   ========================
echo   Installation terminee !
echo   Plus besoin de rien faire — ca tourne tout seul.
echo   ========================
echo.
pause
