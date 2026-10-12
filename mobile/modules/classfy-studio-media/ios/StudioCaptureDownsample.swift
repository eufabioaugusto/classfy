import AVFoundation
import CoreMedia
import Foundation

/// 2K is derived only from a real 4K original. The source remains recoverable
/// until the output dimensions, cadence, duration and audio have been checked.
enum StudioCaptureDownsample {
  static func twoK(_ source: URL, fps: Int) async throws -> URL {
    let asset = AVURLAsset(url: source)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.invalid }
    let natural = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let duration = try await asset.load(.duration)
    let display = CGRect(origin: .zero, size: natural).applying(transform)
    let width = Int(abs(display.width).rounded()), height = Int(abs(display.height).rounded())
    guard max(width, height) >= 3840, min(width, height) >= 2160, [24, 30, 60].contains(fps), duration.isNumeric, duration.seconds > 0 else { throw Failure.invalid }
    let outputSize = width >= height ? CGSize(width: 2560, height: 1440) : CGSize(width: 1440, height: 2560)
    let scale = outputSize.width / abs(display.width)
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    let normalized = transform.concatenating(CGAffineTransform(translationX: -display.minX, y: -display.minY))
    layer.setTransform(normalized.concatenating(CGAffineTransform(scaleX: scale, y: scale)), at: .zero)
    instruction.layerInstructions = [layer]
    let composition = AVMutableVideoComposition()
    composition.renderSize = outputSize; composition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
    composition.instructions = [instruction]
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else { throw Failure.invalid }
    let output = source.deletingLastPathComponent().appendingPathComponent("\(UUID().uuidString)-2k.mov")
    session.outputURL = output; session.outputFileType = .mov; session.videoComposition = composition
    do {
      try await export(session, timeout: max(120, min(1800, duration.seconds * 3)))
      let encoded = AVURLAsset(url: output)
      guard let video = try await encoded.loadTracks(withMediaType: .video).first else { throw Failure.invalid }
      let size = try await video.load(.naturalSize), rotation = try await video.load(.preferredTransform)
      let rectangle = CGRect(origin: .zero, size: size).applying(rotation)
      let rate = try await video.load(.nominalFrameRate), actualDuration = try await encoded.load(.duration)
      let hasAudio = !(try await asset.loadTracks(withMediaType: .audio)).isEmpty
      let audioPresent = !(try await encoded.loadTracks(withMediaType: .audio)).isEmpty
      let fileSize = (try FileManager.default.attributesOfItem(atPath: output.path)[.size] as? NSNumber)?.int64Value ?? 0
      guard Int(abs(rectangle.width).rounded()) == Int(outputSize.width), Int(abs(rectangle.height).rounded()) == Int(outputSize.height),
        abs(Double(rate) - Double(fps)) < 0.1, actualDuration.isNumeric, abs(actualDuration.seconds - duration.seconds) <= max(0.1, 2 / Double(fps)),
        fileSize > 0, !hasAudio || audioPresent else { throw Failure.invalid }
      return output
    } catch {
      try? FileManager.default.removeItem(at: output)
      throw Failure.invalid
    }
  }
  private static func export(_ session: AVAssetExportSession, timeout: TimeInterval) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let gate = ExportGate(continuation)
      let watchdog = DispatchWorkItem { gate.finish(.failure(Failure.invalid)); session.cancelExport() }
      gate.watchdog = watchdog
      session.exportAsynchronously {
        gate.finish(session.status == .completed ? .success(()) : .failure(session.error ?? Failure.invalid))
      }
      DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: watchdog)
    }
  }
  private final class ExportGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    var watchdog: DispatchWorkItem?
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
    func finish(_ result: Result<Void, Error>) {
      lock.lock(); let owned = continuation; continuation = nil; lock.unlock()
      guard let owned else { return }; watchdog?.cancel(); owned.resume(with: result)
    }
  }
  enum Failure: LocalizedError {
    case invalid
    var errorDescription: String? { "Não foi possível finalizar o take em 2K. O original 4K foi preservado para recuperação." }
  }
}
