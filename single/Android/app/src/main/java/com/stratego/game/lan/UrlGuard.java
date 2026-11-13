package com.stratego.game.lan;

import java.net.InetAddress;
import java.net.UnknownHostException;

/** Decides which addresses the Join screen may open: only plain HTTP to a private-network IPv4 address. */
public final class UrlGuard {
    private UrlGuard() {}

    /**
     * Accepts "192.168.1.20", "192.168.1.20:8080", "http://192.168.1.20:8080" or with a trailing slash/path,
     * and returns the normalized "http://host:port/" (default port 8080). Returns null for anything else.
     */
    public static String normalize(String input) {
        if (input == null) return null;
        String s = input.trim();
        if (s.regionMatches(true, 0, "http://", 0, 7)) s = s.substring(7);
        else if (s.contains("://")) return null;
        int slash = s.indexOf('/');
        if (slash >= 0) s = s.substring(0, slash);
        int colon = s.lastIndexOf(':');
        String host = colon >= 0 ? s.substring(0, colon) : s;
        int port = 8080;
        if (colon >= 0) {
            String p = s.substring(colon + 1);
            if (p.isEmpty() || p.length() > 5 || !p.chars().allMatch(Character::isDigit)) return null;
            port = Integer.parseInt(p);
            if (port < 1 || port > 65535) return null;
        }
        if (!isPrivateIpv4(host)) return null;
        return "http://" + host + ":" + port + "/";
    }

    /** True for a dotted-quad IPv4 literal in a private, link-local or loopback range. */
    public static boolean isPrivateIpv4(String host) {
        if (host == null || !host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        for (String part : host.split("\\.")) if (Integer.parseInt(part) > 255) return false;
        try {
            InetAddress a = InetAddress.getByName(host); // a literal: no DNS lookup happens
            return a.isSiteLocalAddress() || a.isLinkLocalAddress() || a.isLoopbackAddress();
        } catch (UnknownHostException e) {
            return false;
        }
    }

    /**
     * Which address to show for a discovered game: the host's own `addr` hint (its best LAN address; a PC may also have
     * container or VM addresses that the resolver could pick) if it is a private IPv4 address, else what the network
     * resolver found, else nothing.
     */
    public static String pickHost(String resolved, String advertised) {
        if (isPrivateIpv4(advertised)) return advertised;
        return isPrivateIpv4(resolved) ? resolved : null;
    }

    /** True when a page URL stays on the server the user chose (same scheme, host and port). */
    public static boolean sameServer(String allowedBase, String url) {
        if (allowedBase == null || url == null) return false;
        return url.equals(allowedBase.substring(0, allowedBase.length() - 1)) || url.startsWith(allowedBase);
    }
}
