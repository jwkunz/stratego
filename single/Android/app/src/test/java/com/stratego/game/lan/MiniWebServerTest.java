package com.stratego.game.lan;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Test;

public class MiniWebServerTest {
    /** Records what the server reports, like the app's bridge would receive it. */
    private static final class Rec implements MiniWebServer.Listener {
        final BlockingQueue<String> events = new LinkedBlockingQueue<>();
        public void onOpen(int id) { events.add("open:" + id); }
        public void onMessage(int id, String text) { events.add("msg:" + id + ":" + text); }
        public void onClose(int id, int code) { events.add("close:" + id + ":" + code); }
        String next() throws InterruptedException { String e = events.poll(5, TimeUnit.SECONDS); assertNotNull("an event within 5s", e); return e; }
    }

    private static final byte[] PAGE = "<html>stratego</html>".getBytes(StandardCharsets.UTF_8);
    private MiniWebServer server;
    private final Rec rec = new Rec();

    private int start(int maxConnections) throws IOException {
        server = new MiniWebServer(rec, () -> PAGE, maxConnections);
        return server.start(18080);
    }

    @After public void tearDown() { if (server != null) server.stop(); }

    @Test(timeout = 20000) public void servesThePageHealthAndRefusesTheRest() throws Exception {
        int port = start(8);
        String page = RawClient.http(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        assertTrue(page, page.startsWith("HTTP/1.1 200 OK"));
        assertTrue(page.contains("<html>stratego</html>"));
        assertTrue(page.contains("X-Content-Type-Options: nosniff"));
        assertTrue(page.contains("Content-Security-Policy: default-src 'self'"));
        assertTrue(page.contains("Content-Length: " + PAGE.length));

        String head = RawClient.http(port, "HEAD / HTTP/1.1\r\nHost: x\r\n\r\n");
        assertTrue(head.startsWith("HTTP/1.1 200 OK"));
        assertFalse("no body for HEAD", head.contains("stratego</html>"));

        assertTrue(RawClient.http(port, "GET /health HTTP/1.1\r\nHost: x\r\n\r\n").contains("{\"ok\":true,\"devices\":0}"));
        assertTrue(RawClient.http(port, "GET /nope HTTP/1.1\r\nHost: x\r\n\r\n").startsWith("HTTP/1.1 404"));
        String post = RawClient.http(port, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n");
        assertTrue(post.startsWith("HTTP/1.1 405")); assertTrue(post.contains("Allow: GET, HEAD"));
        assertTrue(RawClient.http(port, "garbage\r\n\r\n").startsWith("HTTP/1.1 400"));
        assertTrue("path traversal is just a 404", RawClient.http(port, "GET /../../etc/passwd HTTP/1.1\r\nHost: x\r\n\r\n").startsWith("HTTP/1.1 404"));

        StringBuilder many = new StringBuilder("GET / HTTP/1.1\r\n");
        for (int i = 0; i < 100; i++) many.append("X-").append(i).append(": y\r\n");
        assertTrue(RawClient.http(port, many.append("\r\n").toString()).startsWith("HTTP/1.1 431"));
    }

    @Test(timeout = 20000) public void withoutAPageTheServerSays503() throws Exception {
        server = new MiniWebServer(rec, () -> null, 4);
        int port = server.start(18090);
        assertTrue(RawClient.http(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n").startsWith("HTTP/1.1 503"));
    }

    @Test(timeout = 20000) public void fallsBackToTheNextPortWhenTheFirstIsTaken() throws Exception {
        try (ServerSocket taken = new ServerSocket(18100)) {
            server = new MiniWebServer(rec, () -> PAGE, 4);
            assertEquals(18101, server.start(18100));
        }
    }

    @Test(timeout = 20000) public void upgradeChecksOriginHeadersVersionKeyAndCapacity() throws Exception {
        int port = start(1);
        String key = RawClient.newKey();
        assertTrue(RawClient.http(port, RawClient.upgradeRequest(port, "http://evil.example", key)).startsWith("HTTP/1.1 403"));
        assertTrue(RawClient.http(port, RawClient.upgradeRequest(port, "null", key)).startsWith("HTTP/1.1 403"));
        assertTrue(RawClient.http(port, "GET /ws HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n\r\n").startsWith("HTTP/1.1 400"));
        assertTrue(RawClient.http(port, RawClient.upgradeRequest(port, null, "bad")).startsWith("HTTP/1.1 400"));
        String old = RawClient.upgradeRequest(port, null, key).replace("Sec-WebSocket-Version: 13", "Sec-WebSocket-Version: 8");
        String r = RawClient.http(port, old);
        assertTrue(r.startsWith("HTTP/1.1 426")); assertTrue(r.contains("Sec-WebSocket-Version: 13"));
        try (RawClient plain = new RawClient(port)) { // no Origin header (not a browser) is fine
            plain.out.write(RawClient.upgradeRequest(port, null, key).getBytes(StandardCharsets.ISO_8859_1));
            plain.out.flush();
            assertTrue(plain.readHead().startsWith("HTTP/1.1 101"));
        }
        assertEquals("the failed attempts opened nothing", "open:1", rec.next());
    }

    @Test(timeout = 20000) public void messagesFlowBothWaysInOrder() throws Exception {
        int port = start(8);
        try (RawClient c = RawClient.connect(port)) {
            assertEquals("open:1", rec.next());
            for (int i = 0; i < 50; i++) c.sendText("m" + i);
            for (int i = 0; i < 50; i++) assertEquals("msg:1:m" + i, rec.next());
            for (int i = 0; i < 50; i++) assertTrue(server.send(1, "reply" + i));
            for (int i = 0; i < 50; i++) assertEquals("reply" + i, c.readFrame().text());
            assertEquals(1, server.connectionCount());
            assertTrue(RawClient.http(port, "GET /health HTTP/1.1\r\nHost: x\r\n\r\n").contains("\"devices\":1"));
            assertFalse("unknown connection", server.send(99, "x"));
        }
    }

    @Test(timeout = 20000) public void largeMessagesSurviveInBothDirections() throws Exception {
        int port = start(8);
        String big = "{\"board\":\"" + "x".repeat(60_000) + "\"}";
        String huge = "y".repeat(300_000); // server -> client has no 64 KB limit
        try (RawClient c = RawClient.connect(port)) {
            rec.next();
            c.sendText(big);
            assertEquals("msg:1:" + big, rec.next());
            server.send(1, huge);
            assertEquals(huge, c.readFrame().text());
        }
    }

    @Test(timeout = 20000) public void closeHandshakeFromTheClientIsEchoedAndReported() throws Exception {
        int port = start(8);
        try (RawClient c = RawClient.connect(port)) {
            rec.next();
            c.sendFrame(8, true, new byte[] {0x03, (byte) 0xE8}); // 1000
            RawClient.Frame f = c.readFrame();
            assertEquals(8, f.opcode); assertEquals(1000, f.closeCode());
            assertEquals("close:1:1000", rec.next());
        }
    }

    @Test(timeout = 20000) public void serverInitiatedCloseSendsTheCodeThenEndsTheStream() throws Exception {
        int port = start(8);
        try (RawClient c = RawClient.connect(port)) {
            rec.next();
            server.send(1, "last words");
            server.close(1, 1008, "too many messages");
            assertEquals("last words", c.readFrame().text());
            RawClient.Frame f = c.readFrame();
            assertEquals(8, f.opcode); assertEquals(1008, f.closeCode());
            assertNull("stream ends after the close frame", c.readFrame());
            assertEquals("close:1:" + 1006, rec.next().replaceAll("close:1:\\d+", "close:1:1006")); // reported once
        }
    }

    @Test(timeout = 20000) public void pingsAreAnsweredAndAbruptDisconnectsAreReported() throws Exception {
        int port = start(8);
        RawClient c = RawClient.connect(port);
        rec.next();
        c.sendFrame(9, true, "hi".getBytes(StandardCharsets.UTF_8));
        RawClient.Frame pong = c.readFrame();
        assertEquals(10, pong.opcode); assertEquals("hi", pong.text());
        c.close(); // no goodbye
        assertEquals("close:1:1006", rec.next());
    }

    @Test(timeout = 20000) public void badFramesGetTheRightCloseCodeAndAreReported() throws Exception {
        int port = start(8);
        try (RawClient c = RawClient.connect(port)) {
            rec.next();
            c.sendRaw((byte) 0x81, (byte) 0x01, (byte) 'a'); // unmasked
            RawClient.Frame f = c.readFrame();
            assertEquals(8, f.opcode); assertEquals(1002, f.closeCode());
            assertEquals("close:1:1002", rec.next());
        }
        try (RawClient c = RawClient.connect(port)) {
            rec.next();
            c.sendFrame(1, true, "z".repeat(MiniWebServer.MAX_MESSAGE + 1).getBytes(StandardCharsets.UTF_8));
            assertEquals(1009, c.readFrame().closeCode());
            assertEquals("close:2:1009", rec.next());
        }
        try (RawClient c = RawClient.connect(port)) {
            rec.next();
            c.sendFrame(2, true, new byte[] {1, 2, 3}); // binary
            assertEquals(1003, c.readFrame().closeCode());
            rec.next();
        }
    }

    @Test(timeout = 20000) public void connectionCapAndStopBehaveWell() throws Exception {
        int port = start(2);
        RawClient a = RawClient.connect(port), b = RawClient.connect(port);
        rec.next(); rec.next();
        String refused = RawClient.http(port, RawClient.upgradeRequest(port, null, RawClient.newKey()));
        assertTrue(refused, refused.startsWith("HTTP/1.1 503"));
        server.stop();
        assertEquals(1001, a.readFrame().closeCode());
        assertEquals(1001, b.readFrame().closeCode());
        try { RawClient.http(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n"); assertTrue("server should be gone", false); } catch (IOException expected) { /* refused */ }
        a.close(); b.close();
    }

    @Test(timeout = 30000) public void aDeviceThatNeverReadsCannotBlockTheSenderAndIsCutOff() throws Exception {
        int port = start(8);
        try (RawClient c = RawClient.connect(port)) {
            rec.next();
            String chunk = "q".repeat(60_000);
            long start = System.nanoTime();
            for (int i = 0; i < 400; i++) server.send(1, chunk); // 24 MB the device never reads
            long ms = (System.nanoTime() - start) / 1_000_000;
            assertTrue("send() must not block (took " + ms + " ms)", ms < 3000);
            String ev = rec.next();
            assertTrue("the slow device is closed: " + ev, ev.startsWith("close:1:"));
            assertFalse("and later sends fail", server.send(1, "x"));
        }
    }

    @Test(timeout = 30000) public void manyDevicesAtOnceKeepTheirOwnOrder() throws Exception {
        int port = start(40);
        int devices = 20, per = 60;
        List<RawClient> clients = new ArrayList<>();
        for (int i = 0; i < devices; i++) clients.add(RawClient.connect(port));
        Map<Integer, List<String>> got = new HashMap<>();
        CountDownLatch done = new CountDownLatch(devices * per);
        Thread collector = new Thread(() -> {
            try {
                int opens = 0;
                while (done.getCount() > 0) {
                    String e = rec.events.poll(5, TimeUnit.SECONDS);
                    if (e == null) return;
                    if (e.startsWith("open:")) { opens++; continue; }
                    String[] p = e.split(":", 3);
                    synchronized (got) { got.computeIfAbsent(Integer.parseInt(p[1]), k -> new ArrayList<>()).add(p[2]); }
                    done.countDown();
                }
            } catch (InterruptedException ignored) { /* test ending */ }
        });
        collector.start();
        List<Thread> senders = new ArrayList<>();
        for (RawClient c : clients) {
            Thread t = new Thread(() -> { try { for (int i = 0; i < per; i++) c.sendText("n" + i); } catch (IOException ignored) { /* reported by the assertion below */ } });
            senders.add(t); t.start();
        }
        assertTrue("all messages arrived", done.await(15, TimeUnit.SECONDS));
        synchronized (got) {
            assertEquals(devices, got.size());
            for (List<String> msgs : got.values()) for (int i = 0; i < per; i++) assertEquals("n" + i, msgs.get(i));
        }
        for (RawClient c : clients) c.close();
    }

    @Test(timeout = 20000) public void aSilentDeviceIsDroppedAfterTheReadTimeoutAndPingsKeepItAlive() throws Exception {
        server = new MiniWebServer(rec, () -> PAGE, 4, 1, 1500); // ping every second, give up after 1.5 s of silence
        int port = server.start(18200);
        try (RawClient c = RawClient.connect(port)) {
            assertEquals("open:1", rec.next());
            RawClient.Frame ping = c.readFrame();
            assertEquals("the server pings", 9, ping.opcode);
            c.sendFrame(10, true, ping.payload); // a live device answers
            Thread.sleep(800);
            c.sendFrame(10, true, new byte[0]);
            Thread.sleep(800);
            c.sendFrame(10, true, new byte[0]);
            assertEquals("still open after more than the timeout in total", 0, rec.events.size());
            // now go silent
            assertTrue(rec.next().startsWith("close:1:"));
        }
    }
}
