@echo off
title OLYCITY LIVE - Build EXE

echo.
echo   OLYCITY LIVE - Build .exe
echo   ========================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERREUR] Python non installe.
    echo   Telechargement...
    start https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
    echo   Installe Python en cochant Add to PATH puis relance.
    pause
    exit /b
)

echo   Python OK - version :
python --version
echo.

echo   Installation PyInstaller...
pip install pyinstaller --quiet --disable-pip-version-check 2>&1
echo   PyInstaller OK
echo.

cd /d "%~dp0"
echo   Build en cours (30-60 secondes)...
pyinstaller --onefile --console --name olycity-live olycity_live.py 2>&1

if exist dist\olycity-live.exe (
    copy /y dist\olycity-live.exe "%~dp0olycity-live.exe" >nul
    echo.
    echo   ========================
    echo   Build OK : olycity-live.exe
    echo   Lance olycity-live.exe avant chaque session.
    echo   ========================
) else (
    echo.
    echo   [ERREUR] Build echoue - voir les messages ci-dessus.
)
echo.
pause
