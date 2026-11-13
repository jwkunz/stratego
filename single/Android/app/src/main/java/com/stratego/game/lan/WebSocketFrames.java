package com.stratego.game.lan;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

/** The parts of RFC 6455 that a server writes: the handshake key and unmasked frames. No Android types. */
final class WebSocketFrames {
    static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    static final int CONTINUATION = 0, TEXT = 1, BINARY = 2, CLOSE = 8, PING = 9, PONG = 10;

    private WebSocketFrames() {}

    /** The Sec-WebSocket-Accept value for a client's Sec-WebSocket-Key. */
    static String acceptKey(String key) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            return Base64.getEncoder().encodeToString(sha1.digest((key + GUID).getBytes(StandardCharsets.ISO_8859_1)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e); // every Java platform has SHA-1
        }
    }

    /** A complete, final, unmasked frame (servers never mask). */
    static byte[] encode(int opcode, byte[] payload) {
        int n = payload.length;
        int header = n < 126 ? 2 : n <= 0xFFFF ? 4 : 10;
        byte[] out = new byte[header + n];
        out[0] = (byte) (0x80 | opcode);
        if (n < 126) {
            out[1] = (byte) n;
        } else if (n <= 0xFFFF) {
            out[1] = 126;
            out[2] = (byte) (n >> 8);
            out[3] = (byte) n;
        } else {
            out[1] = 127; // the upper four length bytes stay zero: messages are far below 4 GB
            out[6] = (byte) (n >> 24);
            out[7] = (byte) (n >> 16);
            out[8] = (byte) (n >> 8);
            out[9] = (byte) n;
        }
        System.arraycopy(payload, 0, out, header, n);
        return out;
    }

    static byte[] text(String s) {
        return encode(TEXT, s.getBytes(StandardCharsets.UTF_8));
    }

    /** A close frame with a status code and a short reason (control frames carry at most 125 bytes). */
    static byte[] close(int code, String reason) {
        byte[] r = reason == null ? new byte[0] : reason.getBytes(StandardCharsets.UTF_8);
        int n = Math.min(r.length, 123);
        byte[] payload = new byte[2 + n];
        payload[0] = (byte) (code >> 8);
        payload[1] = (byte) code;
        System.arraycopy(r, 0, payload, 2, n);
        return encode(CLOSE, payload);
    }

    static byte[] ping() { return encode(PING, new byte[0]); }

    static byte[] pong(byte[] echo) { return encode(PONG, echo); }
}
