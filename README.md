# edu-mesh — Plataforma educativa híbrida, offline y P2P en LAN

MVP de una red **mesh de distribución de contenido educativo curado**. Los alumnos
navegan un **catálogo offline** (SQLite) y descargan archivos pesados (PDFs, videos)
**directamente de otros dispositivos en la misma red WiFi local**, sin consumir
internet global. Todo el contenido está **firmado criptográficamente** por una o
varias **autoridades curadoras**, de modo que cada dispositivo verifica que el
material es **íntegro, legal y aprobado** antes de aceptarlo.

```
        ┌──────────── RED WiFi LOCAL (sin internet) ────────────┐
        │                                                        │
   ┌────────────┐   1) UDP: "¿quién tiene el hash H?"     ┌────────────┐  ┌────────────┐
   │  ALUMNO     │ ─────────── broadcast ───────────────▶ │  SEMILLA 1  │  │  SEMILLA 2  │
   │  (Luis)     │                                         │  (Ana)      │  │  (Beto)     │
   │             │ ◀────── 2) UDP: "yo, en TCP:p" ──────── │  tiene H    │  │  tiene H    │
   │ catálogo    │                                         └────────────┘  └────────────┘
   │ (sin H)     │ ─ 3) TCP: bloques EN PARALELO ────────────▲──────────────────▲
   │             │ ◀──   (chunk 0,2,4 de Ana; 1,3,5 de Beto) ┘                  ┘
   └────────────┘ 4) Verifica CADA bloque + hash global + firma de autoridad
        │            ✔ acepta y cachea     ✘ falla → descarta / reintenta
        └────────────────────────────────────────────────────────────┘
```

## Capacidades

**Cadena de confianza (Feature 1)**
- **Manifiesto del catálogo firmado**: el curador firma el catálogo COMPLETO; cada
  dispositivo lo verifica antes de importarlo (detecta también altas/bajas de lecciones).
- **Múltiples autoridades** en un *trust store* (`keys/trust-store.json`).
- **Rotación / revocación**: una llave revocada invalida sus firmas al instante.

**Transferencia robusta (Feature 2)**
- Archivos divididos en **bloques (chunks)** con **verificación por bloque** anclada
  a una raíz firmada (`chunks_root`).
- **Descarga en paralelo desde varias semillas** (pool de workers, reparto y reintentos).
- **Reanudación**: si se corta, retoma solo los bloques que faltan.

## Empezar (clonar y correr)

```powershell
git clone https://github.com/cesarMath27/edu-mesh.git
cd edu-mesh
npm install      # instala dependencias (better-sqlite3 trae binarios precompilados)
npm run setup    # genera la autoridad, el catálogo firmado y los dispositivos demo
```

Luego abre 2–3 terminales (ver **Demo** más abajo). Para la app web por dispositivo:
`node src/node-app.js --home=nodes/alumno --name=TuNombre` y abre `http://localhost:8080`.

> Cada quien que clone genera su **propia** autoridad y catálogo con `npm run setup`
> (las llaves NO se versionan). Para una malla compartida entre varios, distribuye
> el mismo `keys/trust-store.json` (pública) + `manifest.json` que firme un curador.

## Cómo funciona (capas)

| Capa | Tecnología | Archivos clave |
|------|-----------|----------------|
| Catálogo local | SQLite (`better-sqlite3`) | [schema.sql](src/db/schema.sql), [catalog.js](src/db/catalog.js) |
| Confianza | Ed25519 + trust store + manifiesto | [keystore.js](src/crypto/keystore.js), [manifest.js](src/catalog/manifest.js) |
| Bloques | SHA-256 por bloque + raíz | [chunking.js](src/crypto/chunking.js) |
| Descubrimiento | UDP broadcast (`dgram`) | [discovery.js](src/p2p/discovery.js) |
| Transferencia | TCP stream por bloque (`net`) | [server.js](src/p2p/server.js), [client.js](src/p2p/client.js) |
| Orquestación | descarga paralela + reanudación | [download-manager.js](src/p2p/download-manager.js) |

## Estructura del proyecto

```
edu-mesh/
├── package.json
├── README.md
├── manifest.json               # catálogo firmado (se genera)
├── keys/
│   ├── trust-store.json        # públicas de autoridades (se distribuye)
│   └── private/<keyId>.private.pem   # privadas (NO se versionan)
├── nodes/                      # cada subcarpeta = un "dispositivo" (se autogenera)
│   ├── semilla/  → catalog.db + cache/<hash> (+ <hash>.chunks.json)
│   ├── semilla2/ → catalog.db + cache/<hash>
│   └── alumno/   → catalog.db + cache/ (+ cache/.partial/<hash>/ al reanudar)
├── scripts/
│   ├── generate-keys.js        # gestiona autoridades (alta/lista/revoca)
│   ├── setup-demo.js           # prepara el demo completo
│   ├── build-manifest.js       # firma el catálogo de un home → manifest.json
│   ├── import-manifest.js      # verifica e importa un manifiesto en un home
│   └── add-content.js          # firma y registra un archivo real (curador)
└── src/
    ├── config.js
    ├── node-app.js             # ▶ App por dispositivo: SEMILLA + UI web (recomendado)
    ├── node-seed.js            # ▶ Nodo Semilla (CLI, solo comparte)
    ├── node-student.js         # ▶ Nodo Alumno (CLI, descarga robusta + valida)
    ├── web/  server.js · public/{index.html, styles.css, app.js}   # capa de UI
    ├── util/  log.js · stable-json.js
    ├── crypto/  hashing.js · signature.js · keystore.js · chunking.js · validation.js
    ├── catalog/ manifest.js
    ├── db/      schema.sql · catalog.js
    └── p2p/     discovery.js · server.js · client.js · download-manager.js
```

## Requisitos
- **Node.js ≥ 18**.
- Misma red WiFi (o una sola PC para el demo).

## Instalación
```powershell
npm install
```

> ⚠️ **Importante (Windows / PowerShell):** ejecuta los comandos con parámetros
> usando **`node <script> --flag`**, NO `npm run <script> -- --flag`.
> En este entorno npm **no** reenvía los argumentos que van después de `--`.
> Los scripts sin parámetros (`npm run setup`, `npm run keys`) sí funcionan.

## Demo: alumnos del mismo salón compartiendo un PDF

### Paso 1 — Preparar (una vez)
```powershell
npm run setup
```
Crea la autoridad curadora, genera un PDF de ~1.5 MB (6 bloques), firma el
**manifiesto**, y arma 3 dispositivos importándolo+verificándolo: `nodes/semilla`
y `nodes/semilla2` (con el PDF) y `nodes/alumno` (sin él).

### Paso 2 — Terminal 1 y 2: las semillas
```powershell
node src/node-seed.js --home=nodes/semilla  --name=Ana
node src/node-seed.js --home=nodes/semilla2 --name=Beto
```

### Paso 3 — Terminal 3: el alumno descarga
```powershell
node src/node-student.js --home=nodes/alumno --name=Luis
```
Verás el descubrimiento, la descarga de **bloques en paralelo repartidos entre Ana
y Beto**, la verificación por bloque + hash global + firma, y el guardado en caché.
A partir de ahí Luis también puede sembrar.

## Interfaz web (recomendado): la app por dispositivo

`node-app.js` corre en UN solo proceso la **semilla P2P + una app web local** para
navegar el catálogo, descargar con progreso en vivo (SSE) y abrir los PDFs. Cada
dispositivo ejecuta esto:

```powershell
# Ana (tiene el PDF) — su app + semilla en el puerto 8081:
node src/node-app.js --home=nodes/semilla --name=Ana  --web-port=8081
# Luis (lo descargará) — su app + semilla en el puerto 8080:
node src/node-app.js --home=nodes/alumno  --name=Luis --web-port=8080
```

Abre `http://localhost:8080` (Luis): explora la materia, pulsa **“Descargar de la
red”** y mira la barra de progreso (verificación de firma → bloques en paralelo →
ensamblado). Al terminar, el botón cambia a **“Abrir PDF”**. Soporta modo claro/oscuro.

| Endpoint | Qué hace |
|----------|----------|
| `GET /api/catalog` | Árbol del catálogo + estado por archivo (`cached`, firma) |
| `GET /api/download?hash=` | (SSE) descarga robusta con eventos de progreso |
| `GET /api/file?hash=` | Sirve el PDF cacheado (inline) |

### Probar la REANUDACIÓN
Corta el alumno con `Ctrl+C` a mitad de una descarga grande y vuelve a lanzarlo:
retomará desde los bloques ya válidos en `cache/.partial/<hash>/`
(`↻ Reanudando: N/M bloques…`).

### Probar la REVOCACIÓN de llaves (cadena de confianza)
```powershell
# Revoca la autoridad y verás que el manifiesto deja de poder importarse:
$kid = (Get-Content keys/trust-store.json -Raw | ConvertFrom-Json).authorities.PSObject.Properties.Name[0]
node scripts/generate-keys.js --revoke=$kid
node scripts/import-manifest.js --home=nodes/test    # → 🛑 RECHAZADO (firma de autoridad revocada)
npm run setup                                         # restaura todo
```

### Probar el RECHAZO de contenido manipulado
```powershell
# Corrompe un bloque del archivo de una semilla y borra la copia del alumno:
$hash = (Get-ChildItem nodes/semilla/cache -File | Where-Object Name -notlike '*.chunks.json').Name
"bytes alterados" | Set-Content "nodes/semilla/cache/$hash"
Remove-Item "nodes/semilla/cache/$hash.chunks.json","nodes/alumno/cache/$hash" -Force -EA SilentlyContinue
node src/node-student.js --home=nodes/alumno --name=Luis
# → el bloque alterado falla su hash; si no hay otra semilla sana, la descarga se rechaza.
npm run setup   # restaura
```

## Gestión de autoridades (curador)
```powershell
node scripts/generate-keys.js                       # crea la primera autoridad
node scripts/generate-keys.js --add --label="UNAM"  # agrega otra autoridad
node scripts/generate-keys.js --list                # lista y estado
node scripts/generate-keys.js --revoke=<keyId>      # revoca (rotación)
```

## Añadir tu propio contenido (curador)
```powershell
node scripts/add-content.js --home=nodes/semilla --file="C:/ruta/leccion.pdf" `
  --escuela="Primaria Juárez" --materia="Matemáticas" --leccion="Fracciones" --mime=application/pdf
node scripts/build-manifest.js --home=nodes/semilla     # regenera manifest.json firmado
node scripts/import-manifest.js --home=nodes/alumno     # los alumnos lo re-sincronizan
```

## Parámetros (CLI `--flag=` o variable `EDU_*`)

| Flag | Env | Defecto | Descripción |
|------|-----|---------|-------------|
| `--home=` | `EDU_HOME` | `nodes/default` | Carpeta del dispositivo (DB + caché) |
| `--name=` | `EDU_NAME` | nombre del home | Nombre visible del nodo |
| `--discovery-port=` | `EDU_DISCOVERY_PORT` | `41234` | Puerto UDP de descubrimiento |
| `--broadcast=` | `EDU_BROADCAST` | `255.255.255.255` | Dirección de difusión LAN |
| `--tcp-port=` | `EDU_TCP_PORT` | `0` (auto) | Puerto TCP de transferencia |
| `--chunk-size=` | `EDU_CHUNK_SIZE` | `262144` | Tamaño de bloque (bytes) |
| `--concurrency=` | `EDU_CONCURRENCY` | `4` | Bloques en paralelo |
| `--web-port=` | `EDU_WEB_PORT` | `8080` | Puerto de la UI web (node-app) |
| `--hash=` | — | (auto) | (alumno) hash específico a descargar |

## Solución de problemas
- **`npm run x -- --flag` no aplica el flag:** usa `node <script> --flag` (ver aviso arriba).
- **El alumno no encuentra semillas en una PC sin red:** el LOOKUP también va a
  `127.0.0.1`, así el demo funciona sin adaptador activo. Revisa el firewall.
- **Firewall de Windows:** permite Node.js en redes privadas la primera vez.

## De MVP a producción
- **Merkle proofs** por bloque (en vez de lista lineal) para verificar sin bajar toda la lista.
- **Descubrimiento estándar**: mDNS/DNS-SD o **libp2p** (identidad de nodo, NAT traversal, DHT).
- **Cifrado del canal** (TLS/Noise) aunque la red sea local.
- **Re-firma incremental** del manifiesto y *expiración* de llaves además de revocación.
