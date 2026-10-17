import { useEffect, type RefObject } from 'react';
import { effectiveDuration, progressFraction } from './videoProgress';

// Drives the thin progress bar without re-rendering anything: it writes the fraction to a CSS
// variable (--video-progress) on the stage element and the bar's width reads it. While the
// video plays it follows every animation frame, so the bar glides instead of hopping four
// times a second like the `timeupdate` event alone makes it (very visible on short videos).
//
// It also copes with the cases that made the bar misbehave on some videos: a duration that
// is NaN or Infinity (see lib/videoProgress.ts), the source changing under the same
// element (data-saver switching to the small copy), and the end of a video (the bar fills
// instead of stopping short, then starts over when it loops).
//
// `onDuration` receives the video's length in ms once it is known (0 when unknown), which the
// twin pins on the timeline need to place themselves.
export function useVideoProgress(
  videoRef: RefObject<HTMLVideoElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  src: string | undefined,
  onDuration: (ms: number) => void,
) {
  useEffect(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return;

    let raf = 0;
    let lastMs = -1;

    const paint = (fraction: number) => stage.style.setProperty('--video-progress', `${(fraction * 100).toFixed(2)}%`);
    const seekableEnd = () => {
      try {
        return video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : 0;
      } catch {
        return 0;
      }
    };
    const update = () => {
      paint(progressFraction(video.currentTime, video.duration, seekableEnd()));
      const ms = Math.round(effectiveDuration(video.duration, seekableEnd()) * 1000);
      if (ms !== lastMs) {
        lastMs = ms;
        onDuration(ms);
      }
    };
    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      update();
    };
    const onEnded = () => {
      stop();
      paint(1); // a finished video shows a full bar (and a looping one resets on its next frame)
    };
    const onEmptied = () => {
      stop();
      paint(0);
      lastMs = -1;
      onDuration(0);
    };

    const handlers: [string, () => void][] = [
      ['loadedmetadata', update],
      ['durationchange', update],
      ['seeked', update],
      ['timeupdate', update],
      ['play', start],
      ['playing', start],
      ['pause', stop],
      ['ended', onEnded],
      ['emptied', onEmptied],
    ];
    handlers.forEach(([name, fn]) => video.addEventListener(name, fn));
    update();
    if (!video.paused && !video.ended) start();
    return () => {
      handlers.forEach(([name, fn]) => video.removeEventListener(name, fn));
      if (raf) cancelAnimationFrame(raf);
    };
  }, [videoRef, stageRef, src, onDuration]);
}
