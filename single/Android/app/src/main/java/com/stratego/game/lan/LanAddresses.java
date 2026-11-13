package com.stratego.game.lan;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** The IPv4 addresses other devices can use to reach this one (Wi-Fi, hotspot, Ethernet), without Android types. */
public final class LanAddresses {
    private LanAddresses() {}

    public static List<String> list() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (isUsable(a) && !out.contains(a.getHostAddress())) out.add(a.getHostAddress());
                }
            }
        } catch (java.net.SocketException e) {
            // no interfaces to report
        }
        return out;
    }

    /** A private IPv4 address that is not loopback or link-local (those cannot be reached from other devices). */
    static boolean isUsable(InetAddress a) {
        return a instanceof Inet4Address && a.isSiteLocalAddress() && !a.isLoopbackAddress() && !a.isLinkLocalAddress();
    }
}
