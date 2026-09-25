package com.aditya.schoolchat;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "CatboxUploader")
public class CatboxUploaderPlugin extends Plugin {
    private static final String API_URL = "https://catbox.moe/user/api.php";
    private static final int MAX_BYTES = 15 * 1024 * 1024;
    private static final int CHUNK_BYTES = 64 * 1024;
    private final ExecutorService executor = Executors.newFixedThreadPool(3);

    @PluginMethod
    public void upload(PluginCall call) {
        final String base64 = call.getString("fileBase64", "");
        final String fileName = sanitizeFileName(call.getString("fileName", "upload.bin"));
        final String mimeType = sanitizeMime(call.getString("mimeType", "application/octet-stream"));

        if (base64.isEmpty()) {
            call.reject("No file data was provided.");
            return;
        }

        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                String clean = base64;
                int comma = clean.indexOf(',');
                if (comma >= 0) clean = clean.substring(comma + 1);
                byte[] bytes = Base64.decode(clean, Base64.DEFAULT);
                if (bytes.length == 0) throw new IllegalArgumentException("The selected file is empty.");
                if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("Files must be 15 MB or smaller.");

                String boundary = "----SchoolChat" + System.currentTimeMillis();
                byte[] head = (
                        "--" + boundary + "\r\n"
                        + "Content-Disposition: form-data; name=\"reqtype\"\r\n\r\n"
                        + "fileupload\r\n"
                        + "--" + boundary + "\r\n"
                        + "Content-Disposition: form-data; name=\"fileToUpload\"; filename=\"" + fileName + "\"\r\n"
                        + "Content-Type: " + mimeType + "\r\n\r\n"
                ).getBytes(StandardCharsets.UTF_8);
                byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
                final long totalLength = (long) head.length + bytes.length + tail.length;

                URL url = new URL(API_URL);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(120_000);
                connection.setUseCaches(false);
                // Stream straight onto the socket instead of letting
                // HttpURLConnection buffer the whole 15 MB body in memory first.
                connection.setFixedLengthStreamingMode(totalLength);
                connection.setRequestProperty("User-Agent", "SchoolChat/1.5.0");
                connection.setRequestProperty("Connection", "keep-alive");
                connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

                try (OutputStream raw = connection.getOutputStream();
                     BufferedOutputStream out = new BufferedOutputStream(raw, CHUNK_BYTES)) {
                    out.write(head);
                    int offset = 0;
                    long lastReport = 0;
                    while (offset < bytes.length) {
                        int count = Math.min(CHUNK_BYTES, bytes.length - offset);
                        out.write(bytes, offset, count);
                        offset += count;
                        long now = System.currentTimeMillis();
                        if (now - lastReport > 120 || offset == bytes.length) {
                            lastReport = now;
                            JSObject progress = new JSObject();
                            progress.put("sent", offset);
                            progress.put("total", bytes.length);
                            notifyListeners("uploadProgress", progress);
                        }
                    }
                    out.write(tail);
                    out.flush();
                }

                int responseCode = connection.getResponseCode();
                InputStream source = responseCode >= 200 && responseCode < 300
                        ? connection.getInputStream() : connection.getErrorStream();
                String response = readAll(source).trim();
                if (responseCode < 200 || responseCode >= 300) {
                    throw new IllegalStateException("Catbox upload failed (HTTP " + responseCode + ").");
                }
                if (!response.startsWith("https://files.catbox.moe/")) {
                    throw new IllegalStateException(response.isEmpty() ? "Catbox returned an invalid response." : response);
                }

                JSObject result = new JSObject();
                result.put("url", response);
                result.put("size", bytes.length);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "File upload failed." : e.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    // Downloads a Catbox file and hands the bytes back as base64. Used to fetch
    // locked (encrypted) attachments so they can be decrypted on-device --
    // avoids the browser's CORS restrictions a plain fetch() would hit.
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        if (url.isEmpty() || !url.startsWith("https://files.catbox.moe/")) {
            call.reject("Invalid file link.");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(120_000);
                int code = connection.getResponseCode();
                if (code != 200) {
                    call.reject("Download failed (HTTP " + code + ").");
                    return;
                }
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                try (BufferedInputStream in = new BufferedInputStream(connection.getInputStream())) {
                    byte[] chunk = new byte[CHUNK_BYTES];
                    int read;
                    while ((read = in.read(chunk)) != -1) {
                        buffer.write(chunk, 0, read);
                        if (buffer.size() > MAX_BYTES) {
                            call.reject("File is larger than 15 MB.");
                            return;
                        }
                    }
                }
                JSObject result = new JSObject();
                result.put("data", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Download error: " + e.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private static void writeText(OutputStream out, String value) throws Exception {
        out.write(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String readAll(InputStream input) throws Exception {
        if (input == null) return "";
        try (BufferedInputStream in = new BufferedInputStream(input);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String sanitizeFileName(String input) {
        String name = input == null || input.trim().isEmpty() ? "upload.bin" : input.trim();
        name = name.replace('\\', '_').replace('/', '_').replace('"', '_').replace('\r', '_').replace('\n', '_');
        return name.length() > 180 ? name.substring(0, 180) : name;
    }

    private static String sanitizeMime(String input) {
        if (input == null || input.trim().isEmpty()) return "application/octet-stream";
        return input.replace("\r", "").replace("\n", "").trim();
    }
}
