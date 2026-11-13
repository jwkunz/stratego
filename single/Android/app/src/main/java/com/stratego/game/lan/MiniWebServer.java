package com.stratego.game.lan;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A small HTTP + WebSocket server with no libraries and no Android types. It serves the multiplayer client page and
 * accepts WebSocket connections on /ws, but it knows nothing about the game: every text frame is handed to the
 * {@link Listener}, and replies are sent with {@link #send}. In the app the listener forwards frames to the game host
 * running in a WebView.
 *
 * Safety: messages are capped, upgrades must come from a page served by this same address (Origin check), the number of
 * connections is capped, each connection has its own writer queue so a slow device can never block the caller of
 * {@link #send}, and dead connections are found with pings and a read timeout.
 */
public final class MiniWebServer {
    /** Receives connection events. Calls for one connection arrive in order, from that connection's own thread. */
    public interface Listener {
        void onOpen(int id);
        void onMessage(int id, String text);
        void onClose(int id, int code);
    }

    /** Supplies the page served at / (null if it is not available). */
    public interface PageSource {
        byte[] clientPage();
    }

    public static final int MAX_MESSAGE = 64 * 1024;
    static final int MAX_QUEUED_BYTES = 4 * 1024 * 1024;
    static final int MAX_HEADER_BYTES = 8 * 1024;
    private static final byte[] POISON = new byte[0];
    private static final String CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'";

    private final Listener listener;
    private final PageSource pages;
    private final int maxConnections;
    private final int pingSeconds;
    private final int readTimeoutMillis;
    private final Map<Integer, Conn> conns = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);
    private final AtomicInteger httpInFlight = new AtomicInteger();

    private ServerSocket server;
    private volatile boolean running;
    private ScheduledExecutorService scheduler;
    private java.util.concurrent.ExecutorService pool;

    public MiniWebServer(Listener listener, PageSource pages, int maxConnections) {
        this(listener, pages, maxConnections, 20, 70_000);
    }

    /** `pingSeconds` and `readTimeoutMillis` are parameters so tests can shorten them. */
    MiniWebServer(Listener listener, PageSource pages, int maxConnections, int pingSeconds, int readTimeoutMillis) {
        this.listener = listener;
        this.pages = pages;
        this.maxConnections = maxConnections;
        this.pingSeconds = pingSeconds;
        this.readTimeoutMillis = readTimeoutMillis;
    }

    // ---- lifecycle ----------------------------------------------------------------------------------------------
    /** Starts listening on all interfaces, on `port` or (if taken) one of the next nine. Returns the port in use. */
    public synchronized int start(int port) throws IOException {
        if (running) return server.getLocalPort();
        IOException last = null;
        for (int p = port; p < port + 10 && p <= 65535; p++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(p), 50);
                server = s;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (server == null) throw last != null ? last : new IOException("no free port");
        running = true;
        pool = Executors.newCachedThreadPool(daemonThreads("lan-http"));
        scheduler = Executors.newSingleThreadScheduledExecutor(daemonThreads("lan-timer"));
        scheduler.scheduleAtFixedRate(() -> { for (Conn c : conns.values()) c.enqueue(WebSocketFrames.ping()); },
                pingSeconds, pingSeconds, TimeUnit.SECONDS);
        Thread acceptor = new Thread(this::acceptLoop, "lan-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        return server.getLocalPort();
    }

    public synchronized void stop() {
        if (!running) return;
        running = false;
        try { server.close(); } catch (IOException ignored) { /* closing anyway */ }
        server = null;
        for (Conn c : conns.values()) c.close(1001, "the host stopped the game");
        scheduler.shutdown();
        pool.shutdown();
        try { pool.awaitTermination(2, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        for (Conn c : conns.values()) c.forceClose();
        pool.shutdownNow();
    }

    public int connectionCount() { return conns.size(); }

    /** Queues a text frame for connection `id`. Never blocks. Returns false if there is no such open connection. */
    public boolean send(int id, String text) {
        Conn c = conns.get(id);
        return c != null && c.enqueue(WebSocketFrames.text(text));
    }

    /** Closes connection `id` with a WebSocket status code (the frame is flushed first). */
    public void close(int id, int code, String reason) {
        Conn c = conns.get(id);
        if (c != null) c.close(code, reason);
    }

    private static ThreadFactory daemonThreads(String prefix) {
        AtomicInteger n = new AtomicInteger();
        return r -> { Thread t = new Thread(r, prefix + "-" + n.incrementAndGet()); t.setDaemon(true); return t; };
    }

    // ---- accepting ----------------------------------------------------------------------------------------------
    private void acceptLoop() {
        while (running) {
            try {
                Socket s = server.accept();
                if (httpInFlight.incrementAndGet() > maxConnections * 2) { // flood of half-open sockets
                    httpInFlight.decrementAndGet();
                    s.close();
                    continue;
                }
                pool.execute(() -> {
                    try { handle(s); } finally { httpInFlight.decrementAndGet(); }
                });
            } catch (IOException e) {
                if (!running) return;
            } catch (java.util.concurrent.RejectedExecutionException e) {
                return;
            }
        }
    }

    // ---- one HTTP request ---------------------------------------------------------------------------------------
    private void handle(Socket s) {
        try {
            s.setTcpNoDelay(true);
            s.setSoTimeout(10_000); // a client has ten seconds to send its request
            InputStream in = new BufferedInputStream(s.getInputStream(), 4096);
            OutputStream out = s.getOutputStream();
            String requestLine = readLine(in, MAX_HEADER_BYTES);
            if (requestLine == null) { s.close(); return; }
            String[] parts = requestLine.split(" ");
            if (parts.length != 3 || !parts[2].startsWith("HTTP/1.")) { respond(out, 400, "Bad Request", "text/plain", "Bad request\n", false); s.close(); return; }
            Map<String, String> headers = new HashMap<>();
            int total = requestLine.length();
            for (;;) {
                String line = readLine(in, MAX_HEADER_BYTES);
                if (line == null) { s.close(); return; }
                if (line.isEmpty()) break;
                total += line.length();
                int colon = line.indexOf(':');
                if (colon <= 0 || headers.size() >= 64 || total > MAX_HEADER_BYTES) { respond(out, 431, "Request Header Fields Too Large", "text/plain", "Too large\n", false); s.close(); return; }
                headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
            }
            String method = parts[0];
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            boolean head = method.equals("HEAD");
            if (!method.equals("GET") && !head) { respond(out, 405, "Method Not Allowed", "text/plain", "Method not allowed\n", false, "Allow: GET, HEAD"); s.close(); return; }

            if (path.equals("/ws")) {
                upgrade(s, in, out, headers);
                return;
            }
            if (path.equals("/") || path.equals("/index.html")) {
                byte[] page = pages.clientPage();
                if (page == null) respond(out, 503, "Service Unavailable", "text/plain", "The game page is not available.\n", head);
                else respond(out, 200, "OK", "text/html; charset=utf-8", page, head);
            } else if (path.equals("/health")) {
                respond(out, 200, "OK", "application/json", "{\"ok\":true,\"devices\":" + conns.size() + "}", head);
            } else {
                respond(out, 404, "Not Found", "text/plain", "Not found\n", head);
            }
            s.close();
        } catch (IOException e) {
            try { s.close(); } catch (IOException ignored) { /* already gone */ }
        }
    }

    private void upgrade(Socket s, InputStream in, OutputStream out, Map<String, String> h) throws IOException {
        boolean wants = "websocket".equalsIgnoreCase(h.get("upgrade")) && hasToken(h.get("connection"), "upgrade");
        if (!wants) { respond(out, 400, "Bad Request", "text/plain", "Expected a WebSocket upgrade\n", false); s.close(); return; }
        if (!sameOrigin(h.get("origin"), h.get("host"))) { respond(out, 403, "Forbidden", "text/plain", "Forbidden origin\n", false); s.close(); return; }
        if (!"13".equals(h.get("sec-websocket-version"))) { respond(out, 426, "Upgrade Required", "text/plain", "Use WebSocket version 13\n", false, "Sec-WebSocket-Version: 13"); s.close(); return; }
        String key = h.get("sec-websocket-key");
        if (!validKey(key)) { respond(out, 400, "Bad Request", "text/plain", "Bad WebSocket key\n", false); s.close(); return; }
        if (conns.size() >= maxConnections) { respond(out, 503, "Service Unavailable", "text/plain", "Too many devices\n", false); s.close(); return; }

        out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                + WebSocketFrames.acceptKey(key) + "\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
        s.setSoTimeout(readTimeoutMillis);

        Conn conn = new Conn(nextId.getAndIncrement(), s, out);
        conns.put(conn.id, conn);
        Thread writer = new Thread(conn::writeLoop, "lan-write-" + conn.id);
        writer.setDaemon(true);
        writer.start();
        safe(() -> listener.onOpen(conn.id));

        int code = 1006; // "abnormal closure" unless the other side closes properly
        FrameReader reader = new FrameReader(in, MAX_MESSAGE);
        FrameReader.Handler handler = new FrameReader.Handler() {
            @Override public void text(String message) { safe(() -> listener.onMessage(conn.id, message)); }
            @Override public void ping(byte[] payload) { conn.enqueue(WebSocketFrames.pong(payload)); }
            @Override public void pong(byte[] payload) { /* the read itself proves the device is alive */ }
            @Override public void close(int c, String reason) { conn.peerCode = c; conn.close(echoable(c) ? c : 1000, ""); }
        };
        try {
            while (!conn.peerClosed() && reader.next(handler)) { /* keep reading */ }
            if (conn.peerClosed()) code = conn.peerCode;
        } catch (FrameReader.FrameException e) {
            code = e.code;
            conn.close(e.code, e.getMessage());
        } catch (SocketTimeoutException e) {
            conn.close(1001, "no answer");
        } catch (IOException e) {
            // reset or closed under us
        } finally {
            conns.remove(conn.id);
            final int finalCode = code;
            safe(() -> listener.onClose(conn.id, finalCode));
            if (conn.closing.get()) conn.forceCloseSoon(); else conn.forceClose(); // the device left without a goodbye
        }
    }

    // ---- one WebSocket connection -------------------------------------------------------------------------------
    private final class Conn {
        final int id;
        final Socket socket;
        final OutputStream out;
        final LinkedBlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
        final AtomicInteger queuedBytes = new AtomicInteger();
        final AtomicBoolean closing = new AtomicBoolean();
        volatile int peerCode = -1;

        Conn(int id, Socket socket, OutputStream out) { this.id = id; this.socket = socket; this.out = out; }

        boolean peerClosed() { return peerCode >= 0; }

        /** Queues a frame; closes the connection instead if the device is too slow to keep up. */
        boolean enqueue(byte[] frame) {
            if (closing.get()) return false;
            if (queuedBytes.addAndGet(frame.length) > MAX_QUEUED_BYTES) { close(1013, "too slow"); return false; }
            queue.offer(frame);
            return true;
        }

        /** Sends a close frame after everything already queued, then drops the connection. */
        void close(int code, String reason) {
            if (!closing.compareAndSet(false, true)) return;
            queue.offer(WebSocketFrames.close(code, reason));
            queue.offer(POISON);
            forceCloseSoon();
        }

        /** Gives the writer two seconds to flush, then cuts the socket (a stalled device cannot hold us). */
        void forceCloseSoon() {
            ScheduledExecutorService sch = scheduler;
            if (sch != null && !sch.isShutdown()) {
                try { sch.schedule(this::forceClose, 2, TimeUnit.SECONDS); } catch (java.util.concurrent.RejectedExecutionException e) { forceClose(); }
            } else {
                forceClose();
            }
        }

        void forceClose() {
            closing.set(true);
            queue.offer(POISON);
            try { socket.close(); } catch (IOException ignored) { /* already closed */ }
        }

        void writeLoop() {
            try {
                for (;;) {
                    byte[] frame = queue.take();
                    if (frame == POISON) break;
                    out.write(frame);
                    out.flush();
                    queuedBytes.addAndGet(-frame.length);
                }
            } catch (IOException | InterruptedException e) {
                // the device went away mid-write
            } finally {
                try { socket.close(); } catch (IOException ignored) { /* already closed */ }
            }
        }
    }

    // ---- helpers ------------------------------------------------------------------------------------------------
    private void safe(Runnable r) {
        try { r.run(); } catch (RuntimeException e) { /* a listener bug must not kill the connection thread */ }
    }

    /** Status codes that may appear in a close frame we send (not the reserved 1005/1006/1015). */
    static boolean echoable(int c) {
        return (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1011) || (c >= 3000 && c <= 4999);
    }

    /** The upgrade must come from a page served by this very address. Browsers send Origin; plain clients may omit it. */
    static boolean sameOrigin(String origin, String host) {
        if (origin == null) return true;
        if (host == null) return false;
        int at = origin.indexOf("://");
        if (at < 0) return false; // "null" (file:// pages and sandboxed frames) and junk are refused
        String rest = origin.substring(at + 3);
        int slash = rest.indexOf('/');
        if (slash >= 0) rest = rest.substring(0, slash);
        return rest.equalsIgnoreCase(host);
    }

    static boolean hasToken(String header, String token) {
        if (header == null) return false;
        for (String t : header.split(",")) if (t.trim().equalsIgnoreCase(token)) return true;
        return false;
    }

    static boolean validKey(String key) {
        if (key == null) return false;
        try { return Base64.getDecoder().decode(key).length == 16; } catch (IllegalArgumentException e) { return false; }
    }

    /** Reads one header line (CRLF or LF terminated); null at end of stream. */
    static String readLine(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(64);
        for (;;) {
            int b = in.read();
            if (b < 0) return buf.size() == 0 ? null : buf.toString("ISO-8859-1");
            if (b == '\n') {
                byte[] bytes = buf.toByteArray();
                int n = bytes.length > 0 && bytes[bytes.length - 1] == '\r' ? bytes.length - 1 : bytes.length;
                return new String(bytes, 0, n, StandardCharsets.ISO_8859_1);
            }
            buf.write(b);
            if (buf.size() > limit) throw new IOException("header line too long");
        }
    }

    private static void respond(OutputStream out, int status, String reason, String type, String body, boolean head, String... extra) throws IOException {
        respond(out, status, reason, type, body.getBytes(StandardCharsets.UTF_8), head, extra);
    }

    private static void respond(OutputStream out, int status, String reason, String type, byte[] body, boolean head, String... extra) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n")
                .append("Content-Type: ").append(type).append("\r\n")
                .append("Content-Length: ").append(body.length).append("\r\n")
                .append("Cache-Control: no-cache\r\n")
                .append("X-Content-Type-Options: nosniff\r\n")
                .append("Referrer-Policy: no-referrer\r\n")
                .append("X-Frame-Options: DENY\r\n")
                .append("Content-Security-Policy: ").append(CSP).append("\r\n")
                .append("Connection: close\r\n");
        for (String e : extra) sb.append(e).append("\r\n");
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!head) out.write(body);
        out.flush();
    }
}
