# Stratego

An implementation of the classic board game **Stratego** that runs in any modern browser as one self-contained
HTML file, is packaged as an offline Android app, and can be hosted from your computer so friends on your network
can play each other. Besides the classic square board it has **Hextic**, a hexagon-grid variant for **2 to 6 players** with
computer players, teams and pieces that move in six directions.

## Features

- **Hextic (new in 2.0), the hexagon-grid mode:** a hexagonal arena with one triangular camp per player, for 2 to 6 players.
  Every piece moves to any of its **six** neighbouring cells, and Scouts slide along any of the six straight lines.
  - **Computer players** can fill any seat, each with its own difficulty (Easy, Medium, Hard).
  - **Teams:** put seats on Team A, B or C. Teammates cannot attack each other and **see each other's armies**.
  - Everyone moves in turn around the table. A player is **out** when their flag is captured or they have no legal
    move, and their pieces leave the board; the last player or team standing wins.
  - Three camp sizes (Small 21, Medium 28, Large 36 pieces per player), symmetric random lakes, camps tinted per player,
    and a zoomable, scrollable board that works on a phone.
  - Everywhere: single player, multiplayer over your network, and the Android app.
- **Host a LAN game from your phone (new in 2.1):** the Android app can run the game server itself. Tap Play on LAN >
  Host, share the address, QR code or let nearby phones find it, and everyone on the same Wi-Fi plays (computer players
  can fill empty seats). The app also has a Join screen with discovery.

- Full Stratego rules: 10×10 board with two lakes, 40 pieces per side, scouts that slide any distance,
  miners that defuse bombs, the spy that beats the marshal when it attacks, and the two-square rule.
- Hand-place your army or randomize it, then battle the computer (classic: Red vs. Blue).
- Three difficulty levels, chosen in setup. All of them play fair, using only information a human could see
  (revealed pieces and the ranks still unaccounted for):
  - **Easy** plays carelessly and makes deliberate mistakes.
  - **Medium** looks one move ahead using the odds of what each hidden piece is.
  - **Hard** searches several moves ahead (alpha-beta with a capture extension), averaging over many random guesses
    of what the hidden pieces are, within a time budget of about half a second per move.
- **Expanded boards:** 12×12, 16×16 and 20×20, with the army scaled up to fill a deeper starting zone and
  a button to randomize the lakes (symmetric, and never blocking the board).
- In-app **Help** tab describing every piece.
- Your **name** on the setup and game screens (remembered between sessions), and a **material scoreboard** that
  highlights who is ahead: points of material each side has left, a balance bar and a "leads by N" tag.
- **Losses report** that totals the points each side has lost (a piece is worth its rank, Spy 1 to Marshal 10; bombs
  and the flag are not scored), and an eye marker on any piece, yours or the enemy's, whose identity is known.
- Combat animations, all of which respect the system "reduce motion" setting:
  - a winning attacker **slashes** the weaker piece in two, and a failed attacker **shatters**;
  - a **Spy takes the Marshal** under a red crosshair, and a defeated Spy is a silhouette that **cracks apart**;
  - a Miner's defused **bomb dissolves** into dust, and a tripped bomb explodes with a screen flash;
  - enemy pieces **shake** when the fog of war lifts from them;
  - confetti when you capture the flag.

## Repository layout

```
single/web/       Single-player game: vanilla JS + Vite. `npm run build` emits one minified dist/index.html
single/Android/   Android Studio project: a WebView wrapper that bundles the built web app
server/           LAN multiplayer server (Node + WebSockets) and its browser client
```

## Web app (single player)

Requires Node.js 18+.

```bash
cd single/web
npm install
npm run dev      # local dev server with hot reload
npm test         # rules engine / AI tests (node:test)
npm run build    # compiles everything into a single minified dist/index.html
```

`dist/index.html` has no external dependencies: open it directly in a browser or host it anywhere.

Source overview:

| File | Purpose |
|------|---------|
| `single/web/src/topology.js` | Board shapes: square grid and hexagon star (neighbour tables, camps, symmetric lakes, layout) |
| `single/web/src/game.js` | Rules engine (pure functions) for any topology, 2-6 players and teams: moves, combat, elimination, setup |
| `single/web/src/ai.js` | Computer player (easy / medium / hard), for any board and number of opponents |
| `single/web/src/boardview.js`, `zoom.js`, `effects.js`, `scoreboard.js` | Drawing, zoom, animations and the material scoreboard (shared with the multiplayer client) |
| `single/web/src/main.js` | Single-player UI: setup, seats and teams, help tab |
| `single/web/src/style.css` | Styling and animations |
| `single/web/test/` | Unit tests |

## Android app

Requires JDK 17 and the Android SDK (platform 35, build-tools 34). Open `single/Android/` in Android Studio,
or build from a shell:

```bash
cd single/Android
echo "sdk.dir=$HOME/Android/Sdk" > local.properties   # Android Studio creates this for you
./gradlew :app:assembleDebug                           # builds the web app, then the APK
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The Gradle build runs `npm run build` in `single/web/` and `server/` and bundles the pages as assets; pass
`-PskipWebBuild` to reuse existing builds. Single player works offline; hosting and joining LAN games use the network
(see [single/Android/README.md](single/Android/README.md) for how and what permissions). The debug APK is
signed with the standard debug key; a Play Store release would need your own signing key.

## Multiplayer over your LAN

`server/` hosts games for 2 to 6 people from this machine (classic or Hextic, with computer players filling any
empty seats): other players just open a web page. Quick start:

```bash
server/run.sh          # installs, builds if needed and starts it (PORT=9000 server/run.sh to change the port)
```

or `cd server && npm install && npm start`. The server also announces itself on the network, so the Android app's Join
screen finds it. The Android app can host too, with no PC at all.

See [server/README.md](server/README.md) for details.

## Continuous integration and releases

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request: it runs the web and server tests, builds
the single-file `dist/index.html`, and builds the Android debug APK, uploading both as workflow artifacts.

Pushing a version tag publishes a GitHub release with both files attached; CI refuses a tag that does not match the
`VERSION` file:

```bash
node scripts/version.mjs set 2.2.0     # then commit
git tag v2.2.0 && git push origin main v2.2.0
```

## Versioning

The whole project has one version, in the `VERSION` file at the repository root (`MAJOR.MINOR.PATCH`). The web and
server builds and the Android app (`versionName`, and `versionCode = major*10000 + minor*100 + patch`) read it
directly, and the version shows in the apps (`v2.1.0`). npm needs the number in each `package.json` and lock file too,
so `node scripts/version.mjs set X.Y.Z` updates all of them together and `node scripts/version.mjs check` (run by CI)
fails if anything disagrees.

## How to play

Move one piece one square per turn (up, down, left or right on the classic board, any of six directions on a
hexagon board; scouts may slide any distance in a straight line). Moving onto an enemy piece attacks it: both
pieces are revealed and the higher rank wins (equal ranks are both removed). Bombs and flags never move. Only a
miner can defuse a bomb, and only a spy attacking the marshal wins against it. Capture the enemy flag, or leave
your opponents with no legal moves, to win; with more than two players the last player or team standing wins.
The in-app Help tab has the full rank table and the Hextic rules.

## License

[MIT](LICENSE)
