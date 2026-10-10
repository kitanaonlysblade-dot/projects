'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, Square, Video } from 'lucide-react';

// The whole point of this component: there is no <input type="file">
// anywhere in it. "Must be recorded through the camera, not the
// gallery" isn't a rule this component enforces by checking something
// after the fact — it's true because picking an existing file was never
// a possible action in the first place. getUserMedia + MediaRecorder
// are the only way a video ever gets into this flow.
//
// The backend (app/return_policy.py) can only check that a video_url is
// present, not where it came from — see that module's own comment on
// why. This component is the actual guarantee; the backend just trusts
// that whatever called it was this component.

const MAX_DURATION_SECONDS = 120;

type Stage = 'idle' | 'requesting' | 'ready' | 'recording' | 'preview' | 'denied' | 'unsupported';

interface CameraRecorderProps {
  onRecorded: (file: File) => void;
  onCancel: () => void;
}

export function CameraRecorder({ onRecorded, onCancel }: CameraRecorderProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Releases the camera the moment this unmounts for any reason
  // (cancelled, navigated away, claim submitted) — a live camera stream
  // left open after the person's done with it is exactly the kind of
  // thing that erodes trust in a feature that's already asking for
  // camera access.
  useEffect(() => {
    return () => {
      stopStream();
      stopTimer();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStage('unsupported');
      return;
    }
    setStage('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: true,
      });
      streamRef.current = stream;
      if (liveVideoRef.current) liveVideoRef.current.srcObject = stream;
      setStage('ready');
    } catch {
      // Covers both "permission denied" and "no camera on this device" —
      // getUserMedia doesn't reliably distinguish the two across
      // browsers, and the fix on the person's end is the same either
      // way (nothing this component can do about it).
      setStage('denied');
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm',
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      recordedBlobRef.current = blob;
      setPreviewUrl(URL.createObjectURL(blob));
      setStage('preview');
    };
    recorder.start();
    recorderRef.current = recorder;

    setSeconds(0);
    setStage('recording');
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        if (next >= MAX_DURATION_SECONDS) stopRecording();
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => {
    stopTimer();
    recorderRef.current?.stop();
    stopStream(); // camera's job is done once recording stops — release it now, not only on unmount
  };

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    recordedBlobRef.current = null;
    setSeconds(0);
    startCamera();
  };

  const confirmUse = () => {
    if (!recordedBlobRef.current) return;
    onRecorded(new File([recordedBlobRef.current], 'unboxing.webm', { type: 'video/webm' }));
  };

  const formatTime = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

  return (
    <div className="rounded-xl border border-line bg-black p-3">
      {stage === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Video size={22} className="text-white" />
          <p className="max-w-[220px] text-[13.5px] text-white/80">
            Record your unboxing live — this can&apos;t be a video from your gallery.
          </p>
          <button
            onClick={startCamera}
            className="brand-gradient rounded-full px-5 py-2 text-[13.5px] font-bold text-white"
          >
            Open camera
          </button>
          <button onClick={onCancel} className="text-[12.5px] font-bold text-white/60">
            Cancel
          </button>
        </div>
      )}

      {stage === 'requesting' && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-[13.5px] text-white/80">Waiting for camera permission…</p>
        </div>
      )}

      {stage === 'denied' && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="max-w-[220px] text-[13.5px] text-white/80">
            Camera access was denied or isn&apos;t available. Check your browser&apos;s permission
            settings for this site and try again.
          </p>
          <button onClick={startCamera} className="text-[12.5px] font-bold text-hot-pink">
            Try again
          </button>
          <button onClick={onCancel} className="text-[12.5px] font-bold text-white/60">
            Cancel
          </button>
        </div>
      )}

      {stage === 'unsupported' && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="max-w-[220px] text-[13.5px] text-white/80">
            This browser doesn&apos;t support in-app camera recording. Try a different browser.
          </p>
          <button onClick={onCancel} className="text-[12.5px] font-bold text-white/60">
            Cancel
          </button>
        </div>
      )}

      {(stage === 'ready' || stage === 'recording') && (
        <div>
          <div className="relative overflow-hidden rounded-lg">
            <video ref={liveVideoRef} autoPlay muted playsInline className="max-h-72 w-full bg-black" />
            {stage === 'recording' && (
              <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hot-pink" />
                <span className="text-[11.5px] font-bold text-white">{formatTime(seconds)}</span>
              </div>
            )}
          </div>
          <div className="mt-3 flex justify-center gap-3">
            {stage === 'ready' ? (
              <button
                onClick={startRecording}
                className="flex items-center gap-1.5 rounded-full bg-hot-pink px-5 py-2 text-[13.5px] font-bold text-white"
              >
                <Camera size={16} />
                Start recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-[13.5px] font-bold text-text"
              >
                <Square size={14} />
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {stage === 'preview' && previewUrl && (
        <div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user's own just-recorded clip, no captions to source */}
          <video src={previewUrl} controls className="max-h-72 w-full rounded-lg bg-black" />
          <div className="mt-3 flex justify-center gap-2">
            <button
              onClick={retake}
              className="flex items-center gap-1.5 rounded-full border border-white/30 px-4 py-2 text-[13.5px] font-bold text-white"
            >
              <RotateCcw size={15} />
              Retake
            </button>
            <button
              onClick={confirmUse}
              className="brand-gradient rounded-full px-5 py-2 text-[13.5px] font-bold text-white"
            >
              Use this video
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
