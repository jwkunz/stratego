# Stratego for Android

A WebView app that bundles the Stratego web game (single player works fully offline), and can also **host** and
**join** games on your local network.

## Build

Open this folder in Android Studio, or from a shell (JDK 17 and Node.js 20+ required):

    ./gradlew :app:assembleDebug          # builds the web pages, then the APK
    ./gradlew :app:testDebugUnitTest      # JVM tests for the embedded web server
    adb install -r app/build/outputs/apk/debug/app-debug.apk

The build runs `npm run build` in `../web` and in `../../server` and bundles four pages as assets:

| Asset | Source | Used for |
|-------|--------|----------|
| `index.html` | `single/web` | the single-player game |
| `lan.html` | `app/src/main/assets` | the "Play on LAN" menu (host / join) |
| `lan-host.html` | `server` (`npm run build:android`) | the host page: game server + client, runs in the WebView |
| `client.html` | `server` (`npm run build`) | the page other devices load from the host phone |

Pass `-PskipWebBuild` to reuse existing builds without running npm.

## How hosting works

The game server (the same lobby, rules and computer players as the PC server) runs as JavaScript inside the app's
WebView. A small Java web server (`com.stratego.game.lan.MiniWebServer`, no libraries) owns the network socket:
it serves the client page, speaks WebSocket, and relays text frames to the WebView through the `NativeHost` bridge.
The host's own screen talks to the game server in memory, so it needs no network.

- **Host:** Play on LAN > Host. The screen shows the address(es), a QR code and the number of connected devices. A
  foreground-service notification (with Stop) keeps Android from killing the app; the screen stays on while hosting.
  Keep the app open: Android may pause a minimized app's JavaScript.
- **Join:** Play on LAN > Join lists games found on the network (DNS-SD via `NsdManager`), or type an address such as
  `192.168.1.20:8080`. Other devices can simply open that address in a browser.
- **Safety:** only the bundled pages get JavaScript bridges. Joining happens in a second WebView with no bridge that may
  only visit the one private-network address you chose. The permissions are INTERNET, network/Wi-Fi state, multicast
  (discovery), foreground service and notifications, all used only for hosting and joining. Plain HTTP is allowed
  because LAN hosts have no certificates.
- **Measured on a Samsung Galaxy S21 (Android 15):** hosting a Hextic game with two computer players, a round (my move, then both
  computers) took about 1.5 s with the app in front, 1.8 s with the app in the background and 2.1 s with the screen off,
  and the game kept going throughout. These were 30-second tests; much longer background periods are untested, so
  keep the app open for long sessions.
- **Debugging:** debug builds enable WebView remote debugging, so `chrome://inspect` (or `adb forward` to the
  `webview_devtools_remote_<pid>` socket) shows the pages inside the app.
- **Limits:** both devices need the same Wi-Fi. Guest networks that isolate devices block joining; networks that block
  multicast block discovery (typing the address still works). The host phone listens on the LAN like the PC server does.
