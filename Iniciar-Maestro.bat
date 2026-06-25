@echo off
chcp 65001 >nul
title edu-mesh - Maestro
cd /d "%~dp0"

REM -- Resuelve Node: primero el portatil local (runtime\node), luego el del sistema --
set "NODE_EXE="
if exist "%~dp0runtime\node\node.exe" (
  set "NODE_EXE=%~dp0runtime\node\node.exe"
) else (
  where node >nul 2>nul && set "NODE_EXE=node"
)

if not defined NODE_EXE (
  echo.
  echo   No se encontro Node.js.
  echo   Ejecuta primero  Instalar-edu-mesh.bat
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo.
  echo   Faltan las dependencias.
  echo   Ejecuta primero  Instalar-edu-mesh.bat
  echo.
  pause
  exit /b 1
)

echo.
echo   Iniciando edu-mesh... se abriran DOS ventanas:
echo     - QR a pantalla completa (para los alumnos)
echo     - Panel del maestro (PIN, enlaces y ajustes)
echo.
echo   Tambien crea la WiFi del salon en esta PC (veras nombre, clave y QR).
echo   Si NO la quieres, inicia con:  Iniciar-Maestro.bat --no-hotspot
echo.
echo   Deja ESTA ventana abierta durante la clase. (Ctrl+C para salir)
echo.

"%NODE_EXE%" "%~dp0scripts\launch.js" %*

echo.
echo   El servidor se detuvo.
pause
