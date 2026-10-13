# Chess by LeMerk

Ajedrez **multijugador peer-to-peer** (WebRTC) con variantes, que funciona en **PC, Android, iPhone, Mac y navegador**. Un jugador hace de anfitrión y los demás solo abren un enlace en el navegador.

## Requisitos

- **Node.js 20+** (probado con 22) y npm.

## Ejecutar

```powershell
npm install
npm run dev          # servidor (3001) + cliente (5173)
```
Abre `http://localhost:5173`.

Modo producción (un solo puerto, sirve la web compilada):
```powershell
npm run build        # compila el cliente
npm start            # sirve todo en el puerto 3001
```

## Jugar sin conectarte (probar solo)

En el lobby, elige un modo y pulsa **Partida local** (juegas los dos bandos por turnos) o **Sandbox** (mueves cualquier pieza libremente). No hace falta servidor.

## Jugar online con un amigo

**En LAN:** el anfitrión arranca (`npm run dev`), y el amigo abre `http://<IP-del-anfitrión>:5173`. Si Windows pide permiso de firewall, permitir en redes privadas.

**Por internet (recomendado, URL fija):** desplegar en un host (por ejemplo **Render**, ver `render.yaml`). El anfitrión crea la sala, pulsa **“Copiar enlace”** y se lo manda al amigo, que solo tiene que abrirlo.

**Por túnel (sin desplegar):**
```powershell
npm run build; npm start
cloudflared tunnel --url http://localhost:3001   # da una URL https pública
```

> Redes móviles muy estrictas (CGNAT/simétricas) pueden necesitar **TURN**. Se configura en `client/.env` (ver `client/.env.example`): `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_CRED`. Tras cambiarlo, `npm run build`.

## Modos de juego

- **Clásico** — ajedrez estándar.
- **Fog of War** — solo ves tus piezas y las casillas que atacan.
- **Ajedrez ciego por voz** — tablero oculto; dicta o escribe la jugada. 3 vidas: un fallo revela el tablero unos segundos.
- **Royale** — el tablero se encoge por anillos cada N jugadas; el anillo que va a desaparecer se colorea verde→amarillo→naranja→rojo y en negro las casillas ya borradas.
- **Ajedrez con Skills** — cada pieza tiene habilidades (ver abajo).
- **Ajedrez de 4** — tablero en cruz, **Free-for-all** y **Equipos 2v2**.

### Habilidades (modo Skills)

- **Peón:** armadura (bloquea un golpe; bloquear gasta el punto), retroceder, empujón de peones doblados, montar en caballo.
- **Alfil:** flecha (rápida 1 turno / guiada 2 turnos a casilla / perforante 3 turnos), montar caballo (arquero) o entrar en torre (reina o guarecerse y disparar).
- **Torre:** guarece una pieza aliada que **pueda alcanzarla**; se mueve llevándola; una reina dentro transforma peones adyacentes; un peón con escudo dentro puede desguarecerse.
- **Rey:** permuta con la reina; **grito de guerra** (renueva el punto de habilidad a los aliados adyacentes).
- **Reina:** convierte una pieza enemiga de su línea; guarecida en torre transforma peones (a reina con rey adyacente, gastando el punto del rey).

## Controles

- **Clic** en una pieza para ver sus jugadas; clic en el destino para mover. Tocar otra vez la misma pieza la deselecciona.
- **Arrastrar** con el ratón o el dedo.
- **Clic derecho + arrastrar** → flecha (estilo lichess); **clic derecho** en una casilla → círculo. Se limpian al hacer clic.
- **Deshacer** disponible en partidas locales de Royale/Skills.

## Tiempos

- Selector en el lobby: **Sin reloj / 1+0 / 3+2 / 5+0 / 10+0**. Si a alguien se le agota el tiempo, pierde.
- **Primera jugada:** cada bando tiene **20s** para su primera jugada; si no, la partida se **cancela**.

## Arquitectura

```
shared/            protocolo compartido (tipos de lobby y mensajes P2P)
server/            servidor de señalización + lobby (Express + socket.io)
client/
  src/chess/       motor de ajedrez clásico (sobre chess.js) + notación por voz
  src/four/        motor y reglas del ajedrez de 4 jugadores
  src/var/         motor 8x8 para variantes (Royale, Skills)
  src/modes/       registro de modos (interfaz GameMode)
  src/net/         señalización, WebRTC (peer), sesiones online (OnlineGame/FourGame/VarGame)
  src/game/        controlador de partida, reloj, hooks
  src/ui/          tableros, pantallas, componentes
  public/          piezas e iconos (sprites)
```

Añadir una variante 8x8: crear un objeto `GameMode` (o un `VarConfig`) y registrarlo; la red, el lobby y la UI son genéricos.

## Estructura de red

- El **servidor** solo hace *matchmaking* y relay del handshake WebRTC.
- El juego va **P2P** por un DataChannel (topología en estrella para 4 jugadores: todos contra el anfitrión, que reenvía).
- Determinista: ambos clientes aplican las mismas acciones, así que el estado no se desincroniza.

## Deploy (Render)

El repo incluye `render.yaml` y `Dockerfile`.
- Render → New + → **Web Service** (o Blueprint) → repo → build `npm install && npm run build -w client`, start `npm start`. Variables de entorno: vacío (salvo TURN si se usa).
- Cada **push** a `main` redespliega automáticamente.
