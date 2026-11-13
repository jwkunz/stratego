# Stratego server

A LAN multiplayer server for Stratego. It hosts the game on this machine: other people on the same
network open a web page in their browser (phone, tablet or laptop) and play each other. Nothing to install on
their devices.

## Run it

Requires Node.js 18+.

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

Two players open that address, pick a name, and one of them starts a game; the other picks it from the list
(or types the 4-letter code). Settings (environment variables): `PORT` (default 8080) and `HOST` (default
`0.0.0.0`, i.e. all network interfaces; use `HOST=127.0.0.1` to keep it to this machine only).

If other devices cannot connect, the host's firewall is the usual cause. On Ubuntu with `ufw`:
`sudo ufw allow 8080/tcp`. Some guest and hotspot networks also isolate devices from each other.

## What it does

- **Lobby:** list of open games plus join-by-code. Game sizes: 10×10 classic, 12×12, 16×16 and 20×20 (the host
  can re-roll the lakes of the larger boards before the game starts).
- **Fair play:** the server is authoritative. It uses the same rules engine as the single-player game
  (`single/web/src/game.js`) to validate every move, and each player is only ever sent the enemy pieces they have
  legitimately seen. Sides are assigned by coin flip; after a game, a rematch swaps them.
- **Setup:** both players arrange their army at the same time and press Ready; the game starts when both have.
- **Resilience:** a dropped player can reopen the page and resume (the tab remembers a session token). They have
  two minutes before the game is forfeited. Resign, leave and rematch are all supported.

## Layout

```
server/
  src/index.js     command-line entry (prints LAN addresses)
  src/server.js    HTTP static file server + WebSocket upgrade (one port)
  src/lobby.js     sessions, rooms, and the message protocol (documented at the top of the file)
  src/room.js      one game: setup validation, turns, hidden-information views
  client/          the browser client (vanilla JS + Vite, built to one HTML file in public/)
  test/            node:test suites (real WebSocket clients against a real server)
```

The client reuses the single-player stylesheet and rules module from `../single/web/src`, so the board looks and
plays the same.

## Tests

```bash
npm test
```

## Security notes

This is built for a trusted local network, not the internet: there are no accounts, and traffic is plain HTTP/WS
(no TLS). Still, it refuses WebSocket connections from pages served by other origins, limits message sizes and
rates, escapes player names, and never sends hidden piece identities to the other player. Do not expose the port
to the public internet as is.
