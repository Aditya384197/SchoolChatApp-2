package com.aditya.schoolchat;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import java.io.BufferedInputStream;
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
    private final ExecutorService executor = Executors.newFixedThreadPool(2);

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
                URL url = new URL(API_URL);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(90_000);
                connection.setUseCaches(false);
                connection.setRequestProperty("User-Agent", "SchoolChat/1.5.0");
                connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

                try (OutputStream out = connection.getOutputStream()) {
                    writeText(out, "--" + boundary + "\r\n");
                    writeText(out, "Content-Disposition: form-data; name=\"reqtype\"\r\n\r\n");
                    writeText(out, "fileupload\r\n");
                    writeText(out, "--" + boundary + "\r\n");
                    writeText(out, "Content-Disposition: form-data; name=\"fileToUpload\"; filename=\"" + fileName + "\"\r\n");
                    writeText(out, "Content-Type: " + mimeType + "\r\n\r\n");
                    out.write(bytes);
                    writeText(out, "\r\n--" + boundary + "--\r\n");
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
        name = name.replace('\\', '_').replace('/', '_').replace('\r', '_').replace('\n', '_');
        return name.length() > 180 ? name.substring(0, 180) : name;
    }

    private static String sanitizeMime(String input) {
        if (input == null || input.trim().isEmpty()) return "application/octet-stream";
        return input.replace("\r", "").replace("\n", "").trim();
    }
}
