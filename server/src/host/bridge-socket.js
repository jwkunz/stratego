// A socket-shaped object (the small part of the `ws` API that Lobby uses) for connections that do not live in this
// JavaScript context: the Android app's native web server owns the real network socket and hands text frames across.
const later = (fn) => setTimeout(fn, 0);

export class BridgeSocket {
  /**
   * @param {object} out
   * @param {(text: string) => void} out.send                  deliver a text frame to the remote end
   * @param {(code: number, reason: string) => void} out.close  close the remote end
   */
  constructor(out) {
    this.readyState = 1; // 1 = OPEN, 3 = CLOSED, like WebSocket
    this.out = out;
    this.listeners = {};
  }

  on(event, fn) { (this.listeners[event] ||= []).push(fn); return this; }
  emit(event, ...args) { for (const fn of this.listeners[event] || []) fn(...args); }

  /** Called by the owner when a text frame arrives from the remote end. */
  receive(text) { if (this.readyState === 1) this.emit('message', text); }

  send(text) { if (this.readyState === 1) this.out.send(text); }

  /** Closes this connection from our side. As with real sockets, the 'close' event follows asynchronously. */
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.out.close(code, reason);
    later(() => this.emit('close', code, reason));
  }

  /** Called by the owner when the remote end went away. */
  remoteClosed(code = 1006) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    later(() => this.emit('close', code, ''));
  }
}
