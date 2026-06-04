@echo off
title OLYCITY LIVE - Installation

echo.
echo   OLYCITY LIVE - Setup
echo   ========================
echo.

:: Check Node.js via where command (more reliable than --version)
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   Node.js n'est pas installe.
    echo   Le navigateur va s'ouvrir pour le telecharger.
    echo   Installe-le puis relance ce fichier.
    echo.
    start https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi
    pause
    exit /b
)

echo   Node.js OK
echo   Installation des modules...
echo.
call npm install --silent 2>nul
echo   Modules OK
echo.

:: Create VBS to run node silently (no window)
set SCRIPT_DIR=%~dp0
echo Set WshShell = CreateObject("WScript.Shell") > "%SCRIPT_DIR%silent.vbs"
echo WshShell.Run "cmd /c cd /d """ ^& "%SCRIPT_DIR%" ^& """ ^&^& node index.js >> """ ^& "%SCRIPT_DIR%" ^& "olycity.log"" 2^>^&1", 0, False >> "%SCRIPT_DIR%silent.vbs"

:: Register scheduled task at Windows startup
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
schtasks /create /tn "OlycityLive" /tr "wscript.exe \"%SCRIPT_DIR%silent.vbs\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1

if %errorlevel% neq 0 (
    echo   Erreur - Relance en tant qu'administrateur.
    pause
    exit /b
)

echo   Tache planifiee creee - demarre au prochain allumage.
echo.

:: Start now
start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
echo   OLYCITY LIVE tourne en arriere-plan.
echo.
echo   Installation terminee. Vous pouvez fermer cette fenetre.
echo.
pause
