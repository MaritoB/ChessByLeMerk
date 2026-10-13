@echo off
title Chess by LeMerk
cd /d "%~dp0"

echo Iniciando Chess by LeMerk...
echo Se abrira el navegador en unos segundos.
echo Para cerrar la aplicacion, cierra esta ventana.
echo.

start "Chess by LeMerk - servidor" cmd /k "npm run dev"

echo Esperando a que arranquen servidor y cliente...
timeout /t 7 /nobreak >nul
start "" http://localhost:5173

echo Listo. Si el navegador no se abrio, entra en http://localhost:5173
