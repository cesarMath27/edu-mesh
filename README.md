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
- **Crea su propia WiFi (opcional):** con `--hotspot`, la PC del maestro **levanta un punto de acceso** para que los alumnos se unan **sin router** (automático en Windows/Linux; en Mac, asistido). Incluye **QR para unirse a la red** de un toque.
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
- **Importar un plan de estudios (configuración externa):** si una escuela o sistema usa un programa específico, comparte su **modelo de curso** (estructura de materias y lecciones, sin archivos) y cualquier maestro lo importa para **adaptar su curso**; el plan arma el esqueleto y el maestro solo sube su material en cada lección. **No borra** lo que ya tenga (mezcla).

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
- **Modo Maestro** (protegido por PIN): **tablero "¿quién ya lo tiene?"** + **publicar contenido** firmado desde el navegador + **"Sincronizar ahora"** + **cuestionario en vivo**.
- **Cuestionario en vivo (estilo Kahoot):** el maestro crea preguntas en el navegador y lanza una partida; los alumnos responden desde el celular en **tiempo real** (fichas de colores, temporizador, puntos por rapidez y **podio** final). Todo offline, sobre el mismo broker WebSocket.

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
| Plan de estudios (config. externa) | plantilla JSON sin firmas (merge no destructivo) | [plan.js](src/catalog/plan.js), [plan-store.js](src/catalog/plan-store.js) |
| Bloques | SHA-256 por bloque + raíz firmada | [chunking.js](src/crypto/chunking.js) |
| Descubrimiento (nodos) | UDP broadcast (`dgram`) | [discovery.js](src/p2p/discovery.js) |
| Transferencia (nodos) | TCP por bloque (`net`) | [server.js](src/p2p/server.js), [client.js](src/p2p/client.js) |
| Orquestación | descarga paralela + reanudación | [download-manager.js](src/p2p/download-manager.js) |
| Sincronización auto. | manifiesto + descarga incremental | [sync-core.js](src/sync/sync-core.js), [auto-sync.js](src/sync/auto-sync.js) |
| Vista previa por bloques | HTTP Range (streaming) + bloques verificados | [web/public/preview.js](src/web/public/preview.js) |
| Administración de carga | semáforo de concurrencia (`503` al saturar) | [util/limiter.js](src/util/limiter.js) |
| UI + API + SSE | `http`/`https` nativo | [web/server.js](src/web/server.js), [web/public/](src/web/public/) |
| Mesh navegador | WebRTC + WebSocket (broker) | [signaling.js](src/web/signaling.js), [public/mesh.js](src/web/public/mesh.js) |
| Cuestionario en vivo | juego en tiempo real sobre el broker WS | [quiz.js](src/web/quiz.js), [quiz-store.js](src/web/quiz-store.js) (guardar/cargar), [public/quiz-host.js](src/web/public/quiz-host.js), [public/quiz-player.js](src/web/public/quiz-player.js), [public/sfx.js](src/web/public/sfx.js) · [confetti.js](src/web/public/confetti.js) |
| Verificación en navegador | TweetNaCl (Ed25519) + SHA-256 JS | [verify-sig.js](src/web/public/verify-sig.js), [sha256.js](src/web/public/sha256.js) |
| Hub en línea | empaquetar + sincronizar | [build-pack.js](scripts/build-pack.js), [sync.js](scripts/sync.js), [docs/](docs/) |

---

## Estructura del proyecto

```
edu-mesh/
├── Instalar-edu-mesh.bat            # ▶ INSTALADOR visual (Windows): Node portátil + deps + setup
├── instalar-edu-mesh.command        # ▶ INSTALADOR (Mac/Linux): igual, sin admin
├── Iniciar-Maestro.bat / iniciar-maestro.command  # ▶ INICIADOR de dos pantallas (QR + panel)
├── iniciar-demo.bat / .command      # lanzador clásico de un clic (arranca + muestra QR)
├── docs/                            # página de descarga (hub) — hosteable gratis
├── scripts/
│   ├── install/instalar.ps1         # ventana de instalación (Windows Forms, barra de progreso)
│   ├── launch.js                    # iniciador: arranca el nodo y abre las 2 pantallas (npm run maestro)
│   ├── generate-keys.js             # gestiona autoridades (alta/lista/revoca)
│   ├── setup-demo.js                # prepara el demo completo
│   ├── import-folder.js             # carga contenido desde carpetas (npm run content)
│   ├── add-content.js               # firma y registra UN archivo
│   ├── build-manifest.js            # firma el catálogo de un home → manifest.json
│   ├── import-manifest.js           # verifica e importa un manifiesto
│   ├── export-plan.js / import-plan.js  # exporta / importa un PLAN de estudios (plantilla de curso)
│   ├── build-pack.js                # empaqueta contenido para el hub (npm run pack)
│   ├── sync.js                      # sincroniza un paquete del hub (npm run sync)
│   ├── hotspot.js                   # enciende/apaga el punto de acceso WiFi (npm run hotspot)
│   └── win-hotspot.ps1              # crea el hotspot en Windows (Mobile hotspot / netsh)
└── src/
    ├── config.js                    # configuración por --flag / variables EDU_*
    ├── node-app.js                  # ▶ App por dispositivo: semilla + UI web + auto-sync (RECOMENDADO)
    ├── node-seed.js / node-student.js   # ▶ nodos CLI (solo P2P entre nodos)
    ├── util/   log.js · stable-json.js · netinfo.js · limiter.js (administración de carga)
    ├── crypto/ hashing.js · signature.js · keystore.js · chunking.js · validation.js
    ├── catalog/ manifest.js · plan.js (plantilla de curso) · plan-store.js (planes importados)
    ├── sync/   sync-core.js (una pasada) · auto-sync.js (programador periódico)
    ├── net/    hotspot.js (punto de acceso WiFi en la PC, opcional)
    ├── db/     schema.sql · catalog.js
    ├── p2p/    discovery.js · server.js · client.js · download-manager.js
    └── web/    server.js (+ /api/qr.svg, /api/net, /api/teacher/info) · signaling.js · quiz.js ·
                 quiz-store.js · tls.js · public/{index.html, qr.html (pantalla del QR),
                 app.js, mesh.js, download.js, store.js, preview.js, quiz-host.js, quiz-player.js,
                 sfx.js, confetti.js, maestro.js (panel + ajustes), verify-sig.js, sha256.js, styles.css, vendor/}
```

> No se versionan: `node_modules/`, `runtime/` (Node portátil), `.teacher-pin`, `nodes/`
> (datos por dispositivo), `keys/` (llaves), `manifest.json`, `plan.json`, `contenido/` y `dist-pack/`.
> (La plantilla de ejemplo `docs/plan-ejemplo.json` SÍ se versiona.)

---

## Requisitos
- Estar en la misma red WiFi (o una sola PC para el demo).
- Para el **instalador fácil**: nada más (descarga Node.js solo). Para el modo manual: **Node.js ≥ 18**.

## Empezar — opción FÁCIL (recomendada para maestros) 🟢

No necesitas saber de programación ni instalar nada a mano. Descarga el proyecto
(botón verde **Code → Download ZIP** en GitHub, y descomprímelo) y luego:

| Paso | Windows | Mac / Linux |
|------|---------|-------------|
| **1. Instalar** (una vez) | doble clic en **`Instalar-edu-mesh.bat`** | doble clic en **`instalar-edu-mesh.command`** |
| **2. Iniciar** (cada clase) | doble clic en **`Iniciar-Maestro.bat`** | doble clic en **`iniciar-maestro.command`** |

- **El instalador** abre una ventana con barra de progreso y deja TODO listo desde cero:
  si no tienes Node.js, **descarga una copia portátil** (en `runtime/`, **sin permisos de
  administrador** y sin tocar tu sistema), instala las dependencias y prepara el catálogo.
- **El iniciador** arranca el nodo central y abre **DOS pantallas**:
  - 🟦 **Pantalla del QR** (proyéctala): un **código QR grande** para que los alumnos lo
    escaneen con la cámara y entren — más el conteo de conectados en vivo.
  - 🟩 **Panel del maestro**: el **PIN**, los enlaces, el QR y **todos los ajustes**, además
    del tablero "¿quién ya lo tiene?", publicar material y el cuestionario en vivo. En el
    equipo del maestro **entra solo** (no hace falta teclear el PIN).
- **Crea la WiFi del salón** (por defecto): el iniciador intenta levantar un **punto de
  acceso** en la PC para que los alumnos se unan **sin router** (la pantalla del QR muestra el
  QR para unirse). Es "mejor esfuerzo": si no se puede, te da las instrucciones y el QR para
  activarlo a mano, y la app sigue igual. ¿No la quieres? Inicia con **`--no-hotspot`**.
- El **PIN del maestro** se guarda en `.teacher-pin` para que sea **el mismo entre clases**
  (fíjalo tú con `--teacher-pin=1234` si prefieres). Desde otro dispositivo de la LAN sí se
  pide el PIN: nunca se expone fuera de este equipo.

> 🍎 **Mac, la 1ª vez:** si Finder no deja abrir el `.command`, haz **clic derecho → Abrir**
> (o en Terminal: `chmod +x *.command`). 🪟 **Windows:** si SmartScreen avisa, *Más
> información → Ejecutar de todas formas* (el instalador no necesita administrador).

## Empezar — opción manual (desarrolladores)

```powershell
git clone https://github.com/cesarMath27/edu-mesh.git
cd edu-mesh
npm install        # solo JS/WASM: NO compila nada, funciona en cualquier Node
npm run setup      # genera la autoridad, el catálogo firmado y un demo de prueba
npm run maestro    # inicia + abre las dos pantallas (QR + panel del maestro)
```

El demo clásico de un clic (solo QR en una pantalla) sigue disponible en
`iniciar-demo.bat` / `iniciar-demo.command`.

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

### Punto de acceso WiFi en la PC (`--hotspot`)
¿No hay router en el salón? La PC del maestro puede **crear su propia red WiFi** y que los
alumnos se unan a ella. Se activa al arrancar:

```powershell
node src/node-app.js --home=nodes/semilla --name=Central --hotspot
# opcional: fija el nombre y la clave de la red
node src/node-app.js --home=nodes/semilla --hotspot --ap-ssid="Aula 5" --ap-pass=clase1234
```

- Al arrancar imprime la **red (SSID)**, la **clave** y un **QR para unirse a la WiFi** de un
  toque. La **pantalla del QR** (la que se proyecta) muestra ese QR como **Paso 1** y el de
  abrir la app como **Paso 2**.
- Es **"mejor esfuerzo"** y depende del sistema/adaptador:
  - **Windows (sin internet, lo normal en un salón):** crea una **red hospedada** propia con
    `netsh` (SoftAP) que **NO necesita internet**. Para eso pide **permiso de Administrador**
    (aparece el aviso de Windows / UAC; acéptalo, o inicia el lanzador como administrador) y el
    **adaptador WiFi debe soportar "red hospedada"**.
  - **Windows (con internet):** si hay conexión y no quieres dar permisos, usa el *Mobile
    hotspot* nativo (**sin admin**), que **comparte** esa conexión.
  - **Linux:** NetworkManager (`nmcli`) crea la red sin internet — pide `sudo` y un adaptador
    compatible con modo AP.
  - **macOS:** no se puede por software → modo **asistido** (te guía a *Compartir Internet* +
    SSID/clave + QR).
- **¿Tu PC no tiene WiFi (solo cable) o el adaptador no soporta "red hospedada"?** (compruébalo
  con `netsh wlan show drivers` → *Compatibilidad con red hospedada*). Entonces **no** hay forma
  de crear la WiFi por software en esa PC. Pero recuerda: **edu-mesh solo necesita una WiFi LOCAL,
  no internet**. Opciones que funcionan **sin internet**, de la más fácil a la más robusta:
  1. **El hotspot de un teléfono** (Android suele dejarlo aunque no tenga datos; en iPhone a
     veces pide activar los datos). Conecta la PC y los alumnos a ese hotspot.
  2. **Cualquier router o travel-router**, aunque **no tenga internet**: enciéndelo y conecta
     todo a su WiFi. Es lo más estable y aguanta muchos más dispositivos.
  3. **Un adaptador USB WiFi con modo AP** (baratos): así la PC **sí** puede crear la red con
     `--hotspot`.
- Si **no** puede crearlo automáticamente, **no rompe nada**: muestra instrucciones y el QR
  para que lo actives a mano; la app sigue funcionando igual. Al salir (Ctrl+C) intenta apagarlo;
  la **red hospedada** offline podría seguir activa hasta que reinicies o la apagues con permisos
  (`npm run hotspot -- stop` como administrador).
- Para probarlo por separado: `npm run hotspot -- start` / `npm run hotspot -- stop`.

> El iniciador de dos pantallas (`Iniciar-Maestro` / `npm run maestro`) lo enciende
> **por defecto**; desactívalo con `--no-hotspot`. Si arrancas con `--sync-from` (sincronización
> con un hub, que necesita internet por WiFi), no se enciende solo para no cortar esa conexión:
> fuérzalo con `--hotspot` si de todos modos lo quieres.

### Modo Maestro
Botón **Maestro** (protegido por PIN; si no lo fijas, se genera uno aleatorio y se imprime
al arrancar):
- **Tablero de distribución:** alumnos conectados y cuánto lleva cada quien de cada lección.
- **Publicar contenido:** arrastra un archivo, el nodo central lo **firma** y lo distribuye.
- **Cuestionario en vivo:** crea preguntas y lanza una partida (ver abajo).

```powershell
node src/node-app.js --home=nodes/semilla --name=Central --teacher-pin=1234
```

### Cuestionario en vivo (estilo Kahoot)
En **Modo Maestro → "Cuestionario en vivo"**:
1. Escribe un título y tus preguntas (2–4 opciones, marca la correcta, elige los segundos).
   Con **Guardar / Cargar** reutilizas cuestionarios (se guardan en el nodo, en `HOME/quizzes`).
2. **Lanzar partida** → en cada celular aparece solo la pantalla del juego.
3. **Empezar** muestra la 1ª pregunta; los alumnos tocan una ficha de color. Ganan **más
   puntos por responder rápido** (con bono por racha de aciertos).
4. **Mostrar respuesta** revela la correcta + el marcador; **Siguiente** avanza; al final, **podio**.

Incluye **sonido** (efectos sintetizados con Web Audio, sin archivos), **animaciones** y
**confeti** en el podio (hay botón de silencio 🔊/🔇 y respeta "movimiento reducido").
Funciona 100% offline sobre el mismo broker WebSocket del mesh. El maestro controla la
partida por HTTP autenticado; los alumnos juegan por WebSocket. Los **resultados** de cada
partida son efímeros (no se guardan); las **preguntas** sí, con Guardar / Cargar.

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

### Importar un plan de estudios (configuración externa) 📚

¿Tu **escuela o sistema** imparte un programa específico? En vez de armar el curso
desde cero, importa su **modelo** como una *plantilla*: un archivo JSON con la
**estructura** (escuelas → materias → lecciones, con su orden y descripción, y
opcionalmente *recursos sugeridos* y cuestionarios), **sin** los archivos pesados ni
firmas. El maestro lo importa, se crea el **esqueleto** de lecciones, y él solo sube su
material en cada una — adaptando el curso a su salón.

- **No es destructivo:** se **mezcla** con lo que ya tengas (añade lo nuevo y completa la
  descripción/orden de las lecciones que coincidan por nombre). Tu material publicado no se toca.
- **Desde el navegador (recomendado):** Modo Maestro → *Importar configuración (plan de
  estudios)* → elige el `.json` → **Importar plan**. Debajo aparece el esqueleto con un
  indicador de **qué lecciones ya tienen material y cuáles faltan**, y un botón **＋ Material**
  por lección que **prerrellena** el formulario de *Publicar material* para que solo arrastres el archivo.
- **Compartir tu modelo:** el botón *Descargar el plan de este equipo* (o `npm run plan:export`)
  genera el plan a partir de tu catálogo actual, listo para que otro maestro lo importe.

```powershell
# Importar un plan (mezcla, no borra):
node scripts/import-plan.js --home=nodes/semilla --plan=plan.json     # (npm run plan:import)
# Exportar el catálogo de este equipo como plan/plantilla:
node scripts/export-plan.js --home=nodes/semilla --out=plan.json      # (npm run plan:export)
```

Hay una **plantilla de ejemplo** en [`docs/plan-ejemplo.json`](docs/plan-ejemplo.json). Un
plan también acepta un `manifest.json` firmado como entrada (toma su estructura e ignora las
firmas). Las lecciones sin material **solo las ve el maestro** en este panel hasta que publica
un archivo; los alumnos ven una lección cuando ya tiene contenido. Para propagar la estructura a
otros nodos por sincronización, vuelve a firmar el catálogo con `npm run manifest`.

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
| `maestro` | **Inicia + abre las 2 pantallas** (QR para alumnos + panel del maestro) |
| `demo` / `app` | Arranca el nodo central (semilla + UI + broker) |
| `content` | Importa la carpeta `contenido/` |
| `keys` | Gestiona autoridades |
| `manifest` / `import` | Firma / verifica-importa un manifiesto |
| `plan:import` / `plan:export` | Importa (mezcla) / exporta un **plan de estudios** (configuración de curso) |
| `hotspot` | Enciende/apaga el **punto de acceso WiFi** de la PC a mano (`-- start` / `-- stop`) |
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
| `--hotspot` | apagado | Crea un **punto de acceso WiFi** en la PC (mejor esfuerzo; ver arriba) |
| `--ap-ssid=` | `edu-mesh` | Nombre (SSID) de la red del hotspot |
| `--ap-pass=` | aleatoria | Clave WiFi del hotspot (WPA2, ≥8 caracteres) |
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
- **Red:** el límite real es el **WiFi**, no el software. Un hotspot de celular aguanta ~8–10 dispositivos; un **router de verdad**, 30–250. Para más salones → **más puntos de acceso**, un solo nodo central. **Evita WiFi público** (suele bloquear el tráfico entre dispositivos). Si no hay router, prueba `--hotspot` (la PC crea su propia WiFi), pero ojo: un adaptador WiFi de PC suele aguantar **menos** clientes que un router dedicado.
- **Servidor:** **uno por escuela**, no por salón. Como el contenido **persiste** en cada celular, no todos tienen que estar conectados al mismo tiempo.

## Limitaciones honestas / roadmap
- El mesh está probado en lógica y transporte, **no** con 30–55 dispositivos físicos a la vez → haz un **piloto de 1 salón** antes de escalar.
- WebRTC entre navegadores requiere que la red permita tráfico entre dispositivos (mDNS, sin "aislamiento de clientes").
- Para anti-suplantación total, falta **fijar la huella** de la autoridad fuera de banda.
- Próximos pasos posibles: app de escritorio, analítica de uso anónima, cuestionarios offline, Docker, multi-idioma.

## Licencia
MIT — libre y gratis. Ver [LICENSE](LICENSE).
