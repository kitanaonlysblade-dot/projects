package app.lumin.scan;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Android's share sheet -> Lumin: a shared video file is copied to the app's cache and scanned; a shared link (or
 * text containing one) is scanned as a link. The result goes to the website through ScanResults.
 */
public final class ShareHandler {
    private static final Pattern URL = Pattern.compile("https?://\\S+", Pattern.CASE_INSENSITIVE);
    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();

    private ShareHandler() {}

    /** Returns true when the intent was a share we took (the caller need do nothing more). */
    public static boolean handle(final Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        final Context app = context.getApplicationContext();
        String type = intent.getType() == null ? "" : intent.getType();
        Uri stream = null;
        if (Build.VERSION.SDK_INT >= 33) stream = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        else stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        final String text = intent.getStringExtra(Intent.EXTRA_TEXT);

        if (stream != null && type.startsWith("video/")) {
            final Uri uri = stream;
            ScanResults.working(app);
            POOL.execute(new Runnable() {
                @Override
                public void run() {
                    File copy = null;
                    try {
                        copy = copyToCache(app, uri);
                        ScanResults.finished(app, ScanUploader.uploadClip(app, copy), false);
                    } catch (Exception e) {
                        ScanResults.finished(app, new ScanUploader.Outcome(false, null, "We couldn't read that video. Try screen-recording it instead."), false);
                    } finally {
                        if (copy != null) copy.delete();
                    }
                }
            });
            return true;
        }
        if (text != null) {
            Matcher m = URL.matcher(text);
            if (m.find()) {
                final String link = m.group();
                ScanResults.working(app);
                POOL.execute(new Runnable() {
                    @Override
                    public void run() {
                        ScanResults.finished(app, ScanUploader.scanLink(app, link), false);
                    }
                });
                return true;
            }
        }
        ScanResults.finished(app, new ScanUploader.Outcome(false, null, "Nothing to scan was shared. Share a video or a video link to Lumin."), false);
        return true;
    }

    private static File copyToCache(Context c, Uri uri) throws Exception {
        File out = new File(c.getCacheDir(), "shared-" + System.currentTimeMillis() + ".mp4");
        long total = 0;
        try (InputStream in = c.getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IllegalStateException("no stream");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                // Stop copying a huge file: it would be refused as too large anyway.
                if (total > ScanUploader.MAX_CLIP_BYTES + 1) break;
                os.write(buf, 0, n);
            }
        }
        return out;
    }
}
