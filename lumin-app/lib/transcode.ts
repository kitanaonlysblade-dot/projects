// Converts the WebM file lib/watermark.ts produces — MediaRecorder's only
// output format in every Chromium/Firefox browser, there's no way to make
// MediaRecorder itself emit MP4 there — into a real MP4/H.264+AAC file.
// That's what "plays everywhere" actually requires: Windows' default
// player, QuickTime, and iOS/Android's native gallery and share sheets
// either don't support WebM at all or only inconsistently. VLC is the
// outlier that plays almost anything, which is why a watermarked download
// worked there and nowhere else.
//
// Runs entirely in the browser via ffmpeg.wasm rather than a backend
// round-trip — consistent with the rest of this app's video pipeline
// (uploads also go client -> R2 directly, never through the API server;
// see uploads.py's own comment on why nothing video-sized passes through
// it).

let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;

// Single-threaded core build — the multi-threaded one needs
// cross-origin-isolation (COOP/COEP) response headers set on every page
// in the app, which nothing else here needs and isn't worth adding just
// for this one feature. Pinned to a specific version and only fetched the
// first time someone actually saves a video (not on page load) — about
// 25MB, cached by the browser for the rest of the session via
// toBlobURL's own object-URL caching.
const CORE_VERSION = '0.12.6';
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

// True wherever createWatermarkedVideoBlob can actually run (see
// canWatermarkVideo in watermark.ts) — ffmpeg.wasm itself just needs
// WebAssembly and SharedArrayBuffer-free single-threaded execution, which
// is every browser new enough to have MediaRecorder in the first place.
export function canTranscodeToMp4(): boolean {
  return typeof WebAssembly !== 'undefined';
}

export async function transcodeWebmToMp4(webmBlob: Blob): Promise<Blob> {
  const { fetchFile } = await import('@ffmpeg/util');
  const ffmpeg = await getFFmpeg();

  await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));
  try {
    await ffmpeg.exec([
      '-i',
      'input.webm',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      // Widest player/hardware-decoder compatibility — without this, an
      // odd chroma format carried over from the source VP8/VP9 can still
      // trip up some phones' hardware decoders even once it's H.264.
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      // moov atom moved to the front of the file, so playback (and
      // scrubbing) can start immediately instead of needing the whole
      // file downloaded first — standard for anything meant to be shared
      // or played straight off disk rather than progressively streamed.
      '-movflags',
      '+faststart',
      'output.mp4',
    ]);
    const data = await ffmpeg.readFile('output.mp4');
    // ffmpeg.wasm's own types declare this as Uint8Array<ArrayBufferLike>
    // — ArrayBufferLike covers SharedArrayBuffer too, which Blob's own
    // types (correctly) don't accept, so passing `data` straight through
    // doesn't type-check even though it's never actually
    // SharedArrayBuffer-backed at runtime (this build has no
    // cross-origin-isolation headers, which SharedArrayBuffer requires in
    // the first place — see getFFmpeg's own comment on why). Re-wrapping
    // in a fresh Uint8Array is the fix rather than a cast: that
    // constructor overload always allocates a genuine new ArrayBuffer, so
    // the result is actually, not just nominally, the type Blob wants.
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  } finally {
    // Best-effort cleanup of ffmpeg's in-memory virtual filesystem — the
    // instance is reused across downloads (see ffmpegPromise above), so
    // this keeps one save's files from lingering into the next.
    await ffmpeg.deleteFile('input.webm').catch(() => {});
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
  }
}
