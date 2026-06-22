# edu-mesh — Plataforma educativa híbrida, offline y P2P

**edu-mesh** lleva libros y videos educativos a salones **sin internet**. Una
computadora de la escuela (el *nodo central*) guarda un catálogo **curado y
firmado**; los alumnos abren el navegador de su celular —**sin instalar nada**—,
descargan el material por la WiFi local, y **se lo pasan entre ellos** (P2P). El
contenido viaja firmado criptográficamente, así cada dispositivo verifica que es
**oficial y sin alterar** antes de aceptarlo.

```
   HUB EN LÍNEA  ──(internet, UNA vez)──▶  NODO CENTRAL de la escuela  ──(WiFi local, SIN internet)──▶  alumnos
  (catálogo + contenido                     sincroniza y VERIFICA las                el archivo pesado se
   firmado, opcional)                        firmas, luego reparte                   reparte ENTRE celulares (mesh)
```

- **100% offline:** solo necesita la red WiFi local (ni siquiera un router con internet).
- **Se reparte sola (P2P):** entre más dispositivos tienen un archivo, más rápido llega a los demás.
- **Curado y firmado (Ed25519):** solo entra contenido de una autoridad confiable; lo alterado se rechaza y se borra.
- **Sin instalar nada en el celular:** todo corre en el navegador.
- **Sin dependencias nativas:** `git clone && npm install && correr` funciona en cualquier máquina y cualquier Node ≥ 18 (SQLite va en WebAssembly).

---

## Características

**Catálogo y contenido**
- Catálogo local en SQLite (escuelas → materias → lecciones → archivos).
- **Manifiesto firmado**: el curador firma el catálogo completo; cada dispositivo lo verifica antes de importarlo.
- **Trust store multi-autoridad** con **rotación/revocación** de llaves.
- Cargar contenido por **carpetas** (`npm run content`), por **navegador** (Modo Maestro), o **sincronizando** de un hub en línea.

**Distribución P2P**
- Archivos en **bloques (chunks)** con **verificación por bloque** anclada a una raíz firmada.
- **Entre nodos (Node):** descubrimiento por **UDP broadcast** + transferencia por **TCP**, en paralelo desde varias semillas, con **reanudación**.
- **Entre navegadores (celulares):** **WebRTC** directo (broker de señalización por WebSocket en el nodo central), con respaldo **HTTP** al central.

**Sincronización y eficiencia**
- **Sincronización automática:** con `--sync-from=URL` el nodo se mantiene al día con el hub **solo**: baja contenido nuevo (verificando firmas) cada `--sync-interval` minutos, **sin descargar lo que ya tiene** (detecta cambios por la huella del manifiesto).
- **Vista previa por bloques (antes de descargar):** abre el archivo **sin bajarlo entero**. PDF/video/audio se ven **por streaming de rangos** (el visor pide solo los bloques que muestra); imágenes y texto se traen **bloque por bloque, verificando cada uno**. Mirar es ultra ligero.
- **Administración de carga:** el central solo sirve `--serve-concurrency` bloques a la vez; si se satura responde `503` y los celulares **se apoyan más en sus compañeros** (mesh). Cada descarga se mantiene ligera aun con muchos dispositivos.

**Interfaz y maestro**
- App web local: catálogo navegable, **vista previa por bloques**, descarga con progreso en vivo, abrir PDF, modo claro/oscuro, **lanzador con QR**.
- **Indicador de sincronización** en vivo + el catálogo **se refresca solo** cuando llega contenido nuevo.
- **Modo Maestro** (protegido por PIN): **tablero "¿quién ya lo tiene?"** + **publicar contenido** firmado desde el navegador + **"Sincronizar ahora"**.

**Seguridad**
- **Firma Ed25519** del contenido + **verificación en el navegador** (un bloque malicioso de otro celular no pasa).
- **Login por token** para el maestro (el PIN no viaja en la URL) + bloqueo por intentos.
- **Alumnos anónimos**, sin telemetría, sin CDNs. **HTTPS opcional** (`--tls`).

---

## Cómo funciona (capas y tecnología)

| Capa | Tecnología | Archivos clave |
|------|-----------|----------------|
| Catálogo local | SQLite en **WASM** (`node-sqlite3-wasm`, sin binarios nativos) | [schema.sql](src/db/schema.sql), [catalog.js](src/db/catalog.js) |
| Confianza | Ed25519 + trust store + manifiesto | [keystore.js](src/crypto/keystore.js), [manifest.js](src/catalog/manifest.js) |
| Bloques | SHA-256 por bloque + raíz firmada | [chunking.js](src/crypto/chunking.js) |
| Descubrimiento (nodos) | UDP broadcast (`dgram`) | [discovery.js](src/p2p/discovery.js) |
| Transferencia (nodos) | TCP por bloque (`net`) | [server.js](src/p2p/server.js), [client.js](src/p2p/client.js) |
| Orquestación | descarga paralela + reanudación | [download-manager.js](src/p2p/download-manager.js) |
| Sincronización auto. | manifiesto + descarga incremental | [sync-core.js](src/sync/sync-core.js), [auto-sync.js](src/sync/auto-sync.js) |
| Vista previa por bloques | HTTP Range (streaming) + bloques verificados | [web/public/preview.js](src/web/public/preview.js) |
| Administración de carga | semáforo de concurrencia (`503` al saturar) | [util/limiter.js](src/util/limiter.js) |
| UI + API + SSE | `http`/`https` nativo | [web/server.js](src/web/server.js), [web/public/](src/web/public/) |
| Mesh navegador | WebRTC + WebSocket (broker) | [signaling.js](src/web/signaling.js), [public/mesh.js](src/web/public/mesh.js) |
| Verificación en navegador | TweetNaCl (Ed25519) + SHA-256 JS | [verify-sig.js](src/web/public/verify-sig.js), [sha256.js](src/web/public/sha256.js) |
| Hub en línea | empaquetar + sincronizar | [build-pack.js](scripts/build-pack.js), [sync.js](scripts/sync.js), [docs/](docs/) |

---

## Estructura del proyecto

```
edu-mesh/
├── iniciar-demo.bat / .command   # lanzador de un clic (arranca + muestra QR)
├── docs/                         # página de descarga (hub) — hosteable gratis
├── scripts/
│   ├── generate-keys.js          # gestiona autoridades (alta/lista/revoca)
│   ├── setup-demo.js             # prepara el demo completo
│   ├── import-folder.js          # carga contenido desde carpetas (npm run content)
│   ├── add-content.js            # firma y registra UN archivo
│   ├── build-manifest.js         # firma el catálogo de un home → manifest.json
│   ├── import-manifest.js        # verifica e importa un manifiesto
│   ├── build-pack.js             # empaqueta contenido para el hub (npm run pack)
│   └── sync.js                   # sincroniza un paquete del hub (npm run sync)
└── src/
    ├── config.js                 # configuración por --flag / variables EDU_*
    ├── node-app.js               # ▶ App por dispositivo: semilla + UI web + auto-sync (RECOMENDADO)
    ├── node-seed.js / node-student.js   # ▶ nodos CLI (solo P2P entre nodos)
    ├── util/   log.js · stable-json.js · netinfo.js · limiter.js (administración de carga)
    ├── crypto/ hashing.js · signature.js · keystore.js · chunking.js · validation.js
    ├── catalog/ manifest.js
    ├── sync/   sync-core.js (una pasada) · auto-sync.js (programador periódico)
    ├── db/     schema.sql · catalog.js
    ├── p2p/    discovery.js · server.js · client.js · download-manager.js
    └── web/    server.js · signaling.js · tls.js · public/{index.html, app.js, mesh.js,
                 download.js, store.js, preview.js, maestro.js, verify-sig.js, sha256.js, styles.css, vendor/}
```

> No se versionan: `node_modules/`, `nodes/` (datos por dispositivo), `keys/` (llaves),
> `manifest.json`, `contenido/` y `dist-pack/` (se generan localmente).

---

## Requisitos
- **Node.js ≥ 18** (cualquier versión sirve: SQLite va en WASM, **no compila binarios nativos**).
- Estar en la misma red WiFi (o una sola PC para el demo).

## Empezar (clonar y correr)

```powershell
git clone https://github.com/cesarMath27/edu-mesh.git
cd edu-mesh
npm install      # solo JS/WASM: NO compila nada, funciona en cualquier Node
npm run setup    # genera la autoridad, el catálogo firmado y un demo de prueba
```

**Lanzador de un clic:** doble clic en `iniciar-demo.bat` (Windows) o
`iniciar-demo.command` (Mac/Linux) → instala lo necesario, arranca el nodo central y
**muestra la URL + un código QR** para que los celulares lo escaneen y entren.

> ⚠️ **Windows/PowerShell:** los comandos con parámetros se corren con `node <script> --flag`,
> **no** con `npm run <script> -- --flag` (npm no reenvía los argumentos tras `--`).

---

## La app por dispositivo (recomendado)

`node-app.js` corre en UN proceso la **semilla P2P + la UI web + el broker WebRTC**:

```powershell
node src/node-app.js --home=nodes/semilla --name=Central
# o:  npm run demo
```
Imprime la URL y un QR. Los celulares (misma WiFi) abren `http://<IP>:8080`, navegan el
catálogo, pulsan **Descargar**, y el archivo se baja por bloques (de compañeros o del
central), se verifica y se abre. Cada celular que lo baja **se vuelve fuente** para los demás.

### Modo Maestro
Botón **Maestro** (protegido por PIN; si no lo fijas, se genera uno aleatorio y se imprime
al arrancar):
- **Tablero de distribución:** alumnos conectados y cuánto lleva cada quien de cada lección.
- **Publicar contenido:** arrastra un archivo, el nodo central lo **firma** y lo distribuye.

```powershell
node src/node-app.js --home=nodes/semilla --name=Central --teacher-pin=1234
```

---

## Cargar contenido

**Opción A — por carpetas (recomendada para mucho material).** La estructura ES la clasificación:
```
contenido/<Escuela>/<Materia>/<NN - Lección>/<archivos.pdf|.mp4|.mp3 ...>
```
```powershell
node scripts/import-folder.js --home=nodes/semilla   # (npm run content)
```
El prefijo `NN -` define el orden. Soporta PDF, video, audio, imágenes, epub.

**Opción B — desde el navegador:** Modo Maestro → *Publicar material*.

**Opción C — un archivo suelto:**
```powershell
node scripts/add-content.js --home=nodes/semilla --file="C:/ruta/leccion.pdf" `
  --escuela="Primaria Juárez" --materia="Matemáticas" --leccion="Fracciones"
```

### Hub en línea (modelo híbrido)
Publica el contenido en un sitio estático y que cada escuela lo **sincronice una vez**:
```powershell
node scripts/build-pack.js --home=nodes/semilla     # genera dist-pack/ (sube a tu hosting)
# en cada escuela, con internet una vez:
node scripts/sync.js --from=https://tusitio/pack --home=nodes/semilla
```
`sync` **verifica las firmas**, importa el catálogo y descarga el contenido (comprobando
cada hash); luego el nodo lo reparte offline. La página del hub está en `docs/`.

**Sincronización automática (recomendada si el central tiene internet a ratos).**
En vez de correr `sync` a mano, arranca el nodo apuntando al hub: se mantiene al día solo.
```powershell
node src/node-app.js --home=nodes/semilla --name=Central `
  --sync-from=https://tusitio/pack --sync-interval=15
```
Hace una primera pasada al arrancar y luego cada 15 min (configurable). Solo baja lo
**nuevo** (compara la huella del manifiesto y los hashes ya en caché), reintenta con
*backoff* si la red falla, y cuando llega material nuevo **los alumnos lo ven sin recargar**.
El maestro puede forzar una pasada con **"Sincronizar ahora"**.
> Nota: un nodo que sincroniza trata al hub como **fuente de verdad** (re-importa el
> catálogo del manifiesto); si además publicas localmente con el Modo Maestro, sube primero
> ese material al hub para que no lo reemplace la siguiente sincronización.

---

## Seguridad
La seguridad está en la **criptografía**, no en esconder el código (es abierto):
- **Contenido firmado (Ed25519):** solo entra material de una autoridad confiable; lo alterado se rechaza.
- **Verificación en el navegador (TweetNaCl):** cada celular verifica la firma **por sí mismo** → un bloque malicioso de otro compañero **no pasa**, aunque venga por WebRTC.
- **Maestro con login por token** (PIN→token, no en la URL) + bloqueo tras 5 intentos.
- **Alumnos anónimos**, sin telemetría, sin CDNs, 100% offline. SQL parametrizado.
- **HTTPS opcional** (`--tls`): cifra el transporte (cert autofirmado; el navegador avisa una vez y desbloquea el *contexto seguro*).

### Gestión de autoridades (curador)
```powershell
node scripts/generate-keys.js                       # crea la primera autoridad
node scripts/generate-keys.js --add --label="UNAM"  # agrega otra
node scripts/generate-keys.js --list                # lista y estado
node scripts/generate-keys.js --revoke=<keyId>      # revoca (rotación)
```

---

## Demo / pruebas

```powershell
npm run setup
# Terminal 1 (semilla con el PDF):
node src/node-app.js --home=nodes/semilla --name=Ana  --web-port=8081
# Terminal 2 (alumno):
node src/node-app.js --home=nodes/alumno  --name=Luis --web-port=8080
```
Abre `http://localhost:8080`, descarga, abre el PDF, entra al Modo Maestro con el PIN del banner.

**Probar el rechazo:** corrompe un archivo de la semilla y vuelve a descargar → se rechaza por hash/firma.
**Probar la revocación:** `generate-keys.js --revoke=<keyId>` → el manifiesto deja de importarse.

---

## Comandos (`npm run …`)

| Comando | Qué hace |
|---|---|
| `setup` | Prepara el demo (autoridad + catálogo firmado + dispositivos) |
| `demo` / `app` | Arranca el nodo central (semilla + UI + broker) |
| `content` | Importa la carpeta `contenido/` |
| `keys` | Gestiona autoridades |
| `manifest` / `import` | Firma / verifica-importa un manifiesto |
| `pack` / `sync` | Empaqueta para el hub / sincroniza desde el hub |
| `add` | Firma y agrega un archivo suelto |
| `seed` / `student` | Nodos CLI (solo P2P entre nodos, sin UI) |

## Parámetros (CLI `--flag=` o variable `EDU_*`)

| Flag | Defecto | Descripción |
|------|---------|-------------|
| `--home=` | `nodes/default` | Carpeta del dispositivo (DB + caché) |
| `--name=` | nombre del home | Nombre visible del nodo |
| `--web-port=` | `8080` | Puerto de la UI web |
| `--tls` | apagado | Sirve por **HTTPS** (cert autofirmado en `keys/`) |
| `--teacher-pin=` | aleatorio | PIN del Modo Maestro |
| `--max-upload-mb=` | `600` | Tamaño máx. al publicar desde el navegador |
| `--discovery-port=` | `41234` | Puerto UDP de descubrimiento |
| `--broadcast=` | `255.255.255.255` | Dirección de difusión LAN |
| `--tcp-port=` | `0` (auto) | Puerto TCP de transferencia |
| `--chunk-size=` | `262144` | Tamaño de bloque (bytes) |
| `--concurrency=` | `4` | Bloques en paralelo |
| `--sync-from=` | _(vacío)_ | URL del hub para **sincronización automática** (vacío = desactivada) |
| `--sync-interval=` | `15` | Minutos entre sincronizaciones automáticas |
| `--serve-concurrency=` | `6` | Bloques que el central sirve a la vez (administración de carga) |
| `--serve-queue=` | `32` | Cola máxima antes de responder `503` (los celulares se apoyan en el mesh) |

---

## Despliegue (notas de campo)
- **Hardware:** una Raspberry Pi (o cualquier PC/laptop) sirve como nodo central; corre Node sin compilar (gracias a WASM). El ESP32 **no** sirve (no corre Node). El Jetson Nano **viejo** no sirve para IA.
- **Red:** el límite real es el **WiFi**, no el software. Un hotspot de celular aguanta ~8–10 dispositivos; un **router de verdad**, 30–250. Para más salones → **más puntos de acceso**, un solo nodo central. **Evita WiFi público** (suele bloquear el tráfico entre dispositivos).
- **Servidor:** **uno por escuela**, no por salón. Como el contenido **persiste** en cada celular, no todos tienen que estar conectados al mismo tiempo.

## Limitaciones honestas / roadmap
- El mesh está probado en lógica y transporte, **no** con 30–55 dispositivos físicos a la vez → haz un **piloto de 1 salón** antes de escalar.
- WebRTC entre navegadores requiere que la red permita tráfico entre dispositivos (mDNS, sin "aislamiento de clientes").
- Para anti-suplantación total, falta **fijar la huella** de la autoridad fuera de banda.
- Próximos pasos posibles: app de escritorio, analítica de uso anónima, cuestionarios offline, Docker, multi-idioma.

## Licencia
MIT — libre y gratis. Ver [LICENSE](LICENSE).
