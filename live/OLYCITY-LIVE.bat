@echo off
title OLYCITY LIVE
set SCRIPT_DIR=%~dp0
set NODE_EXE=%SCRIPT_DIR%runtime\node.exe

if not exist "%NODE_EXE%" (
    echo   Telechargement de Node.js portable...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.19.0/win-x64/node.exe' -OutFile '%SCRIPT_DIR%runtime\node.exe'" 2>nul
    if not exist "%NODE_EXE%" (
        echo   Echec - verifie ta connexion internet.
        pause & exit /b
    )
    echo   OK
)

cd /d "%SCRIPT_DIR%"
if not exist node_modules\ws "%NODE_EXE%" -e "require('child_process').execSync('npm install',{stdio:'inherit'})"

start "" /min "%NODE_EXE%" "%SCRIPT_DIR%index.js"
echo   OLYCITY LIVE demarre en arriere-plan.
timeout /t 2 /nobreak >nul
