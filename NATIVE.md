# Lumin as an Android and iPhone app (Capacitor)

`lumin-native/` wraps the deployed website in a native shell. The app **is** your live website, so a website deploy updates
the app instantly (no store review for content changes). What the shell adds: an app icon and store listing, and **real push
notifications** (Firebase Cloud Messaging) that work with the app closed, on Android and iPhone.

> Honest status: this folder and the server/website code for native push are written and unit-tested, but nothing here could
> be run on a phone or built with Android Studio/Xcode in the environment it was written in. Expect a first day of
> device-testing and small fixes. Section 6 lists store-policy items that are NOT done and can block approval.

## 1. What you need
- An **Apple Developer** account (US$99/year) and a **Mac with Xcode** (iPhone build). A **Google Play** account (US$25 once) and **Android Studio** (Android build). Node 20.
- A **Firebase** project (free) for push. Your website and backend already deployed (see `DEPLOY.md`).
- Your own app id, reverse-domain style, e.g. `com.yourcompany.lumin`. It can never change after the first upload.
- Real icon (1024×1024 PNG) and splash artwork. The icons in `lumin-app/public/icons` are placeholders.

## 2. Build the shells
```bash
cd lumin-native
npm install
export LUMIN_URL=https://your-website-address     # no trailing slash
export LUMIN_APP_ID=com.yourcompany.lumin
npx cap add android
npx cap add ios          # Mac only
npx @capacitor/assets generate --iconBackgroundColor '#ffffff'   # after putting icon.png / splash.png in lumin-native/assets/
npx cap sync
```
Run `npx cap open android` / `npx cap open ios` to open the projects, press Run with a phone plugged in. The app should show
your live site. If it shows "You're offline", `LUMIN_URL` is wrong or the site is down.

## 3. Push notifications (Firebase)
1. Firebase console → create a project → **Add app → Android** with your app id → download `google-services.json` → put it in `lumin-native/android/app/`. Follow Firebase's two Gradle lines if `npx cap add android` did not add them (the `com.google.gms.google-services` plugin).
2. **Add app → iOS** with the same id → download `GoogleService-Info.plist` → drag into Xcode (`App` target).
3. iOS only: Apple Developer → Keys → create an **APNs Auth Key** (.p8) → upload it in Firebase → Project settings → Cloud Messaging. In Xcode → Signing & Capabilities → add **Push Notifications** and **Background Modes → Remote notifications**.
4. iOS only, `ios/App/Podfile`: add `pod 'FirebaseMessaging'` under the App target, run `pod install`, then in `ios/App/App/AppDelegate.swift` add `import FirebaseCore`, `import FirebaseMessaging`, `FirebaseApp.configure()` at the start of `didFinishLaunchingWithOptions`, and these two methods (this is the documented Capacitor + FCM bridge):
```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    Messaging.messaging().apnsToken = deviceToken
    Messaging.messaging().token(completion: { (token, error) in
        if let error = error {
            NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
        } else if let token = token {
            NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
        }
    })
}
func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}
```
5. Backend: Firebase → Project settings → Service accounts → **Generate new private key** (a .json file). Paste the **whole file contents** as the backend variable `FIREBASE_SERVICE_ACCOUNT_JSON` and redeploy. Check `GET /push/config` says `"native": true`.
6. On a phone: install the app, sign in, Settings → Notifications → turn on **Push notifications**, then trigger one (have someone follow you). Tapping it opens the right screen.
   (How it works: the website detects it is inside the app (`lib/native.ts`), asks the phone for permission, sends the phone's Firebase token to `POST /push/device`; the server sends through Firebase (`app/push.py`).)

## 4. Scan from other apps (share, quick-settings tile, screen capture)

**None of this has been run on a real phone yet. Treat it as a first draft to test and fix.**

What it does:
- **Android share**: in any app (TikTok, Instagram, Gallery…) tap Share → Lumin. A shared video file or link is sent to the matcher; the result opens as `/v/<id>` in the app or shows "not found".
- **Android quick-settings tile ("Scan with Lumin")**: swipe down, tap the tile, accept Android's screen-capture prompt; Lumin records ~8 seconds of the screen and microphone, uploads it and sends a notification with the result.
- **iPhone Share Extension**: same as Android share.
- **iPhone screen-recording extension**: pick "Scan with Lumin" in the screen-recording list; ~8 seconds of picture and app sound are scanned.

### Android setup (after `npx cap add android`, from `lumin-native/`)
1. `node scripts/apply-android.mjs` (copies the Java files, adds permissions, share filters, the tile and the capture service, and registers the plugin in `MainActivity`). Safe to re-run. Do this again after any `cap add`/`cap update` that regenerates the project.
2. `npx cap sync android`, open in Android Studio, run on a real phone (the emulator can't do screen capture well).
3. Sign in inside the app once. The website passes the API address and sign-in to the native side; without that, shares and the tile say "Open Lumin once…".
4. Add the tile: pull down quick settings → pencil/edit → drag "Scan with Lumin" in. (The website can also ask Android 13+ to add it: `LuminScan.requestAddTile()`.)
5. Google Play: a screen-capture app needs the foreground-service declaration (type "media projection") in the Play Console and a clear explanation that capture is started only by the person.

Known limits: protected (DRM) video, such as some streaming apps, records as black; on Android the sound comes from the microphone hearing the speaker (headphones or a noisy room hurt matching); a recording of 8 seconds is the default (`RECORD_MS` in `ScanCaptureService.java`).

### iPhone setup (needs a Mac and Xcode; written without a Mac, so expect to fix compile errors)
1. `npx cap add ios`, open `ios/App/App.xcworkspace`.
2. Add `native-src/ios/App/LuminScanPlugin.swift` to the App target.
3. File → New → Target → **Share Extension** ("LuminShare"): replace its files with `native-src/ios/ShareExtension/ShareViewController.swift`, `LuminShared.swift` and `Info.plist` (delete the storyboard and point the plist at `ShareViewController`).
4. File → New → Target → **Broadcast Upload Extension** ("LuminBroadcast", no setup UI): use `native-src/ios/BroadcastExtension/SampleHandler.swift` and `Info.plist`, and also add `LuminShared.swift` to this target.
5. For the App and both extensions: Signing & Capabilities → **App Groups** → the same id, e.g. `group.com.yourco.lumin`. Put that id in `LuminGroup` in `LuminScanPlugin.swift` and `LuminShared.swift`.
6. Apple is stricter: Share extensions must be useful on their own, and screen-recording extensions are reviewed closely. Explain the feature plainly in review notes.

On iPhone, results are picked up when you open Lumin (extensions can't open the app or show notifications on their own).

### On-device fingerprinting
Built for everything that runs in the app's web view or a browser: choosing a recording on the Scan card or `/scan`, a shared video on the Android installed-web-app share page, and "Scan live". The recording is fingerprinted on the device (sound + picture, `lumin-app/lib/fingerprint`) and only the fingerprint is sent to `POST /scan/match-features`: about 4 KB instead of a 300+ KB video, the video never leaves the device, and the server does no video decoding. If the device can't do it, the recording is uploaded as before. Turn it off with `NEXT_PUBLIC_ON_DEVICE_SCAN=false` (website variable, rebuild).

What it does not cover:
- **Native captures still upload.** The Android tile, the Android share intent and the iPhone extensions run outside the web view (often with the app closed), so they send the recording as before. Making them fingerprint on-device means porting the same maths to Kotlin and Swift; the TypeScript code and `tests/fixtures/fingerprint.json` are the reference to match.
- **The last check is server-only.** The matcher's final stage (local features, which survives crops and overlays) isn't computed on the device. When the fingerprint finds nothing, the app sends the recording automatically for the full check, so a clip is only ever uploaded when the fingerprint alone found nothing.
- **Browsers decode a little differently from ffmpeg** (sound resampling, colour conversion), so a fingerprint is close to, not identical to, the server's own. In a real-Chromium test on synthetic videos every case matched correctly (see below), but that says nothing about real screen recordings: test on your own.

Keeping it honest: `lumin-backend/scripts/make_fingerprint_fixtures.py` writes the numbers the Python matcher produces; `tests/fingerprint.test.ts` fails if the TypeScript drifts from them. If you change the fingerprint maths in `scan_fp.py`, bump `WIRE_ALGO` (scan_fp.py and `lib/fingerprint/wire.ts`), regenerate the fixtures and fix the TypeScript. To re-run the real-browser check (needs ffmpeg, OpenCV, esbuild and playwright): `python scripts/ondevice_e2e/check_in_browser.py /tmp/e2e` from `lumin-backend`.

## 5. Sign in with Apple

Apple requires this in the iPhone app because the app offers Google sign-in. **Untested with real Apple credentials.**

1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → your app's App ID → enable **Sign in with Apple**.
2. For the website too: create a **Services ID** (e.g. `com.yourco.lumin.web`), enable Sign in with Apple, add your website's domain and set the Return URL to `https://<your-website-domain>` (no path). Apple makes you verify the domain by hosting a small file they give you.
3. Backend variable `APPLE_CLIENT_IDS` = the iPhone bundle id and the Services ID, comma-separated. Website variables `NEXT_PUBLIC_APPLE_NATIVE_CLIENT_ID` = bundle id, `NEXT_PUBLIC_APPLE_CLIENT_ID` = Services ID (redeploy the website; they're read at build time).
4. iPhone app: `npm install` in `lumin-native`, `npx cap sync ios`, then in Xcode → App target → Signing & Capabilities → **+ Capability → Sign in with Apple**.
5. The button shows on the website and in the iPhone app, and is hidden in the Android app.

How accounts match: Apple's own id first, then a verified email (an existing account with the same email is linked). Apple may give a private relay address (`…@privaterelay.appleid.com`); to email those people you must register your sending domain under Certificates → More → **Configure** (Private Email Relay).

Not done: Apple also expects the app to **revoke** the Apple connection when someone deletes their account. That needs a signing key (.p8) from Apple and a server call; add it before App Store submission.

## 6. Release
- **Android**: Android Studio → Build → Generate Signed Bundle (AAB). **Keep the keystore and its passwords safe forever** (losing it means you can never update the app). Upload to Play Console → internal testing first, then production.
- **iPhone**: Xcode → Product → Archive → Distribute (App Store Connect) → TestFlight first.
- Both stores ask for: privacy policy URL (`https://your-site/privacy`), a public **account-deletion link** (`https://your-site/delete-account`, already built), support contact, screenshots, age rating, and a data-collection questionnaire (Apple "privacy labels", Google "data safety"). Answers come from `lib/legalDocs.ts` (privacy): account details, videos, orders/payments, watch activity, IP/device data, error reports, optional ID photos for sellers, optional push token.

## 7. Updating
Website changes: just deploy the website. Only rebuild/resubmit the app for a new icon, a native plugin, a changed `LUMIN_URL`/app id, or new native permissions.

## 8. Not done yet, and can get the app rejected
These are real store rules, not nice-to-haves. Decide on each before submitting.
1. **Sign in with Apple** (guideline 4.8): built (section 5). Still to do: set it up with your Apple account, test it, and add the revoke-on-delete step.
2. **User-generated content rules (Apple 1.2, Google UGC policy)**: reporting, blocking, removal, published contact and **filtering of objectionable content** are all built now (the word filter, picture checks and review queue; see DEPLOY.md "Content moderation"). It still needs to be switched on (picture-check key, a word list) and tested, and you need Terms that say objectionable content is not allowed.
3. **"Just a website in a wrapper" (Apple 4.2)** is a common rejection. Push notifications help. Stronger: native sharing into the app, in-app camera recording. Be ready to explain what the app does that Safari cannot.
4. **Share a video to Lumin from other apps** and the quick-settings tile: built (section 4) but untested on real phones.
5. **Digital purchases**: physical goods through Paystack are fine. The planned paid "keyword insights" subscription for sellers is a digital service: on iPhone, Apple would require in-app purchase for it. Do not sell it inside the iPhone app without that.
6. **Android back button, status bar, safe areas** and **video autoplay/sound** behave slightly differently in a WebView: test the feed, upload (camera/gallery permissions) and checkout (Paystack page opens inside the app) on real devices.

## 9. How long
With the accounts ready: about 1–2 days to a working test build on both platforms, then 3–10 days of store review back-and-forth; Apple is slower and stricter. Items in section 8 add their own time (moderation is the big one).

## Camera for the live test and delivery checks

The seller's live test, the buyer's claim video and the door check all use the app's own camera view (the web view's camera, not the phone's camera app), so nothing can be picked from the gallery.
- **Android:** `scripts/apply-android.mjs` now adds the `CAMERA` permission (it already adds `RECORD_AUDIO`). Re-run it and rebuild.
- **iOS:** in Xcode, `App` target > Info, add `NSCameraUsageDescription` ("Lumin uses the camera to record product tests and check deliveries") and `NSMicrophoneUsageDescription` ("Lumin records sound during the product test"). Without these the camera view shows nothing.
- Test on a real phone: the camera, the sound and the QR scan.
