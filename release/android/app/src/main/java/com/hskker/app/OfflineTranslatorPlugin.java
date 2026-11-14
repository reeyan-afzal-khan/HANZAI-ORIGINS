package com.hskker.app;

import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * The reader's offline translator ("Compact"), installed on request.
 *
 * At 135 MB it is too much to carry in every APK, so the APK leaves it out
 * and this puts it where the app reads it from: the app's own storage on the
 * device (files/translation/, private to the app, counted in its storage in
 * Android's settings, removed with the app). The page hands over the list of
 * files — where each comes from, its size and its SHA-256
 * (app/data/translation-files.js) — and this fetches them one by one off the
 * page's thread, telling it how far it has got. Each is written beside its
 * final name and moved into place only once its size and checksum are right,
 * so a file under its own name is always a whole one, and a download cut off
 * picks up at the first file not yet there. The page then reads the files
 * through the bridge's file address (Capacitor.convertFileSrc).
 */
@CapacitorPlugin(name = "OfflineTranslator")
public class OfflineTranslatorPlugin extends Plugin {

    private volatile boolean busy = false;

    private File home() {
        return new File(getContext().getFilesDir(), "translation");
    }

    /** Which of the listed files are here, whole; and where they live. */
    @PluginMethod
    public void status(PluginCall call) {
        JSArray files = call.getArray("files");
        if (files == null) { call.reject("no file list"); return; }
        long have = 0, total = 0;
        int missing = 0;
        try {
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                long bytes = f.getLong("bytes");
                total += bytes;
                File file = new File(home(), f.getString("path"));
                if (file.isFile() && file.length() == bytes) have += bytes; else missing++;
            }
        } catch (JSONException e) {
            call.reject("the file list is not readable");
            return;
        }
        JSObject out = new JSObject();
        out.put("installed", missing == 0);
        out.put("have", have);
        out.put("total", total);
        out.put("busy", busy);
        out.put("base", Uri.fromFile(home()).toString());
        call.resolve(out);
    }

    /** Fetches whatever of the list is not here yet. Progress comes as
     *  "progress" events: {done, total} in bytes. */
    @PluginMethod
    public void install(final PluginCall call) {
        final JSArray files = call.getArray("files");
        if (files == null) { call.reject("no file list"); return; }
        if (busy) { call.reject("Compact is already being installed"); return; }
        busy = true;
        new Thread(() -> {
            try {
                long total = 0;
                for (int i = 0; i < files.length(); i++) total += files.getJSONObject(i).getLong("bytes");
                long done = 0;
                for (int i = 0; i < files.length(); i++) {
                    JSONObject f = files.getJSONObject(i);
                    long bytes = f.getLong("bytes");
                    File out = new File(home(), f.getString("path"));
                    if (out.isFile() && out.length() == bytes) { done += bytes; tell(done, total); continue; }
                    fetch(f.getString("url"), out, bytes, f.getString("sha"), done, total);
                    done += bytes;
                    tell(done, total);
                }
                JSObject res = new JSObject();
                res.put("base", Uri.fromFile(home()).toString());
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                busy = false;
            }
        }, "offline-translator-install").start();
    }

    /** Removes the translator, and its space with it. */
    @PluginMethod
    public void remove(PluginCall call) {
        if (busy) { call.reject("Compact is being installed"); return; }
        delete(home());
        call.resolve();
    }

    private void fetch(String url, File out, long bytes, String sha, long before, long total) throws Exception {
        File dir = out.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot write to the app's storage");
        File part = new File(out.getPath() + ".part");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        try {
            int code = c.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) throw new IOException(out.getName() + " could not be fetched (" + code + ")");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long got = 0, told = 0;
            try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream os = new FileOutputStream(part)) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    md.update(buf, 0, n);
                    got += n;
                    long now = System.currentTimeMillis();
                    if (now - told > 250) { told = now; tell(before + got, total); }
                }
            }
            if (got != bytes) { part.delete(); throw new IOException(out.getName() + " arrived incomplete"); }
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equals(sha)) { part.delete(); throw new IOException(out.getName() + " arrived damaged"); }
            if (out.exists() && !out.delete()) throw new IOException("cannot replace " + out.getName());
            if (!part.renameTo(out)) throw new IOException("cannot store " + out.getName());
        } finally {
            c.disconnect();
        }
    }

    private void tell(long done, long total) {
        JSObject e = new JSObject();
        e.put("done", done);
        e.put("total", total);
        notifyListeners("progress", e);
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        f.delete();
    }
}
