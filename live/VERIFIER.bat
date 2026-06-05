@echo off
title OLYCITY LIVE - Statut

echo.
echo   === OLYCITY LIVE - VERIFIER ===
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERREUR] Node.js introuvable.
    echo   Lance INSTALLER.bat en administrateur.
    echo.
    pause
    exit /b
)
echo   Node.js OK

cd /d "%~dp0"
if not exist node_modules\ws (
    echo   Installation des modules...
    call npm install --silent 2>nul
    echo   Modules OK
)
echo   Modules OK
echo.

tasklist /fi "IMAGENAME eq node.exe" 2>nul | find /i "node.exe" >nul
if %errorlevel% equ 0 (
    echo   Script : EN COURS
) else (
    echo   Script : ARRETE - Relancement...
    start "" wscript.exe "%~dp0silent.vbs"
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
