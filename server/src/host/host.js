// The game host that runs inside the Android app's WebView: the very same Lobby and Room as the PC server, with the
// network handled by the app's native web server.
//
// Contract with the native side (see single/Android):
//   JavaScript -> native (an object `native`, injected as `NativeHost`):
//     native.send(id, text)          send a text frame to remote connection `id`
//     native.close(id, code, reason) close remote connection `id`
//   native -> JavaScript (call these on the object returned by createHost):
//     host.onOpen(id)                a remote client connected (WebSocket handshake done)
//     host.onMessage(id, text)       a text frame arrived from `id`
//     host.onClose(id, code)         the remote end went away
import { Lobby } from '../lobby.js';
import { BridgeSocket } from './bridge-socket.js';
import { createLoopback } from './loopback.js';

export function createHost({ native, lobbyOptions = {}, log = () => {} }) {
  const lobby = new Lobby({ ...lobbyOptions, log });
  const remotes = new Map(); // id -> BridgeSocket
  const loopbacks = new Set();

  return {
    lobby,

    onOpen(id) {
      const socket = new BridgeSocket({
        send: (text) => native.send(id, text),
        close: (code, reason) => native.close(id, code, reason),
      });
      remotes.set(id, socket);
      lobby.connect(socket);
    },

    onMessage(id, text) {
      const socket = remotes.get(id);
      if (socket) socket.receive(text);
    },

    onClose(id, code) {
      const socket = remotes.get(id);
      if (!socket) return;
      remotes.delete(id);
      socket.remoteClosed(code);
    },

    /** A WebSocket-shaped connection for the host's own UI. */
    connectLoopback() {
      const { client, server } = createLoopback();
      loopbacks.add(server);
      lobby.connect(server);
      return client;
    },

    /** Number of connected remote devices (the host's own UI is not counted). */
    remoteCount() { return remotes.size; },

    /** Ends hosting: closes every connection and stops the lobby's timers. */
    stop() {
      for (const s of remotes.values()) s.close(1001, 'the host stopped the game');
      for (const s of loopbacks) s.close(1001, 'the host stopped the game');
      remotes.clear();
      loopbacks.clear();
      lobby.close();
    },
  };
}
