package app.lumin.scan;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Sends a recording or a link to the same /scan endpoints the website uses and reads the answer. Runs on a worker
 * thread, never the main one. Only https addresses are used.
 */
final class ScanUploader {
    /** The server's answer, or a plain-language failure. */
    static final class Outcome {
        final boolean found;
        final String postId;
        final String message;

        Outcome(boolean found, String postId, String message) {
            this.found = found;
            this.postId = postId;
            this.message = message;
        }

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("found", found);
                o.put("video_post_id", postId == null ? JSONObject.NULL : postId);
                o.put("message", message == null ? JSONObject.NULL : message);
            } catch (Exception ignored) {
            }
            return o;
        }
    }

    private static final int CONNECT_MS = 15000;
    private static final int READ_MS = 60000;
    /** Matches the server's SCAN_MAX_CLIP_MB default; bigger files are refused before uploading. */
    static final long MAX_CLIP_BYTES = 30L * 1024 * 1024;

    private ScanUploader() {}

    private static HttpURLConnection open(Context c, String path) throws Exception {
        String base = ScanStore.apiBase(c);
        if (base == null || !base.startsWith("https://")) throw new IllegalStateException("Lumin isn't set up yet. Open the app once and try again.");
        HttpURLConnection conn = (HttpURLConnection) new URL(base.replaceAll("/+$", "") + path).openConnection();
        conn.setConnectTimeout(CONNECT_MS);
        conn.setReadTimeout(READ_MS);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        String token = ScanStore.token(c);
        if (token != null && !token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
        return conn;
    }

    static Outcome uploadClip(Context c, File clip) {
        if (clip.length() > MAX_CLIP_BYTES) {
            return new Outcome(false, null, "That video is too large to scan. Try a shorter clip (under 20 seconds).");
        }
        try {
            String boundary = "----lumin" + UUID.randomUUID().toString().replace("-", "");
            HttpURLConnection conn = open(c, "/scan/match");
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            conn.setChunkedStreamingMode(64 * 1024);
            try (OutputStream out = conn.getOutputStream()) {
                String head = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"clip\"; filename=\"clip.mp4\"\r\n"
                        + "Content-Type: video/mp4\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.UTF_8));
                try (InputStream in = new FileInputStream(clip)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            }
            return read(conn);
        } catch (IllegalStateException e) {
            return new Outcome(false, null, e.getMessage());
        } catch (Exception e) {
            return new Outcome(false, null, "We couldn't reach Lumin. Check your connection and try again.");
        }
    }

    static Outcome scanLink(Context c, String link) {
        try {
            HttpURLConnection conn = open(c, "/scan/link");
            conn.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONObject().put("url", link).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
            return read(conn);
        } catch (IllegalStateException e) {
            return new Outcome(false, null, e.getMessage());
        } catch (Exception e) {
            return new Outcome(false, null, "We couldn't reach Lumin. Check your connection and try again.");
        }
    }

    private static Outcome read(HttpURLConnection conn) throws Exception {
        int code = conn.getResponseCode();
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        StringBuilder sb = new StringBuilder();
        if (stream != null) {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
        }
        JSONObject json;
        try {
            json = new JSONObject(sb.toString());
        } catch (Exception e) {
            return new Outcome(false, null, "Something went wrong. Please try again.");
        }
        if (code >= 400) {
            String detail = json.optString("detail", "");
            if (code == 429) detail = "You're scanning very fast. Wait a moment and try again.";
            return new Outcome(false, null, detail.isEmpty() ? "Something went wrong. Please try again." : detail);
        }
        boolean found = json.optBoolean("found", false);
        String id = json.isNull("video_post_id") ? null : json.optString("video_post_id", null);
        String message = json.isNull("message") ? null : json.optString("message", null);
        return new Outcome(found && id != null, id, message);
    }
}
