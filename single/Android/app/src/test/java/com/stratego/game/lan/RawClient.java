package com.stratego.game.lan;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Random;

/** A minimal, deliberately independent WebSocket/HTTP client for testing the server over a real socket. */
final class RawClient implements Closeable {
    static final class Frame {
        final int opcode; final boolean fin; final byte[] payload;
        Frame(int opcode, boolean fin, byte[] payload) { this.opcode = opcode; this.fin = fin; this.payload = payload; }
        String text() { return new String(payload, StandardCharsets.UTF_8); }
        int closeCode() { return payload.length >= 2 ? ((payload[0] & 0xFF) << 8) | (payload[1] & 0xFF) : -1; }
    }

    final Socket socket;
    final InputStream in;
    final OutputStream out;
    private final Random random = new Random(7);

    RawClient(int port) throws IOException {
        socket = new Socket();
        socket.connect(new InetSocketAddress("127.0.0.1", port), 3000);
        socket.setSoTimeout(5000);
        in = socket.getInputStream();
        out = socket.getOutputStream();
    }

    /** Sends a request and returns everything the server sends back until it closes the connection. */
    static String http(int port, String request) throws IOException {
        try (RawClient c = new RawClient(port)) {
            c.out.write(request.getBytes(StandardCharsets.ISO_8859_1));
            c.out.flush();
            ByteArrayOutputStream all = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            try { while ((n = c.in.read(buf)) > 0) all.write(buf, 0, n); } catch (java.net.SocketTimeoutException ignored) { /* take what came */ }
            return all.toString("ISO-8859-1");
        }
    }

    static String upgradeRequest(int port, String origin, String key) {
        return "GET /ws HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n"
                + (origin == null ? "" : "Origin: " + origin + "\r\n") + "\r\n";
    }

    static String newKey() {
        byte[] b = new byte[16];
        new Random().nextBytes(b);
        return Base64.getEncoder().encodeToString(b);
    }

    /** Opens a WebSocket and returns the client once the 101 response has been read. */
    static RawClient connect(int port) throws IOException {
        RawClient c = new RawClient(port);
        String key = newKey();
        c.out.write(upgradeRequest(port, "http://127.0.0.1:" + port, key).getBytes(StandardCharsets.ISO_8859_1));
        c.out.flush();
        String head = c.readHead();
        if (!head.startsWith("HTTP/1.1 101")) throw new IOException("handshake failed: " + head);
        if (!head.contains("Sec-WebSocket-Accept: " + WebSocketFrames.acceptKey(key))) throw new IOException("wrong accept key: " + head);
        return c;
    }

    String readHead() throws IOException {
        StringBuilder sb = new StringBuilder();
        while (!sb.toString().endsWith("\r\n\r\n")) {
            int b = in.read();
            if (b < 0) break;
            sb.append((char) b);
        }
        return sb.toString();
    }

    void sendFrame(int opcode, boolean fin, byte[] payload) throws IOException {
        ByteArrayOutputStream f = new ByteArrayOutputStream();
        f.write((fin ? 0x80 : 0) | opcode);
        int n = payload.length;
        if (n < 126) f.write(0x80 | n);
        else if (n <= 0xFFFF) { f.write(0x80 | 126); f.write(n >> 8); f.write(n); }
        else { f.write(0x80 | 127); for (int i = 7; i >= 0; i--) f.write((int) (((long) n >> (8 * i)) & 0xFF)); }
        byte[] mask = new byte[4];
        random.nextBytes(mask);
        f.write(mask);
        for (int i = 0; i < n; i++) f.write(payload[i] ^ mask[i & 3]);
        out.write(f.toByteArray());
        out.flush();
    }

    void sendText(String s) throws IOException { sendFrame(1, true, s.getBytes(StandardCharsets.UTF_8)); }

    void sendRaw(byte... bytes) throws IOException { out.write(bytes); out.flush(); }

    /** Reads one server frame (servers never mask); null at end of stream. */
    Frame readFrame() throws IOException {
        int b0 = in.read();
        if (b0 < 0) return null;
        int b1 = in.read();
        long len = b1 & 0x7F;
        if (len == 126) len = (in.read() << 8) | in.read();
        else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | in.read(); }
        byte[] p = new byte[(int) len];
        int at = 0;
        while (at < p.length) { int got = in.read(p, at, p.length - at); if (got < 0) throw new IOException("eof in frame"); at += got; }
        return new Frame(b0 & 0x0F, (b0 & 0x80) != 0, p);
    }

    @Override public void close() throws IOException { socket.close(); }
}
