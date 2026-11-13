# Stratego

A single-player implementation of the classic board game **Stratego**, played against a computer
opponent. It runs in any modern browser as one self-contained HTML file, and is also packaged as an
offline Android app.

## Features

- Full Stratego rules: 10×10 board with two lakes, 40 pieces per side, scouts that slide any distance,
  miners that defuse bombs, the spy that beats the marshal when it attacks, and the two-square rule.
- Hand-place your army or randomize it, then battle the computer (Red vs. Blue).
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
| `single/web/src/game.js` | Rules engine (pure functions): moves, combat, setup, lakes, win detection |
| `single/web/src/ai.js` | Computer opponent (easy / medium / hard) |
| `single/web/src/main.js` | UI, setup phase, help tab, animations |
| `single/web/src/style.css` | Styling and animations |
| `single/web/test/` | Unit tests |

## Android app (single player)

Requires JDK 17 and the Android SDK (platform 35, build-tools 34). Open `Android/` in Android Studio,
or build from a shell:

```bash
cd single/Android
echo "sdk.dir=$HOME/Android/Sdk" > local.properties   # Android Studio creates this for you
./gradlew :app:assembleDebug                           # builds the web app, then the APK
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The Gradle build runs `npm run build` in `single/web/` and bundles `single/web/dist/index.html` as an asset; pass
`-PskipWebBuild` to reuse an existing build. The app needs no network permission. The debug APK is
signed with the standard debug key; a Play Store release would need your own signing key.

## Multiplayer over your LAN

`server/` hosts head-to-head games from this machine: other players just open a web page. Quick start:

```bash
cd server && npm install && npm start
```

See [server/README.md](server/README.md) for details.

## Continuous integration and releases

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request: it runs the web and server tests, builds
the single-file `dist/index.html`, and builds the Android debug APK, uploading both as workflow artifacts.

Pushing a version tag publishes a GitHub release with both files attached:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## How to play

Move one piece one square per turn (scouts may slide any distance in a straight line). Moving onto an
enemy piece attacks it: both pieces are revealed and the higher rank wins (equal ranks are both removed).
Bombs and flags never move. Only a miner can defuse a bomb, and only a spy attacking the marshal wins
against it. Capture the enemy flag, or leave your opponent with no legal moves, to win. The in-app Help tab
has the full rank table.

## License

[MIT](LICENSE)
