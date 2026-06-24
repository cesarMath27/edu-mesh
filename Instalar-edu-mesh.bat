@echo off
chcp 65001 >nul
title Instalar edu-mesh
cd /d "%~dp0"

REM -- Instalador VISUAL (ventana con barra de progreso). No necesita admin. --
REM    Descarga Node.js portatil si falta, instala dependencias y prepara todo.

powershell -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0scripts\install\instalar.ps1"
if errorlevel 1 goto basico
goto fin

:basico
echo.
echo   No se pudo abrir el instalador grafico. Modo basico por consola:
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo   ERROR: Node.js no esta instalado.
  echo   Instala Node 22 LTS desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
call npm install
call npm run setup
echo.
echo   Listo. Ahora abre  Iniciar-Maestro.bat
echo.

:fin
