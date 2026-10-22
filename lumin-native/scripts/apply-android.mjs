// Adds Lumin's native scan features to the Android project that `npx cap add android` generated.
// Safe to run again. Usage (from lumin-native/):  node scripts/apply-android.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'android');
const src = path.join(root, 'native-src', 'android');
const main = path.join(target, 'app', 'src', 'main');
const PKG_DIR = path.join('java', 'app', 'lumin', 'scan');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
if (!fs.existsSync(path.join(main, 'AndroidManifest.xml'))) fail(`No Android project at ${target}. Run "npx cap add android" first.`);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f), b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
copyDir(path.join(src, PKG_DIR), path.join(main, PKG_DIR));
copyDir(path.join(src, 'res'), path.join(main, 'res'));

// ---- manifest ----
const mfPath = path.join(main, 'AndroidManifest.xml');
let mf = fs.readFileSync(mfPath, 'utf8');
const perms = [
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA', // the live test and the buyer's claim video are recorded inside the app's own camera view
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.POST_NOTIFICATIONS',
];
for (const p of perms) {
  if (!mf.includes(`android:name="${p}"`)) mf = mf.replace('<application', `<uses-permission android:name="${p}" />\n    <application`);
}
const shareFilter = `
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="video/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;
if (!mf.includes('android.intent.action.SEND')) {
  // Put the share filters inside the MainActivity element.
  const i = mf.indexOf('</activity>');
  if (i < 0) fail('Could not find <activity> in AndroidManifest.xml');
  mf = mf.slice(0, i) + shareFilter + '\n        ' + mf.slice(i);
}
const components = `
        <activity android:name="app.lumin.scan.ScanPermissionActivity" android:exported="false"
            android:excludeFromRecents="true" android:taskAffinity="" android:theme="@android:style/Theme.Translucent.NoTitleBar" />
        <service android:name="app.lumin.scan.ScanCaptureService" android:exported="false"
            android:foregroundServiceType="mediaProjection" />
        <service android:name="app.lumin.scan.ScanTileService" android:exported="true"
            android:icon="@drawable/ic_scan_tile" android:label="Scan with Lumin"
            android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter>
                <action android:name="android.service.quicksettings.action.QS_TILE" />
            </intent-filter>
        </service>
`;
if (!mf.includes('app.lumin.scan.ScanTileService')) mf = mf.replace('</application>', components + '    </application>');
fs.writeFileSync(mfPath, mf);

// ---- MainActivity ----
function findMain(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { const r = findMain(p); if (r) return r; }
    else if (f === 'MainActivity.java') return p;
  }
}
const mainPath = findMain(path.join(main, 'java'));
if (!mainPath) fail('MainActivity.java not found.');
let act = fs.readFileSync(mainPath, 'utf8');
if (!act.includes('LuminScanPlugin')) {
  act = act.replace(/public class MainActivity extends BridgeActivity\s*\{\s*\}/, `public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(app.lumin.scan.LuminScanPlugin.class);
        super.onCreate(savedInstanceState);
        route(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        route(intent);
    }

    // Share-sheet shares and result-notification taps arrive here.
    private void route(android.content.Intent intent) {
        if (!app.lumin.scan.ShareHandler.handle(this, intent)) {
            app.lumin.scan.LuminScanPlugin.openPath(this, intent);
        }
    }
}`);
  if (!act.includes('LuminScanPlugin')) fail('MainActivity has an unexpected shape. Add the plugin by hand (see NATIVE.md).');
  fs.writeFileSync(mainPath, act);
}
console.log('✓ Android scan features applied (share, quick-settings tile, capture).');
