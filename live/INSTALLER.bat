@echo off
title OLYCITY LIVE - Installation

echo.
echo   OLYCITY LIVE - Setup
echo   ========================
echo.

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
call npm install --silent 2>nul
echo   Modules OK
echo.

set SCRIPT_DIR=%~dp0

schtasks /delete /tn "OlycityLive" /f >nul 2>&1
schtasks /create /tn "OlycityLive" /tr "wscript.exe \"%SCRIPT_DIR%silent.vbs\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1

if %errorlevel% neq 0 (
    echo   Erreur - Relance en tant qu'administrateur.
    pause
    exit /b
)

echo   Tache planifiee creee.
echo.

start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
timeout /t 2 /nobreak >nul

echo   OLYCITY LIVE tourne en arriere-plan.
echo   Installation terminee.
echo.
pause
