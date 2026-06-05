@echo off
title OLYCITY LIVE - Build EXE

echo.
echo   OLYCITY LIVE - Build .exe
echo   ========================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   Python non installe.
    echo   Telechargement en cours...
    start https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
    echo   Installe Python en cochant Add to PATH puis relance ce fichier.
    pause
    exit /b
)
echo   Python OK

echo   Installation PyInstaller...
pip install pyinstaller --quiet --disable-pip-version-check
echo   PyInstaller OK

cd /d "%~dp0"
echo   Build en cours...
pyinstaller --onefile --noconsole --name olycity-live olycity_live.py

if exist dist\olycity-live.exe (
    copy /y dist\olycity-live.exe "%~dp0olycity-live.exe" >nul
    echo.
    echo   Build termine : olycity-live.exe
    echo   Tu peux distribuer ce fichier sans Node.js ni Python.
) else (
    echo   ERREUR lors du build.
)
echo.
pause
