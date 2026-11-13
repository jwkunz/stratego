package com.stratego.game.lan;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class FramesTest {
    private static byte[] bytes(int... v) {
        byte[] b = new byte[v.length];
        for (int i = 0; i < v.length; i++) b[i] = (byte) v[i];
        return b;
    }

    /** Records what the reader reports. */
    private static final class Log implements FrameReader.Handler {
        final List<String> events = new ArrayList<>();
        public void text(String m) { events.add("text:" + m); }
        public void ping(byte[] p) { events.add("ping:" + new String(p, StandardCharsets.UTF_8)); }
        public void pong(byte[] p) { events.add("pong:" + new String(p, StandardCharsets.UTF_8)); }
        public void close(int c, String r) { events.add("close:" + c + ":" + r); }
    }

    private static Log read(int max, byte[] data) throws IOException {
        Log log = new Log();
        FrameReader r = new FrameReader(new ByteArrayInputStream(data), max);
        while (r.next(log)) { /* until the data ends */ }
        return log;
    }

    private static int codeOf(byte[] data, int max) {
        try { read(max, data); } catch (FrameReader.FrameException e) { return e.code; } catch (IOException e) { return -1; }
        return 0;
    }

    @Test public void handshakeKeyMatchesTheRfcExample() {
        assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WebSocketFrames.acceptKey("dGhlIHNhbXBsZSBub25jZQ=="));
    }

    @Test public void maskedHelloFromTheRfcDecodes() throws IOException {
        assertEquals("[text:Hello]", read(1000, bytes(0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58)).events.toString());
    }

    @Test public void fragmentedMessageFromTheRfcIsAssembled() throws IOException {
        byte[] data = bytes(0x01, 0x83, 0, 0, 0, 0, 'H', 'e', 'l', 0x80, 0x82, 0, 0, 0, 0, 'l', 'o');
        assertEquals("[text:Hello]", read(1000, data).events.toString());
    }

    @Test public void controlFramesMayInterruptAFragmentedMessage() throws IOException {
        byte[] data = bytes(0x01, 0x82, 0, 0, 0, 0, 'a', 'b', 0x89, 0x81, 0, 0, 0, 0, 'x', 0x80, 0x81, 0, 0, 0, 0, 'c');
        assertEquals("[ping:x, text:abc]", read(1000, data).events.toString());
    }

    @Test public void closeFrameCarriesCodeAndReason() throws IOException {
        byte[] data = bytes(0x88, 0x84, 0, 0, 0, 0, 0x03, 0xE8, 'o', 'k');
        assertEquals("[close:1000:ok]", read(1000, data).events.toString());
        assertEquals("[close:1005:]", read(1000, bytes(0x88, 0x80, 0, 0, 0, 0)).events.toString());
    }

    @Test public void extendedLengthsWork() throws IOException {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 70000; i++) sb.append('x');
        byte[] payload = sb.toString().getBytes(StandardCharsets.UTF_8);
        for (int len : new int[] {200, 70000}) {
            byte[] p = java.util.Arrays.copyOf(payload, len);
            java.io.ByteArrayOutputStream f = new java.io.ByteArrayOutputStream();
            f.write(0x81);
            if (len <= 0xFFFF) { f.write(0x80 | 126); f.write(len >> 8); f.write(len); }
            else { f.write(0x80 | 127); for (int i = 7; i >= 0; i--) f.write((int) (((long) len >> (8 * i)) & 0xFF)); }
            f.write(new byte[4]);
            f.write(p);
            assertEquals("text:" + new String(p), read(100_000, f.toByteArray()).events.get(0));
        }
    }

    @Test public void protocolViolationsAreRefused() {
        assertEquals("unmasked client frame", 1002, codeOf(bytes(0x81, 0x01, 'a'), 100));
        assertEquals("reserved bits", 1002, codeOf(bytes(0xC1, 0x80, 0, 0, 0, 0), 100));
        assertEquals("unknown opcode", 1002, codeOf(bytes(0x83, 0x80, 0, 0, 0, 0), 100));
        assertEquals("fragmented control frame", 1002, codeOf(bytes(0x09, 0x80, 0, 0, 0, 0), 100));
        assertEquals("oversize control frame", 1002, codeOf(bytes(0x89, 0xFE, 0, 126), 100));
        assertEquals("continuation with nothing before it", 1002, codeOf(bytes(0x80, 0x81, 0, 0, 0, 0, 'a'), 100));
        assertEquals("a new text message in the middle of one", 1002,
                codeOf(bytes(0x01, 0x81, 0, 0, 0, 0, 'a', 0x01, 0x81, 0, 0, 0, 0, 'b'), 100));
        assertEquals("binary", 1003, codeOf(bytes(0x82, 0x81, 0, 0, 0, 0, 1), 100));
        assertEquals("negative 64-bit length", 1002, codeOf(bytes(0x81, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF), 100));
    }

    @Test public void tooBigMessagesAreRefusedBeforeTheyAreRead() {
        // the header claims 1 MB; nothing follows, but the reader must already say "too big" instead of waiting for data
        assertEquals(1009, codeOf(bytes(0x81, 0xFE, 0x10, 0x00 << 4), 100));
        assertEquals("fragments that add up", 1009,
                codeOf(bytes(0x01, 0x83, 0, 0, 0, 0, 'a', 'b', 'c', 0x80, 0x83, 0, 0, 0, 0, 'd', 'e', 'f'), 5));
    }

    @Test public void invalidUtf8IsRefused() {
        assertEquals(1007, codeOf(bytes(0x81, 0x82, 0, 0, 0, 0, 0xC3, 0x28), 100));
        assertEquals(1007, codeOf(bytes(0x81, 0x81, 0, 0, 0, 0, 0xFF), 100));
    }

    @Test public void multibyteTextSurvives() throws IOException {
        byte[] t = "Zażółć 🚩".getBytes(StandardCharsets.UTF_8);
        byte[] f = new byte[6 + t.length];
        f[0] = (byte) 0x81; f[1] = (byte) (0x80 | t.length);
        System.arraycopy(t, 0, f, 6, t.length);
        assertEquals("[text:Zażółć 🚩]", read(100, f).events.toString());
    }

    @Test public void streamEndsCleanlyBetweenFramesButNotInsideOne() throws IOException {
        assertTrue(read(100, new byte[0]).events.isEmpty());
        try { read(100, bytes(0x81, 0x85, 1, 2)); fail("expected EOF"); } catch (java.io.EOFException expected) { /* mid-frame */ }
    }

    @Test public void serverFramesAreEncodedUnmaskedWithTheRightLengths() {
        assertArrayEquals(bytes(0x81, 0x02, 'h', 'i'), WebSocketFrames.text("hi"));
        byte[] mid = WebSocketFrames.text("x".repeat(300));
        assertEquals(0x81, mid[0] & 0xFF); assertEquals(126, mid[1] & 0xFF); assertEquals(300, ((mid[2] & 0xFF) << 8) | (mid[3] & 0xFF));
        byte[] big = WebSocketFrames.text("x".repeat(70000));
        assertEquals(127, big[1] & 0xFF); assertEquals(70000 + 10, big.length);
        byte[] close = WebSocketFrames.close(1001, "bye");
        assertEquals(0x88, close[0] & 0xFF); assertEquals(5, close[1] & 0xFF);
        assertEquals(1001, ((close[2] & 0xFF) << 8) | (close[3] & 0xFF));
        assertFalse("close reasons are capped for control frames", WebSocketFrames.close(1000, "y".repeat(500)).length > 127);
    }

    @Test public void originAndHeaderHelpers() {
        assertTrue(MiniWebServer.sameOrigin(null, "1.2.3.4:8080"));
        assertTrue(MiniWebServer.sameOrigin("http://192.168.1.5:8080", "192.168.1.5:8080"));
        assertFalse(MiniWebServer.sameOrigin("http://evil.example", "192.168.1.5:8080"));
        assertFalse(MiniWebServer.sameOrigin("null", "192.168.1.5:8080"));
        assertFalse(MiniWebServer.sameOrigin("http://192.168.1.5:9090", "192.168.1.5:8080"));
        assertFalse(MiniWebServer.sameOrigin("http://192.168.1.5:8080", null));
        assertTrue(MiniWebServer.hasToken("keep-alive, Upgrade", "upgrade"));
        assertFalse(MiniWebServer.hasToken("close", "upgrade"));
        assertTrue(MiniWebServer.validKey("dGhlIHNhbXBsZSBub25jZQ=="));
        assertFalse(MiniWebServer.validKey("short"));
        assertFalse(MiniWebServer.validKey(null));
        assertTrue(MiniWebServer.echoable(1000)); assertFalse(MiniWebServer.echoable(1005)); assertFalse(MiniWebServer.echoable(1006));
    }
}
