// One way to scan a recording, used by every screen: fingerprint it on this device and send only the fingerprint;
// if this device can't, send the recording like before. A miss from the fingerprint alone comes back with
// deeper_check = true, and the recording is then sent automatically for the full check.
import { ApiError, scanMatch, scanMatchFeatures, type ApiScanMatch } from './api';
import { FingerprintError, fingerprintClip, fingerprintSupported } from './fingerprint';

// NEXT_PUBLIC_ON_DEVICE_SCAN=false turns this off (recordings are uploaded as before).
export function onDeviceScanEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ON_DEVICE_SCAN !== 'false' && fingerprintSupported();
}

export async function scanRecording(file: File, live = false): Promise<ApiScanMatch> {
  if (onDeviceScanEnabled()) {
    let features;
    try {
      features = await fingerprintClip(file);
    } catch (e) {
      if (e instanceof FingerprintError && e.fatal) throw new ApiError(400, e.message);
      features = null; // this device couldn't do it: fall back to sending the recording
    }
    if (features) {
      const res = await scanMatchFeatures(features, live);
      if (!res.deeper_check) return res;
      // Nothing found from the fingerprint alone: run the full check on the recording straight away.
      return scanMatch(file, live);
    }
  }
  return scanMatch(file, live);
}

/** Kept for the screens' retry button: upload the recording itself. */
export const sendRecording = (file: File): Promise<ApiScanMatch> => scanMatch(file);
