// Runs first on the host page (see hosted.js): creates the game host that lives in this WebView and connects it to the
// app's native web server before the client UI starts. `window.NativeHost` is injected by the Android app.
import { createHost } from '../../src/host/host.js';

const native = window.NativeHost;
if (!native) throw new Error('This page only works inside the Stratego Android app.');

const host = createHost({ native });
window.__stratego_host = host; // the client uses this instead of a network WebSocket
// the native web server calls these as devices connect, send frames and leave
window.StrategoBridge = {
  onOpen: (id) => host.onOpen(id),
  onMessage: (id, text) => host.onMessage(id, text),
  onClose: (id, code) => host.onClose(id, code),
};
