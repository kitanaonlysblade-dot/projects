package app.lumin.scan;

import android.content.Context;
import android.content.SharedPreferences;

/** Small private store shared by the plugin, the share handler and the capture service. */
final class ScanStore {
    private static final String FILE = "lumin_scan";

    private ScanStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** The website calls this (via the plugin) after sign-in so native code can upload scans as that person. */
    static void saveConfig(Context c, String apiBase, String token) {
        prefs(c).edit().putString("apiBase", apiBase).putString("token", token == null ? "" : token).apply();
    }

    static String apiBase(Context c) {
        return prefs(c).getString("apiBase", "");
    }

    static String token(Context c) {
        return prefs(c).getString("token", "");
    }

    /** One result waiting for the website to pick up (JSON text), or null. */
    static void setPending(Context c, String json) {
        prefs(c).edit().putString("pending", json).apply();
    }

    static String takePending(Context c) {
        String v = prefs(c).getString("pending", null);
        if (v != null) prefs(c).edit().remove("pending").apply();
        return v;
    }
}
