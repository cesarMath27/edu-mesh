@echo off
chcp 65001 >nul
title edu-mesh - Nodo Central
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   ERROR: Node.js no esta instalado.
  echo   Instala Node 22 LTS desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   Instalando dependencias por primera vez (necesita internet una vez)...
  call npm install
)

if not exist keys\trust-store.json (
  echo   Preparando el catalogo por primera vez...
  call npm run setup
)

echo.
echo   Iniciando edu-mesh... deja esta ventana ABIERTA durante la clase.
echo.
node src/node-app.js --home=nodes/semilla --name=Central

echo.
echo   El servidor se detuvo.
pause
