// Used by ShareSheet.tsx's handleDownload to burn a brand+handle mark
// into the actual pixels of a saved copy of the video, plus a branded
// end card appended after the video itself — deliberately only there,
// not anywhere in the normal in-app feed (VideoStage.tsx): both should
// be something a downloaded file carries once it leaves the app, not a
// permanent overlay on top of every video someone is just watching in
// Lumin itself.

const HOT_PINK = '#FF2D6F';
const HOT_ORANGE = '#FF6B35';
const WATERMARK_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Sized relative to a 1080px-wide frame — this app's own standard
// upload width (see UploadDiscoverPostModal's fallback and
// VideoUploader's real measured dimensions) — so both the watermark and
// the end card read as the same relative size on any actual video
// resolution, not a fixed pixel size that would look tiny on a 4K
// upload or oversized on a small one.
const BASELINE_WIDTH = 1080;

// Bold, white, stroked as well as shadowed — closer to how TikTok's own
// on-screen watermark actually reads (big enough to catch your eye
// immediately, not a discreet corner credit) than a smaller, shadow-only
// version would. Bottom-left, clear of wherever a caption would sit if
// this were still an in-app overlay (it isn't anymore, but the same
// placement still reads naturally once this is a static exported file).
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  frameWidth: number,
  frameHeight: number,
  posterHandle: string,
): void {
  const scale = frameWidth / BASELINE_WIDTH;
  const marginX = 28 * scale;
  const marginBottom = 32 * scale;
  const wordmarkSize = 56 * scale;
  const handleSize = 32 * scale;
  const lineGap = 10 * scale;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 10 * scale;
  ctx.shadowOffsetY = 2 * scale;

  const handleBaselineY = frameHeight - marginBottom;
  const wordmarkBaselineY = handleBaselineY - handleSize - lineGap;

  // Wordmark — "L" in the brand's hot-pink, "UMIN" in white, exactly
  // the two-color split the header logo elsewhere in the app uses
  // (<span className="text-hot-pink">L</span>UMIN). A dark stroke
  // around both, not just a shadow, is what actually keeps this
  // readable over bright or busy footage the way TikTok's own mark
  // stays legible over anything.
  ctx.font = `800 ${wordmarkSize}px ${WATERMARK_FONT_FAMILY}`;
  const lWidth = ctx.measureText('L').width;
  ctx.lineWidth = 2.5 * scale;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.strokeText('L', marginX, wordmarkBaselineY);
  ctx.strokeText('UMIN', marginX + lWidth, wordmarkBaselineY);
  ctx.fillStyle = HOT_PINK;
  ctx.fillText('L', marginX, wordmarkBaselineY);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('UMIN', marginX + lWidth, wordmarkBaselineY);

  // Poster's handle underneath — whoever's content this actually is,
  // not whoever downloaded it.
  ctx.font = `700 ${handleSize}px ${WATERMARK_FONT_FAMILY}`;
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.strokeText(`@${posterHandle}`, marginX, handleBaselineY);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`@${posterHandle}`, marginX, handleBaselineY);

  ctx.restore();
}

// How long the branded outro plays after the video itself ends, and how
// much of that is spent easing in rather than sitting static — same
// "brief, then it's over" pacing TikTok's own end-of-video branded
// moment has, not a lingering screen someone has to wait out.
const END_CARD_SECONDS = 2;
const END_CARD_EASE_IN_SECONDS = 0.4;
// Extra time createWatermarkedVideoBlob keeps recording past
// END_CARD_SECONDS before actually calling stop() — see that function's
// own comment on why (capture-stream timing isn't synchronized with the
// draw loop, so stopping the instant the nominal duration is reached
// risks losing the last frame or two).
const END_CARD_TAIL_BUFFER_SECONDS = 0.3;

// Same platform gradient the app's own `.brand-gradient` CSS class
// paints buttons and banners with (linear-gradient(135deg, hot-pink,
// hot-orange)) — reproduced here in canvas terms since a downloaded
// video obviously can't reference the app's stylesheet.
function brandGradientFill(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // 135deg in CSS means "from top-left-ish toward bottom-right-ish";
  // canvas gradients are defined by two literal points rather than an
  // angle, so this just picks opposite corners along that same diagonal.
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, HOT_PINK);
  gradient.addColorStop(1, HOT_ORANGE);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

// Drawn for END_CARD_SECONDS worth of frames right after the source
// video ends (see createWatermarkedVideoBlob below) — a full-bleed
// brand-gradient card with the app name and the poster's handle
// centered, the same "here's who made this, here's where it's from"
// moment TikTok's own downloads end on. `t` goes from 0 to 1 across
// that whole duration; only used here to ease the text in (a quick
// fade + upward settle) rather than have it simply snap into place on
// the very first end-card frame.
export function drawEndCard(
  ctx: CanvasRenderingContext2D,
  frameWidth: number,
  frameHeight: number,
  posterHandle: string,
  t: number,
): void {
  const scale = frameWidth / BASELINE_WIDTH;
  brandGradientFill(ctx, frameWidth, frameHeight);

  const easeT = Math.min(1, t / (END_CARD_EASE_IN_SECONDS / END_CARD_SECONDS));
  // Cubic ease-out — quick to arrive, no overshoot, settles cleanly.
  const eased = 1 - Math.pow(1 - easeT, 3);
  const opacity = eased;
  const riseOffset = (1 - eased) * 18 * scale; // starts 18px low, settles to its resting position

  const centerX = frameWidth / 2;
  const centerY = frameHeight / 2;
  const wordmarkSize = 72 * scale;
  const handleSize = 34 * scale;
  const taglineSize = 22 * scale;
  const gap1 = 18 * scale; // wordmark -> handle
  const gap2 = 14 * scale; // handle -> tagline

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 12 * scale;
  ctx.shadowOffsetY = 2 * scale;

  // All-white wordmark here, not the split hot-pink/white treatment
  // drawWatermark uses — it's already sitting on the brand gradient
  // itself, and every other place in the app that puts text on that
  // gradient (buttons, banners — see globals.css's .brand-gradient
  // usages) uses plain white for exactly that reason.
  ctx.font = `800 ${wordmarkSize}px ${WATERMARK_FONT_FAMILY}`;
  const wordmarkY = centerY - gap1 / 2 + riseOffset;
  ctx.fillText('LUMIN', centerX, wordmarkY);

  ctx.font = `700 ${handleSize}px ${WATERMARK_FONT_FAMILY}`;
  const handleY = wordmarkY + handleSize + gap1 / 2 + riseOffset * 0.6;
  ctx.fillText(`@${posterHandle}`, centerX, handleY);

  ctx.font = `500 ${taglineSize}px ${WATERMARK_FONT_FAMILY}`;
  ctx.globalAlpha = opacity * 0.85;
  const taglineY = handleY + taglineSize + gap2 + riseOffset * 0.3;
  ctx.fillText('Watch more on LUMIN', centerX, taglineY);

  ctx.restore();
}

const CANDIDATE_MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

// captureStream() is well-supported in Chrome/Firefox but is recent
// enough, and inconsistent enough in Safari, that it isn't reliably
// declared across every TypeScript DOM lib version — cast rather than
// depend on the ambient type having it, and feature-detect at runtime
// regardless (see canWatermarkVideo below).
type CanvasWithCapture = HTMLCanvasElement & { captureStream: (frameRate?: number) => MediaStream };
type VideoWithCapture = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  // Fires once per actually-decoded video frame, driven by the media
  // pipeline rather than the display's paint/composite cycle — unlike
  // requestAnimationFrame, browsers don't throttle it down when the tab
  // is backgrounded or minimized. That gap is exactly what used to
  // produce "laggy" saved videos: the source <video> (and the audio
  // track being captured live from it) keeps playing in real time
  // regardless of tab focus, but a throttled rAF loop falls badly
  // behind, so the canvas — and therefore the recording — ends up with
  // long runs of a stale, duplicated frame instead of tracking the
  // actual motion, and drifts out of sync with the audio. Chrome/Edge
  // support this; Safari/Firefox don't as of this writing, so
  // drawVideoFrame below feature-detects and falls back to rAF.
  requestVideoFrameCallback?: (callback: (now: number, metadata: unknown) => void) => number;
};

export function canWatermarkVideo(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype &&
    pickSupportedMimeType() !== null
  );
}

// Re-encodes `videoUrl` into a new video with drawWatermark's mark
// burned into every frame, followed by a few extra seconds of
// drawEndCard's branded outro — a saved copy should carry the app's own
// look once it's out in the world, not just be a raw copy of the source
// file (see this module's own top-of-file comment on why that's only
// true for a downloaded copy, not the in-app feed itself). Works by
// playing the source video in an off-DOM element, redrawing each frame
// onto a canvas with the mark on top, and recording *that* canvas — so
// the watermarked portion takes roughly as long as the video itself to
// run in real time (plus the fixed END_CARD_SECONDS after it); there's
// no ffmpeg or other batch encoder available browser-side to do this
// faster than playback speed.
//
// Requires the video's own host to send CORS headers allowing this
// origin (Access-Control-Allow-Origin) — canvas operations on a
// cross-origin <video> without that throw a SecurityError the moment
// anything tries to read pixels back out of the canvas, captureStream()
// included. Same-origin sources (the seeded /videos/sample.mp4) never
// hit this; a real R2-hosted upload needs the bucket's CORS config to
// allow it (see lumin-backend's README "File uploads" section) or this
// throws — ShareSheet's handleDownload catches that and falls back to a
// plain, unwatermarked copy rather than failing the download outright.
export async function createWatermarkedVideoBlob(videoUrl: string, posterHandle: string): Promise<Blob> {
  const mimeType = pickSupportedMimeType();
  if (!mimeType) throw new Error('Video watermarking is not supported in this browser');

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  // Silences local playback only — the audio track pulled from
  // video.captureStream() below still carries the real decoded audio
  // regardless of this, so there's no need to actually play it aloud
  // just to capture it.
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Failed to load video for watermarking')), {
      once: true,
    });
  });

  const canvas = document.createElement('canvas') as CanvasWithCapture;
  // VP8/VP9 encode with 4:2:0 chroma subsampling, which needs even
  // width/height — an odd source dimension (uncommon, but real uploads
  // aren't guaranteed even) used to get silently rounded by the
  // encoder, so the saved file came out a pixel or two off from the
  // original. Rounding down here instead means the canvas — and
  // therefore what actually gets recorded — is already a size the
  // encoder can represent exactly, with no adjustment of its own.
  canvas.width = video.videoWidth - (video.videoWidth % 2);
  canvas.height = video.videoHeight - (video.videoHeight % 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const canvasStream = canvas.captureStream(30);
  const audioTracks = (video as VideoWithCapture).captureStream?.().getAudioTracks() ?? [];
  const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

  // Left unset, MediaRecorder falls back to a conservative default
  // bitrate that isn't scaled to the actual resolution being recorded —
  // fine for a small preview clip, but for a full vertical HD video it
  // compresses hard enough to look blocky and stutter on playback (the
  // "laggy" result). BITS_PER_PIXEL_PER_FRAME is a standard rough
  // quality target for H.264/VP8/VP9 at normal motion; scaling it by
  // the actual frame area and rate means a small/short video isn't
  // needlessly bloated and a large one isn't needlessly starved.
  const BITS_PER_PIXEL_PER_FRAME = 0.1;
  const videoBitsPerSecond = Math.round(canvas.width * canvas.height * 30 * BITS_PER_PIXEL_PER_FRAME);
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond,
    audioBitsPerSecond: 128_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('Recording failed'));
  });

  // Guards every stop() call below — MediaRecorder throws
  // InvalidStateError calling stop() on a recorder that's already
  // inactive, and per spec a recorder auto-stops once *every* track
  // feeding it has ended. The canvas's own track never ends on its own,
  // but the source video's audio track does the instant the video
  // finishes — if some browser stops the whole recorder early because
  // of that (rather than strictly waiting for every track, canvas
  // track included), this is what stops that from throwing an uncaught
  // exception inside a requestAnimationFrame callback and silently
  // killing the draw loop — which is exactly what would make the end
  // card quietly never get recorded even though the rest of the video
  // plays back fine.
  const stopRecorder = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };

  let rafId = 0;
  const videoWithFrameCallback = video as VideoWithCapture;
  // See VideoWithCapture's own comment on why this, not rAF, drives
  // drawing the source video's frames specifically — the end card
  // afterward has no video to stay in sync with, so it keeps using rAF
  // (see runEndCard below).
  const scheduleNextVideoFrame = videoWithFrameCallback.requestVideoFrameCallback
    ? (cb: () => void) => videoWithFrameCallback.requestVideoFrameCallback!(cb)
    : (cb: () => void) => {
        rafId = requestAnimationFrame(cb);
      };

  const drawVideoFrame = () => {
    if (recorder.state === 'inactive') {
      // Only reachable if the recorder stopped itself, not us — see
      // stopRecorder's own comment on why that can happen. Logged
      // rather than silently swallowed since this is exactly the
      // failure mode that would otherwise look like "the video saved
      // fine, it just doesn't have the end card" with no clue why.
      console.warn('Lumin: video recorder stopped before the end card could be recorded');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawWatermark(ctx, canvas.width, canvas.height, posterHandle);
    if (!video.ended) {
      scheduleNextVideoFrame(drawVideoFrame);
    } else {
      runEndCard();
    }
  };

  // Keeps the *same* canvas stream (and therefore the same recorder)
  // running straight through the transition — there's no gap or second
  // recorder to stitch together, just a different thing being drawn to
  // the same canvas for a fixed stretch of time afterward. Runs an
  // extra END_CARD_TAIL_BUFFER_SECONDS past the nominal duration before
  // actually stopping — cheap insurance against the very last drawn
  // frame(s) not having been captured yet at the instant stop() is
  // called, since canvas.captureStream()'s internal sampling clock
  // isn't synchronized with this rAF loop.
  const runEndCard = () => {
    if (recorder.state === 'inactive') {
      console.warn('Lumin: video recorder stopped before the end card could be recorded');
      return;
    }
    const startedAt = performance.now();
    const drawEndCardFrame = () => {
      if (recorder.state === 'inactive') return; // already warned above
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      if (elapsedSeconds >= END_CARD_SECONDS + END_CARD_TAIL_BUFFER_SECONDS) {
        stopRecorder();
        return;
      }
      // Clamp t itself to 1 past END_CARD_SECONDS — the tail buffer
      // above exists purely to give the recorder breathing room, not to
      // keep animating; the card should already be fully settled and
      // static for that last stretch.
      drawEndCard(ctx, canvas.width, canvas.height, posterHandle, Math.min(1, elapsedSeconds / END_CARD_SECONDS));
      rafId = requestAnimationFrame(drawEndCardFrame);
    };
    drawEndCardFrame();
  };

  // A timeslice (rather than the no-argument start() every other
  // MediaRecorder use in this codebase would default to) is the
  // standard mitigation for a family of Chromium bugs where a single
  // giant end-of-recording chunk produces a WebM file some players
  // handle inconsistently — periodic chunks produce a more
  // conventionally-structured container.
  recorder.start(1000);
  try {
    await video.play();
  } catch (err) {
    stopRecorder();
    throw err;
  }
  drawVideoFrame();

  return recordingDone;
}
