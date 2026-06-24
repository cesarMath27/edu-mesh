#!/bin/bash
# =============================================================================
#  INSTALADOR de edu-mesh (Mac / Linux)
# -----------------------------------------------------------------------------
#  Deja TODO listo desde cero, SIN permisos de administrador:
#    1) Si no hay Node.js, descarga Node LTS PORTÁTIL a runtime/node
#       (no toca el sistema).
#    2) Instala las dependencias del proyecto (npm install).
#    3) Prepara el catálogo y las llaves (npm run setup).
#
#  La 1ª vez en Mac: clic derecho → Abrir (o  chmod +x instalar-edu-mesh.command).
# =============================================================================
set -e
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
RUNTIME="$ROOT/runtime"
NODE_DIR="$RUNTIME/node"

B=$'\033[1m'; C=$'\033[36m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; Z=$'\033[0m'
say() { printf '%s\n' "$1"; }
die() { say ""; say "${R}  ✗ $1${Z}"; say "${D}  Revisa tu conexión e inténtalo de nuevo. Node LTS manual: https://nodejs.org${Z}"; read -n 1 -s -r -p "  Enter para cerrar..."; exit 1; }

clear 2>/dev/null || true
say ""
say "${B}${C}  ╔══════════════════════════════════════════╗${Z}"
say "${B}${C}  ║   edu-mesh · Instalación desde cero      ║${Z}"
say "${B}${C}  ╚══════════════════════════════════════════╝${Z}"
say "${D}  Carpeta: $ROOT${Z}"
say ""

# ---- 1) Resolver Node: portátil local > sistema -----------------------------
resolve_node() {
  if [ -x "$NODE_DIR/bin/node" ]; then NODE_BIN="$NODE_DIR/bin/node"; return 0; fi
  if command -v node >/dev/null 2>&1; then NODE_BIN="$(command -v node)"; return 0; fi
  return 1
}

if resolve_node; then
  say "${G}  ✓ Node.js ya disponible:${Z} $NODE_BIN"
else
  say "${Y}  Node.js no encontrado. Descargando una copia PORTÁTIL…${Z}"

  case "$(uname -s)" in
    Darwin) OS=darwin ;;
    Linux)  OS=linux ;;
    *) die "Sistema no soportado para instalación automática: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *) die "Arquitectura no soportada: $(uname -m)" ;;
  esac

  command -v curl >/dev/null 2>&1 || die "Necesito 'curl' para descargar Node.js."
  mkdir -p "$RUNTIME"
  BASE="https://nodejs.org/dist/latest-lts"
  SUMS="$RUNTIME/SHASUMS256.txt"

  say "${D}  → Consultando la última versión LTS ($OS-$ARCH)…${Z}"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$SUMS" || die "No pude consultar la lista de versiones de Node.js."

  LINE="$(grep -E "node-v[0-9.]+-${OS}-${ARCH}\.tar\.gz$" "$SUMS" | head -1 || true)"
  [ -n "$LINE" ] || die "No encontré un paquete de Node LTS para $OS-$ARCH."
  HASH="$(printf '%s' "$LINE" | awk '{print $1}')"
  FILE="$(printf '%s' "$LINE" | awk '{print $2}')"
  URL="$BASE/$FILE"
  TARBALL="$RUNTIME/$FILE"

  say "${D}  → Descargando $FILE${Z}"
  curl -# -fL "$URL" -o "$TARBALL" || die "Falló la descarga de Node.js."

  say "${D}  → Verificando integridad (SHA-256)…${Z}"
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$TARBALL" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
  else
    ACTUAL=""
  fi
  if [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$HASH" ]; then
    die "La huella SHA-256 no coincide (descarga corrupta o manipulada)."
  fi
  [ -n "$ACTUAL" ] && say "${G}  ✓ Integridad verificada.${Z}" || say "${Y}  ⚠ Sin herramienta para verificar el hash; continúo.${Z}"

  say "${D}  → Extrayendo…${Z}"
  rm -rf "$RUNTIME/_extract"; mkdir -p "$RUNTIME/_extract"
  tar -xzf "$TARBALL" -C "$RUNTIME/_extract" || die "No pude extraer el paquete de Node.js."
  INNER="$(find "$RUNTIME/_extract" -maxdepth 1 -mindepth 1 -type d | head -1)"
  rm -rf "$NODE_DIR"
  mv "$INNER" "$NODE_DIR"
  rm -rf "$RUNTIME/_extract" "$TARBALL" "$SUMS"
  say "${G}  ✓ Node.js portátil listo en runtime/node${Z}"
  resolve_node || die "No fue posible preparar Node.js."
fi

# Asegura que 'node' y 'npm' del entorno apunten al elegido.
export PATH="$(dirname "$NODE_BIN"):$PATH"
say "${D}  Node.js: $(node --version)   npm: $(npm --version 2>/dev/null)${Z}"
say ""

# ---- 2) Dependencias --------------------------------------------------------
say "${B}  Instalando dependencias (npm install)…${Z}"
npm install --no-audit --no-fund || die "npm install falló."
say "${G}  ✓ Dependencias instaladas.${Z}"
say ""

# ---- 3) Catálogo + llaves (solo la 1ª vez) ----------------------------------
if [ ! -f "$ROOT/keys/trust-store.json" ]; then
  say "${B}  Preparando el catálogo y las llaves (npm run setup)…${Z}"
  npm run setup || die "El setup falló."
  say "${G}  ✓ Catálogo y llaves listos.${Z}"
else
  say "${G}  ✓ El catálogo ya estaba preparado.${Z}"
fi

say ""
say "${G}${B}  ════════════════════════════════════════════${Z}"
say "${G}${B}   ✓ ¡INSTALACIÓN COMPLETA!${Z}"
say "${G}${B}  ════════════════════════════════════════════${Z}"
say "  Para empezar la clase, abre:"
say "${C}     iniciar-maestro.command${Z}"
say "  (se abrirán dos pantallas: el QR para los alumnos y el panel del maestro)"
say ""
read -n 1 -s -r -p "  Enter para cerrar..."
