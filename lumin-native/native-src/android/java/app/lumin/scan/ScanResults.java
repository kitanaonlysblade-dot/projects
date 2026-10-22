package app.lumin.scan;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

/** Hands a scan result to the website (when the app is open) and, for background scans, to a notification. */
final class ScanResults {
    static final String CHANNEL = "lumin_scan";
    static final String EXTRA_PATH = "lumin_path";
    private static final int NOTIFICATION_ID = 7301;

    private ScanResults() {}

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Scan results", NotificationManager.IMPORTANCE_DEFAULT));
            }
        }
    }

    /** "Looking…" state, shown by the website as a banner. */
    static void working(Context c) {
        deliver(c, workingJson(), false);
    }

    static void finished(Context c, ScanUploader.Outcome o, boolean notify) {
        JSONObject json = o.toJson();
        deliver(c, json, notify);
        if (notify) notifyResult(c, o);
    }

    private static JSONObject workingJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("working", true);
        } catch (Exception ignored) {
        }
        return o;
    }

    private static void deliver(Context c, JSONObject json, boolean persist) {
        // Keep the latest result so the website can pick it up whenever it is next on screen, and tell it now if it is.
        ScanStore.setPending(c, json.toString());
        LuminScanPlugin.emit(json);
    }

    private static void notifyResult(Context c, ScanUploader.Outcome o) {
        ensureChannel(c);
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open == null) return;
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (o.found) open.putExtra(EXTRA_PATH, "/v/" + o.postId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(c, 0, open, flags);
        String title = o.found ? "Found it on Lumin" : "Not found on Lumin";
        String text = o.found ? "Tap to see the video and its products." : (o.message != null ? o.message : "We couldn't find this on Lumin.");
        Notification n = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(c.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(NOTIFICATION_ID, n);
            } catch (SecurityException ignored) {
                // Notifications not allowed: the result still waits for the app (ScanStore pending).
            }
        }
    }
}
