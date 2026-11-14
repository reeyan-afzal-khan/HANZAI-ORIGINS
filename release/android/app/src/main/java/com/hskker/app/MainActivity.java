package com.hskker.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
    /* An Android WebView says navigator.onLine is true for ever — through
       airplane mode and a dead connection alike — unless the app tells it
       otherwise. The reader's translation goes by it — with no connection it
       says so at once rather than waiting on Google Translate — so the
       connection is watched here and passed on: the page sees navigator.onLine
       change and gets its online and offline events, as a browser's page does. */
    private ConnectivityManager.NetworkCallback netWatch;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge starts, so the page finds it on load.
        registerPlugin(EdgeGuardPlugin.class);
        super.onCreate(savedInstanceState);
        watchNetwork();
        dropOfflineTranslator();
    }

    /* Earlier versions could install an offline translator, about 135 MB,
       into the app's own storage. Passages are translated by Google Translate
       alone now, so whatever was installed is deleted, off the main thread. */
    private void dropOfflineTranslator() {
        final File home = new File(getFilesDir(), "translation");
        if (!home.exists()) return;
        new Thread(() -> delete(home), "drop-offline-translator").start();
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    @Override
    public void onDestroy() {
        if (netWatch != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            try { if (cm != null) cm.unregisterNetworkCallback(netWatch); } catch (RuntimeException ignored) {}
            netWatch = null;
        }
        super.onDestroy();
    }

    /* Android 7 and later: the default network, as it comes and goes. (Older
       ones keep the WebView's own answer, and the page finds out when Google
       cannot be reached.) */
    private void watchNetwork() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        final ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        tellPage(online(cm));
        netWatch = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { pass(cm); }
            @Override public void onLost(Network n) { pass(cm); }
            @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { pass(cm); }
        };
        try { cm.registerDefaultNetworkCallback(netWatch); } catch (RuntimeException e) { netWatch = null; }
    }

    /* A network that says it reaches the internet. Not "validated": a check
       that fails behind some firewalls would call a working connection dead,
       and a connection that only says so is caught anyway — Google not
       answering is reported on the reader's card. */
    private boolean online(ConnectivityManager cm) {
        Network n = cm.getActiveNetwork();
        if (n == null) return false;
        NetworkCapabilities c = cm.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void pass(final ConnectivityManager cm) {
        runOnUiThread(() -> tellPage(online(cm)));
    }

    private void tellPage(boolean on) {
        if (getBridge() == null) return;
        WebView web = getBridge().getWebView();
        if (web != null) web.setNetworkAvailable(on);
    }
}
