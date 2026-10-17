// How far through a video is playback, as a 0..1 fraction, for the progress bar.
//
// `duration` is not always a usable number: it is NaN until metadata loads, and Infinity for
// some files (typically a recording made in the browser whose length was never written into
// the file). Dividing by it gives 0 forever, which is what made the bar sit still on some
// videos. When it isn't a real length we fall back to how far the browser says it can seek,
// and if even that is unknown the answer is 0 (no guess) rather than a wrong number.
export function effectiveDuration(duration: number, seekableEnd = 0): number {
  if (Number.isFinite(duration) && duration > 0) return duration;
  if (Number.isFinite(seekableEnd) && seekableEnd > 0) return seekableEnd;
  return 0;
}

export function progressFraction(currentTime: number, duration: number, seekableEnd = 0): number {
  const d = effectiveDuration(duration, seekableEnd);
  if (d <= 0 || !Number.isFinite(currentTime)) return 0;
  return Math.min(1, Math.max(0, currentTime / d));
}
