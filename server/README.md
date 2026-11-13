# Stratego server

A LAN multiplayer server for Stratego. It hosts the game on this machine: other people on the same
network open a web page in their browser (phone, tablet or laptop) and play each other. Nothing to install on
their devices.

## Run it

Requires Node.js 18+.

```bash
server/run.sh      # from anywhere: installs dependencies, rebuilds the client when sources changed, starts the server
```

or by hand:

```bash
cd server
npm install
npm start          # builds the web client, then starts the server on port 8080
```

The server prints the addresses to share:

```
  This machine:   http://localhost:8080
  On your LAN:    http://192.168.1.20:8080   <- share this with the other players
```

People open that address, pick a name, and one of them starts a game; the others pick it from the list (or type
the 4-letter code). Settings (environment variables): `PORT` (default 8080) and `HOST` (default
`0.0.0.0`, i.e. all network interfaces; use `HOST=127.0.0.1` to keep it to this machine only).

If other devices cannot connect, the host's firewall is the usual cause. On Ubuntu with `ufw`:
`sudo ufw allow 8080/tcp`. Some guest and hotspot networks also isolate devices from each other.

## What it does

- **Lobby and seats:** the host picks the board (classic square 10×10 to 20×20, or a Hextic hexagon star for 2 to 6 players),
  how many seats are computer players and at what difficulty. Other people take the open seats from the list or by
  code; the host can change seats, put them on teams, or "fill the rest with computers". The game moves to setup
  when every seat is taken.
- **Computer players** are run by the server on a short timer, using the same AI as the single-player game.
- **Teams (Hextic games):** seats on the same team cannot attack each other and can see each other's armies.
- **Fair play:** the server is authoritative. It uses the same rules engine as the single-player game
  (`single/web/src/game.js`) to validate every move, and each person is only ever sent the pieces they may see
  (their own, their teammates', and any revealed in combat). Classic games flip a coin for colours; after a game, a
  rematch swaps them (Hextic games rotate who moves first).
- **Dropping out:** a person can resign or leave mid-game, or time out after a disconnect (two minutes to reconnect);
  they are knocked out, their pieces leave the board and everyone else plays on. A room closes when no people are left.
- **Names, material and animations:** names in setup and during the game, a scoreboard that highlights who (or which
  team) is ahead on material, and the same combat effects as the single-player game
  (`single/web/src/{scoreboard,effects}.js`, `zoom.js`, `boardview.js`), respecting "reduce motion".
- **Setup:** everyone arranges their army at the same time and presses Ready; the game starts when all are ready.

## Hosting from the Android app

The same game server also runs inside the Android app (`single/Android`), so a phone can host with no PC: `src/lobby.js`
and `src/room.js` run unchanged in a WebView, and `src/host/` adapts them to the app's Java web server (see
`src/host/host.js` for the bridge contract). `npm run build:android` builds that host page (`client/lan-host.html`).

## Layout

```
server/
  run.sh           one-command launcher
  src/index.js     command-line entry (prints LAN addresses)
  src/host/        adapters that let the lobby run inside the Android app (bridge sockets, loopback)
  src/server.js    HTTP static file server + WebSocket upgrade (one port)
  src/lobby.js     sessions, rooms, and the message protocol (documented at the top of the file)
  src/room.js      one game: seats, setup validation, turns, computer players, hidden-information views
  client/          the browser client (vanilla JS + Vite, built to one HTML file in public/)
  test/            node:test suites (real WebSocket clients against a real server)
```

The client reuses the single-player stylesheet, rules module and animation effects from `../single/web/src`, so the
board looks and plays the same.

## Tests

```bash
npm test
```

## Security notes

This is built for a trusted local network, not the internet: there are no accounts, and traffic is plain HTTP/WS
(no TLS). Still, it refuses WebSocket connections from pages served by other origins, limits message sizes and
rates, escapes player names, and never sends hidden piece identities to the other player. Do not expose the port
to the public internet as is.
