package com.aditya.schoolchat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Persistent per-install media cache.
 *
 * Files are stored under the app's internal files directory, so they survive
 * process death/app restarts and are not world-readable. Only HTTPS Catbox
 * media URLs are accepted; this prevents a chat message from turning the
 * plugin into a general-purpose HTTP/localhost downloader.
 */
@CapacitorPlugin(name = "MediaCache")
public class MediaCachePlugin extends Plugin {
    private static final String HOST = "files.catbox.moe";
    private static final long MAX_BYTES = 15L * 1024L * 1024L;
    private static final int BUFFER = 32 * 1024;

    private File cacheDir() {
        File dir = new File(getContext().getFilesDir(), "school-chat-media-v1");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Media cache directory could not be created.");
        return dir;
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (key.isEmpty()) {
            call.reject("Media cache key is missing.");
            return;
        }
        File target = new File(cacheDir(), digest(key));
        JSObject result = new JSObject();
        result.put("exists", target.isFile() && target.length() > 0);
        if (target.isFile() && target.length() > 0) result.put("path", target.getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void cache(PluginCall call) {
        String source = call.getString("url", "").trim();
        String key = call.getString("key", "").trim();
        if (!isAllowedUrl(source)) {
            call.reject("Only HTTPS Catbox media URLs can be cached.");
            return;
        }
        if (key.isEmpty()) {
            call.reject("Media cache key is missing.");
            return;
        }

        HttpURLConnection connection = null;
        File temp = null;
        try {
            File target = new File(cacheDir(), digest(key));
            if (target.isFile() && target.length() > 0) {
                resolvePath(call, target);
                return;
            }

            URL url = new URL(source);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);
            connection.setUseCaches(true);
            connection.setRequestProperty("User-Agent", "SchoolChat/1.6.3");
            connection.connect();

            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("Media download failed (HTTP " + code + ").");
            long declared = connection.getContentLengthLong();
            if (declared > MAX_BYTES) throw new IOException("Media is larger than 15 MB.");

            temp = new File(cacheDir(), digest(key) + ".part");
            long total = 0;
            try (InputStream raw = new BufferedInputStream(connection.getInputStream(), BUFFER);
                 BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(temp), BUFFER)) {
                byte[] buffer = new byte[BUFFER];
                int n;
                while ((n = raw.read(buffer)) != -1) {
                    total += n;
                    if (total > MAX_BYTES) throw new IOException("Media is larger than 15 MB.");
                    out.write(buffer, 0, n);
                }
            }
            if (total <= 0) throw new IOException("Downloaded media is empty.");
            if (!temp.renameTo(target)) {
                try (FileInputStream in = new FileInputStream(temp);
                     FileOutputStream out = new FileOutputStream(target)) {
                    byte[] buffer = new byte[BUFFER];
                    int n;
                    while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                }
                if (!temp.delete()) temp = null;
            }
            if (temp != null && temp.exists()) temp.delete();
            resolvePath(call, target);
        } catch (Exception e) {
            if (temp != null && temp.exists()) temp.delete();
            call.reject(e.getMessage() == null ? "Media could not be cached." : e.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (key.isEmpty()) { call.resolve(); return; }
        File target = new File(cacheDir(), digest(key));
        File part = new File(cacheDir(), digest(key) + ".part");
        target.delete();
        part.delete();
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        File dir = cacheDir();
        File[] files = dir.listFiles();
        if (files != null) for (File file : files) if (file.isFile()) file.delete();
        call.resolve();
    }

    private void resolvePath(PluginCall call, File file) {
        JSObject result = new JSObject();
        result.put("exists", true);
        result.put("path", file.getAbsolutePath());
        call.resolve(result);
    }

    private static boolean isAllowedUrl(String raw) {
        try {
            URL url = new URL(raw);
            return "https".equalsIgnoreCase(url.getProtocol()) && HOST.equalsIgnoreCase(url.getHost());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String digest(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) out.append(String.format(Locale.US, "%02x", b & 0xff));
            return out.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Cache hashing is unavailable.", e);
        }
    }
}
