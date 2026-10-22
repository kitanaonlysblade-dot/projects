package app.lumin.scan;

import android.app.StatusBarManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.concurrent.Executor;

/**
 * Bridge between the Lumin website (running in the app's web view) and the native scan features.
 *
 *   configure({apiBase, token})   website -> native: where to upload and who the person is (call after sign-in)
 *   consumePending()              website <- native: the latest scan result / open-this-path, once
 *   requestAddTile()              Android 13+: ask the system to add the "Scan with Lumin" quick-settings tile
 *   event "scanResult"            native -> website: {working} | {found, video_post_id, message}
 */
@CapacitorPlugin(name = "LuminScan")
public class LuminScanPlugin extends Plugin {
    private static LuminScanPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
    }

    /** Called from native code; a no-op while the website is not loaded. */
    static void emit(JSONObject json) {
        LuminScanPlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("scanResult", new JSObject(json.toString()));
        } catch (Exception ignored) {
        }
    }

    /** Called from MainActivity when a notification was tapped: open this path in the website. */
    public static void openPath(android.content.Context c, Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra(ScanResults.EXTRA_PATH);
        if (path == null || !path.startsWith("/") || path.startsWith("//")) return;
        intent.removeExtra(ScanResults.EXTRA_PATH);
        try {
            JSONObject o = new JSONObject().put("found", true).put("open_path", path);
            ScanStore.setPending(c, o.toString());
            emit(o);
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String apiBase = call.getString("apiBase", "");
        if (apiBase == null || !apiBase.startsWith("https://")) {
            call.reject("apiBase must be an https address");
            return;
        }
        ScanStore.saveConfig(getContext(), apiBase, call.getString("token", ""));
        call.resolve();
    }

    @PluginMethod
    public void consumePending(PluginCall call) {
        String pending = ScanStore.takePending(getContext());
        JSObject ret = new JSObject();
        try {
            if (pending != null) ret = new JSObject(pending);
        } catch (Exception ignored) {
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestAddTile(final PluginCall call) {
        final JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < 33) {
            ret.put("supported", false);
            call.resolve(ret);
            return;
        }
        try {
            StatusBarManager sbm = getContext().getSystemService(StatusBarManager.class);
            ComponentName tile = new ComponentName(getContext(), ScanTileService.class);
            Executor direct = new Executor() {
                @Override
                public void execute(Runnable r) {
                    r.run();
                }
            };
            sbm.requestAddTileService(tile, "Scan with Lumin",
                    Icon.createWithResource(getContext(), getContext().getResources().getIdentifier("ic_scan_tile", "drawable", getContext().getPackageName())),
                    direct, new java.util.function.Consumer<Integer>() {
                        @Override
                        public void accept(Integer result) {
                            ret.put("supported", true);
                            ret.put("result", result);
                            call.resolve(ret);
                        }
                    });
        } catch (Exception e) {
            ret.put("supported", false);
            call.resolve(ret);
        }
    }
}
