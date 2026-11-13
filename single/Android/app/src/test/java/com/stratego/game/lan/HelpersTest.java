package com.stratego.game.lan;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
import org.junit.Test;

public class HelpersTest {
    @Test public void jsStringsAreEscapedForEvaluateJavascript() {
        assertEquals("\"hi\"", JsString.quote("hi"));
        assertEquals("\"a\\\"b\\\\c\"", JsString.quote("a\"b\\c"));
        assertEquals("\"line\\nbreak\\r\\t\"", JsString.quote("line\nbreak\r\t"));
        assertEquals("\"\\u2028\\u2029\"", JsString.quote("\u2028\u2029"));
        assertEquals("\"\\u003c/script>\"", JsString.quote("</script>"));
        assertEquals("\"\\u0001\"", JsString.quote("\u0001"));
        assertEquals("unicode passes through", "\"Zażółć 🚩\"", JsString.quote("Zażółć 🚩"));
        assertEquals("\"{\\\"t\\\":\\\"state\\\"}\"", JsString.quote("{\"t\":\"state\"}"));
    }

    @Test public void joinAddressesAreNormalizedAndLimitedToPrivateNetworks() {
        assertEquals("http://192.168.1.20:8080/", UrlGuard.normalize("192.168.1.20"));
        assertEquals("http://192.168.1.20:9090/", UrlGuard.normalize(" 192.168.1.20:9090 "));
        assertEquals("http://10.0.0.7:8081/", UrlGuard.normalize("http://10.0.0.7:8081/some/path"));
        assertEquals("http://172.20.10.1:8080/", UrlGuard.normalize("HTTP://172.20.10.1"));
        assertEquals("http://127.0.0.1:8080/", UrlGuard.normalize("127.0.0.1"));
        assertNull("public address", UrlGuard.normalize("8.8.8.8:8080"));
        assertNull("hostname", UrlGuard.normalize("example.com"));
        assertNull("https", UrlGuard.normalize("https://192.168.1.20"));
        assertNull("javascript:", UrlGuard.normalize("javascript:alert(1)"));
        assertNull("file", UrlGuard.normalize("file:///etc/passwd"));
        assertNull("bad port", UrlGuard.normalize("192.168.1.20:99999"));
        assertNull("empty port", UrlGuard.normalize("192.168.1.20:"));
        assertNull("octet too big", UrlGuard.normalize("192.168.1.300"));
        assertNull("garbage", UrlGuard.normalize("192.168.1.20:80a"));
        assertNull(UrlGuard.normalize(null));
        assertNull("172.32 is public", UrlGuard.normalize("172.32.0.1"));
        assertTrue(UrlGuard.isPrivateIpv4("172.31.255.255"));
    }

    @Test public void theRemoteWebViewStaysOnTheChosenServer() {
        String base = "http://192.168.1.20:8080/";
        assertTrue(UrlGuard.sameServer(base, "http://192.168.1.20:8080/"));
        assertTrue(UrlGuard.sameServer(base, "http://192.168.1.20:8080"));
        assertTrue(UrlGuard.sameServer(base, "http://192.168.1.20:8080/ws"));
        assertFalse(UrlGuard.sameServer(base, "http://192.168.1.21:8080/"));
        assertFalse(UrlGuard.sameServer(base, "http://192.168.1.20:80801/"));
        assertFalse(UrlGuard.sameServer(base, "https://192.168.1.20:8080/"));
        assertFalse(UrlGuard.sameServer(base, "http://evil.example/"));
        assertFalse(UrlGuard.sameServer(null, base));
    }

    @Test public void discoveredGamesPreferTheHostsOwnAddressHint() {
        assertEquals("the hint wins over a Docker bridge address the resolver picked", "172.20.10.5", UrlGuard.pickHost("172.17.0.1", "172.20.10.5"));
        assertEquals("no hint: use what was resolved", "192.168.1.20", UrlGuard.pickHost("192.168.1.20", null));
        assertEquals("a bad hint is ignored", "192.168.1.20", UrlGuard.pickHost("192.168.1.20", "8.8.8.8"));
        assertEquals("a public resolved address is never offered", null, UrlGuard.pickHost("8.8.8.8", "not an address"));
        assertEquals(null, UrlGuard.pickHost(null, null));
    }

    @Test public void onlyReachablePrivateIpv4AddressesAreOffered() throws Exception {
        assertTrue(LanAddresses.isUsable(InetAddress.getByName("192.168.1.20")));
        assertTrue(LanAddresses.isUsable(InetAddress.getByName("172.20.10.1")));
        assertFalse(LanAddresses.isUsable(InetAddress.getByName("127.0.0.1")));
        assertFalse(LanAddresses.isUsable(InetAddress.getByName("169.254.3.4")));
        assertFalse(LanAddresses.isUsable(InetAddress.getByName("8.8.8.8")));
        assertFalse(LanAddresses.isUsable(InetAddress.getByName("::1")));
        for (String a : LanAddresses.list()) assertTrue(a, UrlGuard.isPrivateIpv4(a));
    }
}
