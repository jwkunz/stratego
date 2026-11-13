package com.stratego.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import com.stratego.game.lan.JsString;
import com.stratego.game.lan.UrlGuard;

/**
 * The Stratego app: a full-screen WebView for the bundled pages (single player, the "Play on LAN" menu, and the host
 * page), plus a second WebView for joining a game hosted on another device.
 *
 * The two are kept apart on purpose: only the bundled-pages WebView gets JavaScript bridges to the phone
 * (NativeHost and StrategoApp). The joining WebView loads pages from another device, so it gets none, and it may only
 * visit the one private-network address the user chose.
 */
public class MainActivity extends Activity {
    private static final int BACKGROUND = 0xFF1B1F27;
    private static final String ASSETS = "file:///android_asset/";

    private WebView web;     // bundled pages, with the bridges
    private WebView remote;  // pages of a game hosted elsewhere, no bridges
    private String remoteBase;
    private Discovery discovery;
    private NativeHostBridge host;

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        // Edge-to-edge is enforced on recent Android; keep the game clear of the system bars.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });

        // debug builds only: lets a developer inspect the WebViews from a computer (chrome://inspect)
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        discovery = new Discovery(this);
        web = newWebView();
        host = new NativeHostBridge(this, web, discovery);
        web.addJavascriptInterface(host, "NativeHost");
        web.addJavascriptInterface(new AppBridge(), "StrategoApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ASSETS); // bundled pages only
            }
        });

        remote = newWebView();
        remote.setVisibility(View.GONE);
        remote.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !UrlGuard.sameServer(remoteBase, request.getUrl().toString());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    closeRemote();
                    web.evaluateJavascript("window.StrategoLan&&StrategoLan.onError(" + JsString.quote("Could not reach that game. Check the address and that both devices are on the same Wi-Fi.") + ")", null);
                }
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(remote, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(ASSETS + "index.html");
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView newWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(BACKGROUND);
        w.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        w.setLongClickable(false);
        w.setHapticFeedbackEnabled(false);
        w.setOnLongClickListener(v -> true); // no text-selection popups while playing
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); // file:///android_asset/ is still served
        s.setAllowContentAccess(false);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        return w;
    }

    /** What the bundled "Play on LAN" page may ask of the app. Only reachable from bundled pages. */
    private final class AppBridge {
        /** Opens another device's game in the joining WebView. Returns false if the address is not allowed. */
        @JavascriptInterface
        public boolean openRemote(String address) {
            String url = UrlGuard.normalize(address);
            if (url == null) return false;
            runOnUiThread(() -> {
                remoteBase = url;
                remote.onResume(); // it was paused with the activity while hidden
                remote.loadUrl(url);
                remote.setVisibility(View.VISIBLE);
                web.setVisibility(View.GONE);
                web.onPause();
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
            return true;
        }

        @JavascriptInterface
        public void startDiscovery() {
            discovery.startDiscovery(new Discovery.Callback() {
                @Override public void found(String name, String address, int port) {
                    String json = "{\"name\":" + JsString.quote(name) + ",\"host\":" + JsString.quote(address) + ",\"port\":" + port + "}";
                    runOnUiThread(() -> web.evaluateJavascript("window.StrategoLan&&StrategoLan.onFound(" + json + ")", null));
                }

                @Override public void lost(String name) {
                    runOnUiThread(() -> web.evaluateJavascript("window.StrategoLan&&StrategoLan.onLost(" + JsString.quote(name) + ")", null));
                }
            });
        }

        @JavascriptInterface
        public void stopDiscovery() { discovery.stopDiscovery(); }

        @JavascriptInterface
        public String deviceName() { return Build.MODEL; }
    }

    /** Leaves a game hosted elsewhere and returns to the bundled pages. */
    private void closeRemote() {
        runOnUiThread(() -> {
            remote.loadUrl("about:blank");
            remote.setVisibility(View.GONE);
            remote.onPause();
            web.setVisibility(View.VISIBLE);
            web.onResume();
            remoteBase = null;
            if (!host.isHosting()) getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            web.loadUrl(ASSETS + "lan.html");
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        String url = web.getUrl() == null ? "" : web.getUrl();
        if (remote.getVisibility() == View.VISIBLE) {
            closeRemote();
        } else if (url.endsWith("lan-host.html")) {
            // the host page asks "stop hosting?" itself; if hosting failed there is no such button, so just go back
            web.evaluateJavascript("(function(){var b=document.getElementById('hoststop')||document.getElementById('hostback');if(b){b.click();}else{location.href='lan.html';}})()", null);
        } else if (url.endsWith("lan.html")) {
            web.loadUrl(ASSETS + "index.html");
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        String url = web.getUrl();
        if (url != null && url.endsWith("index.html")) web.saveState(outState); // a hosted game cannot be restored
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (remote.getVisibility() == View.VISIBLE) remote.onResume(); else web.onResume();
    }

    @Override
    protected void onPause() {
        // while hosting, the game lives in this page: keep its JavaScript running as long as Android allows
        if (!host.isHosting()) web.onPause();
        remote.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        host.stop();
        discovery.close();
        web.destroy();
        remote.destroy();
        super.onDestroy();
    }
}
