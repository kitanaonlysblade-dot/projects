package app.lumin.scan;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;

import androidx.core.app.NotificationCompat;

import java.io.File;

/**
 * Records about eight seconds of the screen (and, if allowed, the microphone, which hears the speaker) and sends it
 * to the matcher. Android requires a visible "recording" notification while this runs.
 *
 * Limits: protected (DRM) video such as some streaming apps shows black; the microphone hears the speaker, not the
 * app's sound directly, so noisy rooms and headphones reduce matching.
 */
public class ScanCaptureService extends Service {
    private static final int FG_ID = 7302;
    private static final long RECORD_MS = 8000;

    private MediaProjection projection;
    private VirtualDisplay display;
    private MediaRecorder recorder;
    private File out;
    private boolean running;

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (running || intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        ScanResults.ensureChannel(this);
        Notification n = new NotificationCompat.Builder(this, ScanResults.CHANNEL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("Scanning with Lumin")
                .setContentText("Listening for a few seconds…")
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(FG_ID, n);

        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            Intent data = intent.getParcelableExtra("data");
            projection = mpm.getMediaProjection(intent.getIntExtra("resultCode", 0), data);
            // Android 14 requires a callback to be registered before capturing.
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    finishRecording(false);
                }
            }, new Handler(Looper.getMainLooper()));
            startRecording();
        } catch (Exception e) {
            fail("We couldn't start the scan. Please try again.");
            return START_NOT_STICKY;
        }
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                finishRecording(true);
            }
        }, RECORD_MS);
        return START_NOT_STICKY;
    }

    private void startRecording() throws Exception {
        DisplayMetrics m = getResources().getDisplayMetrics();
        // Half size keeps the clip small; the matcher does not need full resolution.
        int w = Math.max(2, (m.widthPixels / 2) & ~1);
        int h = Math.max(2, (m.heightPixels / 2) & ~1);
        out = new File(getCacheDir(), "scan-" + System.currentTimeMillis() + ".mp4");
        recorder = new MediaRecorder();
        boolean mic = checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (mic) recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
        if (mic) {
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(44100);
            recorder.setAudioEncodingBitRate(96000);
        }
        recorder.setVideoSize(w, h);
        recorder.setVideoFrameRate(24);
        recorder.setVideoEncodingBitRate(1_500_000);
        recorder.setOutputFile(out.getAbsolutePath());
        recorder.prepare();
        display = projection.createVirtualDisplay("lumin-scan", w, h, m.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, recorder.getSurface(), null, null);
        recorder.start();
    }

    private synchronized void finishRecording(boolean upload) {
        if (!running) return;
        running = false;
        boolean ok = false;
        try {
            if (recorder != null) {
                recorder.stop();
                ok = true;
            }
        } catch (Exception ignored) {
            // Stopping too early leaves an unusable file.
        }
        try {
            if (recorder != null) recorder.release();
        } catch (Exception ignored) {
        }
        if (display != null) display.release();
        if (projection != null) projection.stop();
        recorder = null;
        display = null;
        projection = null;
        stopForeground(true);
        final File clip = out;
        final Context app = getApplicationContext();
        if (!(upload && ok && clip != null && clip.exists())) {
            if (clip != null) clip.delete();
            stopSelf();
            return;
        }
        ScanResults.working(app);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    ScanResults.finished(app, ScanUploader.uploadClip(app, clip), true);
                } finally {
                    clip.delete();
                }
            }
        }).start();
        stopSelf();
    }

    private void fail(String message) {
        running = false;
        stopForeground(true);
        ScanResults.finished(getApplicationContext(), new ScanUploader.Outcome(false, null, message), true);
        stopSelf();
    }
}
