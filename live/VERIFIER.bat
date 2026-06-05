@echo off
title OLYCITY LIVE - Statut
set SCRIPT_DIR=%~dp0

echo.
echo   === OLYCITY LIVE - VERIFIER ===
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERREUR] Node.js introuvable.
    echo   Lance INSTALLER.bat en administrateur.
    echo.
    pause
    exit /b
)
echo   Node.js OK

:: Install modules if missing
cd /d "%SCRIPT_DIR%"
if not exist node_modules\ws (
    echo   Installation des modules...
    call npm install --silent 2>nul
    echo   Modules installes.
)
echo   Modules OK

:: Check if running
echo.
tasklist /fi "IMAGENAME eq node.exe" 2>nul | find /i "node.exe" >nul
if %errorlevel% equ 0 (
    echo   Script : EN COURS
) else (
    echo   Script : ARRETE - Relancement...
    start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
    timeout /t 3 /nobreak >nul
    tasklist /fi "IMAGENAME eq node.exe" 2>nul | find /i "node.exe" >nul
    if %errorlevel% equ 0 (
        echo   Script : LANCE
    ) else (
        echo   Script : ECHEC - verifie les logs ci-dessous
    )
)

:: Show logs
echo.
echo   === Derniers logs ===
if exist "%SCRIPT_DIR%olycity.log" (
    powershell -Command "Get-Content '%SCRIPT_DIR%olycity.log' -Encoding UTF8 -Tail 25" 2>nul
    if %errorlevel% neq 0 (
        type "%SCRIPT_DIR%olycity.log"
    )
) else (
    echo   Pas encore de logs.
    echo   Lance Valorant et entre dans une game.
)

echo.
pause
