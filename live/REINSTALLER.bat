@echo off
title OLYCITY LIVE - Reinstallation
echo.
echo   Arret du script...
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
taskkill /f /im wscript.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo   Nettoyage...
set SCRIPT_DIR=%~dp0
rd /s /q "%SCRIPT_DIR%node_modules" 2>nul
del /f "%SCRIPT_DIR%olycity.log" 2>nul

echo   Reinstallation des modules...
cd /d "%SCRIPT_DIR%"
call npm install --silent 2>nul

echo   Reconfiguration tache planifiee...
schtasks /create /tn "OlycityLive" /tr "wscript.exe \"%SCRIPT_DIR%silent.vbs\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1

echo   Relancement...
start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
timeout /t 2 /nobreak >nul
echo   OLYCITY LIVE reinstalle et relance.
echo.
pause
