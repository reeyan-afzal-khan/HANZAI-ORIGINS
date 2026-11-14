package com.hskker.app;

import android.graphics.Rect;
import android.os.Build;
import android.view.View;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Keeps the system's back gesture off the page corners while a book is open.
 *
 * With gesture navigation, a swipe that starts within the outer few dp of
 * either screen edge is the system's, not the app's: the WebView is handed a
 * pointercancel and the page snaps back. A page corner is exactly where a
 * reader takes hold of a page, and on a phone the corner is at the edge of
 * the screen. Android 10 lets a view ask for regions to be left alone, so
 * while the reader is up the bottom corner of each edge — the corner most
 * often taken — is asked for. The system honours at most 200dp of exclusion
 * per edge, counted from the bottom, which is why it is the bottom corners
 * and why the band is that tall. Off again when the reader closes, so the
 * back gesture behaves normally everywhere else.
 */
@CapacitorPlugin(name = "EdgeGuard")
public class EdgeGuardPlugin extends Plugin {

    private boolean on = false;
    private final View.OnLayoutChangeListener relayout =
        (v, l, t, r, b, ol, ot, or, ob) -> apply();

    @Override
    public void load() {
        View web = getBridge().getWebView();
        if (web != null) web.addOnLayoutChangeListener(relayout);
    }

    @PluginMethod
    public void set(PluginCall call) {
        on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(this::apply);
        call.resolve();
    }

    private void apply() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        View web = getBridge().getWebView();
        if (web == null) return;
        List<Rect> rects = new ArrayList<>();
        if (on) {
            float d = web.getResources().getDisplayMetrics().density;
            int w = web.getWidth(), h = web.getHeight();
            int band = Math.round(200 * d), edge = Math.round(48 * d);
            rects.add(new Rect(0, Math.max(0, h - band), edge, h));
            rects.add(new Rect(Math.max(0, w - edge), Math.max(0, h - band), w, h));
        }
        web.setSystemGestureExclusionRects(rects);
    }
}
