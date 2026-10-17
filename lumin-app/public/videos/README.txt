Drop a video file here named `sample.mp4` (or update the `videoUrl` path in
`lib/data.ts` to match whatever filename you use).

Try a landscape (16:9) and a square (1:1) file too — VideoStage.tsx uses
`object-contain`, so any aspect ratio gets letterboxed inside the fixed 9:16
frame automatically, without any extra code.
