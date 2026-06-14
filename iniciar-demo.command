#!/bin/bash
# edu-mesh - Nodo Central (Mac/Linux). La primera vez: chmod +x iniciar-demo.command
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "  ERROR: Node.js no esta instalado. Instala Node 22 LTS desde https://nodejs.org"
  read -n 1 -s -r -p "  Enter para cerrar..."
  exit 1
fi

[ -d node_modules ] || { echo "  Instalando dependencias (necesita internet una vez)..."; npm install; }
[ -f keys/trust-store.json ] || { echo "  Preparando el catalogo por primera vez..."; npm run setup; }

echo ""
echo "  Iniciando edu-mesh... deja esta ventana ABIERTA durante la clase."
echo ""
node src/node-app.js --home=nodes/semilla --name=Central

echo ""
read -n 1 -s -r -p "  El servidor se detuvo. Enter para cerrar..."
