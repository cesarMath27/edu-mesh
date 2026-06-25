#!/bin/bash
# =============================================================================
#  INICIADOR de edu-mesh (Mac / Linux) — QR para alumnos + Panel del maestro
# -----------------------------------------------------------------------------
#  Arranca el nodo central y abre DOS pantallas:
#    · el QR a pantalla completa (para que los alumnos entren)
#    · el panel del maestro (PIN, enlaces y ajustes)
#
#  La 1ª vez en Mac: clic derecho → Abrir (o  chmod +x iniciar-maestro.command).
# =============================================================================
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

# -- Resuelve Node: portátil local (runtime/node) > sistema --
if [ -x "$ROOT/runtime/node/bin/node" ]; then
  NODE_BIN="$ROOT/runtime/node/bin/node"
  export PATH="$ROOT/runtime/node/bin:$PATH"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
else
  echo ""
  echo "  No se encontró Node.js. Ejecuta primero  instalar-edu-mesh.command"
  echo ""
  read -n 1 -s -r -p "  Enter para cerrar..."
  exit 1
fi

if [ ! -d "$ROOT/node_modules" ]; then
  echo ""
  echo "  Faltan las dependencias. Ejecuta primero  instalar-edu-mesh.command"
  echo ""
  read -n 1 -s -r -p "  Enter para cerrar..."
  exit 1
fi

echo ""
echo "  Iniciando edu-mesh… se abrirán DOS pantallas:"
echo "    - QR a pantalla completa (para los alumnos)"
echo "    - Panel del maestro (PIN, enlaces y ajustes)"
echo ""
echo "  También intenta crear la WiFi del salón en esta PC (nombre, clave y QR)."
echo "  Si NO la quieres:  ./iniciar-maestro.command --no-hotspot"
echo ""
echo "  Deja ESTA ventana abierta durante la clase. (Ctrl+C para salir)"
echo ""

"$NODE_BIN" "$ROOT/scripts/launch.js" "$@"

echo ""
read -n 1 -s -r -p "  El servidor se detuvo. Enter para cerrar..."
