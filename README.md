# Stratego

A single-player implementation of the classic board game **Stratego**, played against a computer
opponent. It runs in any modern browser as one self-contained HTML file, and is also packaged as an
offline Android app.

## Features

- Full Stratego rules: 10×10 board with two lakes, 40 pieces per side, scouts that slide any distance,
  miners that defuse bombs, the spy that beats the marshal when it attacks, and the two-square rule.
- Hand-place your army or randomize it, then battle the computer (Red vs. Blue).
- Fair AI: it only uses information a human could see (revealed pieces and remaining unknown ranks).
- **Expanded boards:** 12×12, 16×16 and 20×20, with the army scaled up to fill a deeper starting zone and
  a button to randomize the lakes (symmetric, and never blocking the board).
- In-app **Help** tab describing every piece.
- Bomb explosion effects (flash, shake, burst) and confetti when you capture the flag. These respect
  the system "reduce motion" setting.

## Repository layout

```
web/       The game: vanilla JS + Vite. `npm run build` emits one minified dist/index.html
Android/   Android Studio project: a WebView wrapper that bundles the built web app
```

## Web app

Requires Node.js 18+.

```bash
cd web
npm install
npm run dev      # local dev server with hot reload
npm test         # rules engine / AI tests (node:test)
npm run build    # compiles everything into a single minified dist/index.html
```

`dist/index.html` has no external dependencies: open it directly in a browser or host it anywhere.

Source overview:

| File | Purpose |
|------|---------|
| `web/src/game.js` | Rules engine (pure functions): moves, combat, setup, lakes, win detection |
| `web/src/ai.js` | Computer opponent |
| `web/src/main.js` | UI, setup phase, help tab, animations |
| `web/src/style.css` | Styling and animations |
| `web/test/` | Unit tests |

## Android app

Requires JDK 17 and the Android SDK (platform 35, build-tools 34). Open `Android/` in Android Studio,
or build from a shell:

```bash
cd Android
echo "sdk.dir=$HOME/Android/Sdk" > local.properties   # Android Studio creates this for you
./gradlew :app:assembleDebug                           # builds the web app, then the APK
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The Gradle build runs `npm run build` in `web/` and bundles `web/dist/index.html` as an asset; pass
`-PskipWebBuild` to reuse an existing build. The app needs no network permission. The debug APK is
signed with the standard debug key; a Play Store release would need your own signing key.

## How to play

Move one piece one square per turn (scouts may slide any distance in a straight line). Moving onto an
enemy piece attacks it: both pieces are revealed and the higher rank wins (equal ranks are both removed).
Bombs and flags never move. Only a miner can defuse a bomb, and only a spy attacking the marshal wins
against it. Capture the enemy flag, or leave your opponent with no legal moves, to win. The in-app Help tab
has the full rank table.

## License

[MIT](LICENSE)
