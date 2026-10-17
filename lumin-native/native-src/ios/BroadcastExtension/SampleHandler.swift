import ReplayKit
import AVFoundation

/// Screen-recording ("Broadcast Upload") extension. The person picks Lumin in the system's screen-recording list;
/// we keep about eight seconds of picture and sound, stop, and send it to the matcher.
/// Add ../ShareExtension/LuminShared.swift to this target too. Extensions are limited to ~50 MB of memory, so the
/// frames are written straight to disk and never kept.
class SampleHandler: RPBroadcastSampleHandler {
    private var writer: AVAssetWriter?
    private var video: AVAssetWriterInput?
    private var audio: AVAssetWriterInput?
    private var startTime: CMTime?
    private var url: URL?
    private let seconds = 8.0

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
        url = u
        writer = try? AVAssetWriter(outputURL: u, fileType: .mp4)
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard let writer = writer else { return }
        let t = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        switch sampleBufferType {
        case .video:
            if video == nil, let fmt = CMSampleBufferGetFormatDescription(sampleBuffer) {
                let dims = CMVideoFormatDescriptionGetDimensions(fmt)
                let w = Int(dims.width) / 2, h = Int(dims.height) / 2 // half size keeps the clip small
                let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
                    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_500_000],
                ])
                input.expectsMediaDataInRealTime = true
                if writer.canAdd(input) { writer.add(input); video = input }
                let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 1, AVSampleRateKey: 44100, AVEncoderBitRateKey: 96000,
                ])
                a.expectsMediaDataInRealTime = true
                if writer.canAdd(a) { writer.add(a); audio = a }
                writer.startWriting(); writer.startSession(atSourceTime: t); startTime = t
            }
            guard let start = startTime else { return }
            if video?.isReadyForMoreMediaData == true { video?.append(sampleBuffer) }
            if CMTimeGetSeconds(CMTimeSubtract(t, start)) >= seconds { finishAndUpload() }
        case .audioApp: // sound from the app being recorded: far better than the microphone
            if startTime != nil, audio?.isReadyForMoreMediaData == true { audio?.append(sampleBuffer) }
        default: break
        }
    }

    private var finished = false
    private func finishAndUpload() {
        if finished { return }
        finished = true
        video?.markAsFinished(); audio?.markAsFinished()
        writer?.finishWriting { [weak self] in
            guard let self = self, let u = self.url else { return }
            LuminScan.send(file: u) { _ in
                try? FileManager.default.removeItem(at: u)
                self.finishBroadcastWithError(NSError(domain: "Lumin", code: 0, userInfo: [NSLocalizedDescriptionKey: "Scan finished. Open Lumin to see the result."]))
            }
        }
    }
}
