@echo off
title OLYCITY LIVE — Installation
color 0A

echo.
echo  ╔══════════════════════════════════════╗
echo  ║        OLYCITY LIVE - SETUP          ║
echo  ╚══════════════════════════════════════╝
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js n'est pas installe.
    echo.
    echo  Telechargement en cours...
    start https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi
    echo.
    echo  Installe Node.js puis relance ce fichier.
    echo  Appuie sur une touche pour fermer.
    pause >nul
    exit
)

echo  [OK] Node.js detecte : 
node --version

echo.
echo  Installation des modules...
call npm install --silent

if %errorlevel% neq 0 (
    echo  [ERREUR] npm install a echoue.
    pause >nul
    exit
)

echo  [OK] Installation terminee !
echo.
echo ══════════════════════════════════════════
echo  Lance Valorant, entre dans une game,
echo  puis ouvre le site OLYCITY ^> Live
echo ══════════════════════════════════════════
echo.
pause >nul
