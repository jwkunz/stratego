package com.stratego.game;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import com.stratego.game.lan.UrlGuard;
import java.net.Inet4Address;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Finds games on the local network with Android's NsdManager (DNS-SD / mDNS): a host advertises "_stratego._tcp",
 * and the Join screen lists whoever advertises it. Networks that block multicast simply find nothing; typing the
 * address always works.
 */
final class Discovery {
    static final String TYPE = "_stratego._tcp.";

    interface Callback {
        void found(String name, String host, int port);
        void lost(String name);
    }

    private final NsdManager nsd;
    private NsdManager.RegistrationListener registration;
    private String ownName;
    private NsdManager.DiscoveryListener discovery;
    private final Deque<NsdServiceInfo> toResolve = new ArrayDeque<>();
    private boolean resolving;

    Discovery(Context c) {
        nsd = (NsdManager) c.getSystemService(Context.NSD_SERVICE);
    }

    // ---- advertising (the host) -------------------------------------------------------------------------------
    synchronized void register(String name, int port, String bestAddress) {
        unregister();
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(name);
        info.setServiceType(TYPE);
        info.setPort(port);
        info.setAttribute("app", "stratego");
        if (bestAddress != null && !bestAddress.isEmpty()) info.setAttribute("addr", bestAddress);
        ownName = name;
        registration = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo i) { synchronized (Discovery.this) { ownName = i.getServiceName(); } }
            @Override public void onRegistrationFailed(NsdServiceInfo i, int code) { /* discovery is a convenience; the address still works */ }
            @Override public void onServiceUnregistered(NsdServiceInfo i) { }
            @Override public void onUnregistrationFailed(NsdServiceInfo i, int code) { }
        };
        try { nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration); } catch (RuntimeException e) { registration = null; }
    }

    synchronized void unregister() {
        if (registration != null) {
            try { nsd.unregisterService(registration); } catch (RuntimeException ignored) { /* not registered */ }
            registration = null;
        }
        ownName = null;
    }

    // ---- searching (the Join screen) ----------------------------------------------------------------------------
    synchronized void startDiscovery(Callback cb) {
        stopDiscovery();
        discovery = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String type) { }
            @Override public void onStartDiscoveryFailed(String type, int code) { }
            @Override public void onStopDiscoveryFailed(String type, int code) { }
            @Override public void onDiscoveryStopped(String type) { }

            @Override public void onServiceFound(NsdServiceInfo info) {
                synchronized (Discovery.this) {
                    if (info.getServiceName().equals(ownName)) return; // our own game
                    toResolve.add(info);
                    resolveNext(cb);
                }
            }

            @Override public void onServiceLost(NsdServiceInfo info) { cb.lost(info.getServiceName()); }
        };
        try { nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, discovery); } catch (RuntimeException e) { discovery = null; }
    }

    synchronized void stopDiscovery() {
        if (discovery != null) {
            try { nsd.stopServiceDiscovery(discovery); } catch (RuntimeException ignored) { /* already stopped */ }
            discovery = null;
        }
        toResolve.clear();
        resolving = false;
    }

    /** Older Android versions can only resolve one service at a time, so they queue. */
    @SuppressWarnings("deprecation")
    private void resolveNext(Callback cb) {
        if (resolving || toResolve.isEmpty()) return;
        NsdServiceInfo next = toResolve.poll();
        resolving = true;
        try {
            nsd.resolveService(next, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo info, int code) { done(); }

                @Override public void onServiceResolved(NsdServiceInfo info) {
                    String resolved = info.getHost() instanceof Inet4Address ? info.getHost().getHostAddress() : null;
                    byte[] hint = info.getAttributes() == null ? null : info.getAttributes().get("addr");
                    String host = UrlGuard.pickHost(resolved, hint == null ? null : new String(hint, java.nio.charset.StandardCharsets.UTF_8));
                    if (host != null) cb.found(info.getServiceName(), host, info.getPort());
                    done();
                }

                private void done() { synchronized (Discovery.this) { resolving = false; resolveNext(cb); } }
            });
        } catch (RuntimeException e) {
            resolving = false;
        }
    }

    synchronized void close() {
        stopDiscovery();
        unregister();
    }
}
