package com.stratego.game.lan;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * Reads the frames a WebSocket client sends (RFC 6455): masking, fragmentation, control frames, size limit and strict
 * validation. A violation throws {@link FrameException} carrying the close code to answer with. No Android types.
 */
final class FrameReader {
    /** A protocol violation; `code` is the WebSocket close status to send back (1002, 1003, 1007, 1009). */
    static final class FrameException extends IOException {
        final int code;
        FrameException(int code, String message) { super(message); this.code = code; }
    }

    interface Handler {
        void text(String message) throws IOException;
        void ping(byte[] payload) throws IOException;
        void pong(byte[] payload) throws IOException;
        void close(int code, String reason) throws IOException;
    }

    private final InputStream in;
    private final int maxMessage;
    private ByteArrayOutputStream fragments; // a text message that arrives in several frames

    FrameReader(InputStream in, int maxMessage) {
        this.in = in;
        this.maxMessage = maxMessage;
    }

    /** Reads and handles one frame. Returns false at a clean end of stream before a frame begins. */
    boolean next(Handler h) throws IOException {
        int b0 = in.read();
        if (b0 < 0) return false;
        int b1 = readByte();
        boolean fin = (b0 & 0x80) != 0;
        if ((b0 & 0x70) != 0) throw new FrameException(1002, "reserved bits set");
        int op = b0 & 0x0F;
        if ((b1 & 0x80) == 0) throw new FrameException(1002, "client frames must be masked");
        long len = b1 & 0x7F;
        if (len == 126) {
            len = (readByte() << 8) | readByte();
        } else if (len == 127) {
            long v = 0;
            for (int i = 0; i < 8; i++) v = (v << 8) | readByte();
            if (v < 0) throw new FrameException(1002, "bad frame length");
            len = v;
        }
        boolean control = op >= 8;
        boolean known = op <= 2 || (op >= 8 && op <= 10);
        if (!known) throw new FrameException(1002, "unknown opcode");
        if (control && (!fin || len > 125)) throw new FrameException(1002, "bad control frame");
        if (len > maxMessage) throw new FrameException(1009, "message too big");

        byte[] mask = readFully(4);
        byte[] payload = readFully((int) len);
        for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

        switch (op) {
            case WebSocketFrames.PING: h.ping(payload); return true;
            case WebSocketFrames.PONG: h.pong(payload); return true;
            case WebSocketFrames.CLOSE: {
                int code = payload.length >= 2 ? ((payload[0] & 0xFF) << 8) | (payload[1] & 0xFF) : 1005;
                String reason = payload.length > 2 ? new String(payload, 2, payload.length - 2, StandardCharsets.UTF_8) : "";
                h.close(code, reason);
                return true;
            }
            case WebSocketFrames.BINARY:
                throw new FrameException(1003, "binary messages are not supported");
            case WebSocketFrames.TEXT:
                if (fragments != null) throw new FrameException(1002, "a new message began before the last one ended");
                fragments = new ByteArrayOutputStream();
                break;
            default: // continuation
                if (fragments == null) throw new FrameException(1002, "continuation without a message");
        }
        if (fragments.size() + payload.length > maxMessage) throw new FrameException(1009, "message too big");
        fragments.write(payload, 0, payload.length);
        if (fin) {
            byte[] all = fragments.toByteArray();
            fragments = null;
            h.text(decode(all));
        }
        return true;
    }

    private static String decode(byte[] bytes) throws FrameException {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            throw new FrameException(1007, "text is not valid UTF-8");
        }
    }

    private int readByte() throws IOException {
        int b = in.read();
        if (b < 0) throw new EOFException("connection closed in the middle of a frame");
        return b;
    }

    private byte[] readFully(int n) throws IOException {
        byte[] out = new byte[n];
        int at = 0;
        while (at < n) {
            int got = in.read(out, at, n - at);
            if (got < 0) throw new EOFException("connection closed in the middle of a frame");
            at += got;
        }
        return out;
    }
}
