package com.stratego.game;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.stratego.game.lan.JsString;
import com.stratego.game.lan.LanAddresses;
import com.stratego.game.lan.MiniWebServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;

/**
 * The bridge between the game host running in the app's WebView (JavaScript) and the native web server. Exposed to
 * bundled pages only, as `NativeHost`. It moves text frames across and manages hosting; it holds no game logic.
 */
final class NativeHostBridge {
    private final Activity activity;
    private final WebView web;
    private final Discovery discovery;
    private final Handler main = new Handler(Looper.getMainLooper());
    private MiniWebServer server;
    private int port;
    private byte[] clientPage;

    NativeHostBridge(Activity activity, WebView web, Discovery discovery) {
        this.activity = activity;
        this.web = web;
        this.discovery = discovery;
    }

    synchronized boolean isHosting() { return server != null; }

    // ---- called from JavaScript (on a WebView thread) ------------------------------------------------------------
    /** Starts hosting. Returns JSON: {"ok":true,"port":8080,"addresses":["192.168.1.20"]} or {"ok":false,"error":"..."}. */
    @JavascriptInterface
    public synchronized String start(int port) {
        if (server == null) {
            MiniWebServer s = new MiniWebServer(new MiniWebServer.Listener() {
                @Override public void onOpen(int id) { js("window.StrategoBridge&&StrategoBridge.onOpen(" + id + ")"); }
                @Override public void onMessage(int id, String text) { js("window.StrategoBridge&&StrategoBridge.onMessage(" + id + "," + JsString.quote(text) + ")"); }
                @Override public void onClose(int id, int code) { js("window.StrategoBridge&&StrategoBridge.onClose(" + id + "," + code + ")"); }
            }, this::page, 24);
            int actual;
            try {
                actual = s.start(port);
            } catch (IOException e) {
                return "{\"ok\":false,\"error\":" + JsString.quote("Could not open a network port: " + e.getMessage()) + "}";
            }
            server = s;
            this.port = actual;
            List<String> addresses = LanAddresses.list();
            discovery.register("Stratego on " + Build.MODEL, actual, addresses.isEmpty() ? null : addresses.get(0));
            String first = addresses.isEmpty() ? "" : "http://" + addresses.get(0) + ":" + actual;
            HostService.onStopRequested = () -> main.post(this::stopFromNotification);
            main.post(() -> {
                HostService.start(activity, first);
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    activity.requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 1);
                }
            });
        }
        return "{\"ok\":true,\"port\":" + this.port + ",\"addresses\":[" + addressesJson() + "]}";
    }

    @JavascriptInterface
    public synchronized void stop() {
        if (server == null) return;
        server.stop();
        server = null;
        discovery.unregister();
        HostService.onStopRequested = null;
        main.post(() -> {
            HostService.stop(activity);
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @JavascriptInterface
    public synchronized void send(int id, String text) {
        if (server != null) server.send(id, text);
    }

    @JavascriptInterface
    public synchronized void close(int id, int code, String reason) {
        if (server != null) server.close(id, code, reason);
    }

    // ---- helpers ---------------------------------------------------------------------------------------------------
    /** The Stop button in the notification: tell the page (so it stops the game host too), then stop. */
    private void stopFromNotification() {
        js("window.__stratego_host&&__stratego_host.stop()");
        stop();
        web.loadUrl("file:///android_asset/lan.html");
    }

    private void js(String script) {
        main.post(() -> web.evaluateJavascript(script, null));
    }

    private static String addressesJson() {
        List<String> a = LanAddresses.list();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < a.size(); i++) sb.append(i > 0 ? "," : "").append(JsString.quote(a.get(i)));
        return sb.toString();
    }

    /** The multiplayer client page that other devices load from this phone (bundled as assets/client.html). */
    private synchronized byte[] page() {
        if (clientPage == null) {
            try (InputStream in = activity.getAssets().open("client.html")) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                clientPage = out.toByteArray();
            } catch (IOException e) {
                return null;
            }
        }
        return clientPage;
    }
}
