package app.lumin.scan;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;

/**
 * Invisible screen that asks Android for permission to capture the screen (the system shows its own prompt every
 * time) and, if granted, starts the capture service. Also asks once for the microphone so the clip has sound.
 */
public class ScanPermissionActivity extends Activity {
    private static final int REQ_MIC = 11;
    private static final int REQ_CAPTURE = 12;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        } else {
            askCapture();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        // Sound is optional: without the microphone the scan still tries to match on pictures alone.
        askCapture();
    }

    private void askCapture() {
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE);
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_CAPTURE && result == RESULT_OK && data != null) {
            Intent svc = new Intent(this, ScanCaptureService.class);
            svc.putExtra("resultCode", result);
            svc.putExtra("data", data);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc);
            else startService(svc);
        }
        finish();
    }
}
