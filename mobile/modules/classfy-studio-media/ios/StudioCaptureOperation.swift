import Foundation

/// One native recording owns its stop intent, even before MovieFileOutput
/// acknowledges didStartRecording. A late delegate cannot affect a newer take.
// Mutable fields are confined to StudioCaptureSession.queue. Asset inspection
// reads only the immutable id/fileURL/generation/sourceKind off that queue.
final class StudioCaptureOperation: @unchecked Sendable {
  enum Phase: String { case preparing, recording, stopping, finished }
  let id: String
  let fileURL: URL
  let generation: Int
  let sourceKind: String
  let durableSource: Bool
  private(set) var phase: Phase = .preparing
  private(set) var stopRequested = false
  private(set) var settled = false
  var completion: ((Result<[String: Any], Error>) -> Void)?
  var startupWatchdog: DispatchWorkItem?

  init(id: String, fileURL: URL, generation: Int, sourceKind: String,
       durableSource: Bool = false, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    self.id = id; self.fileURL = fileURL; self.generation = generation
    self.sourceKind = sourceKind; self.completion = completion
    self.durableSource = durableSource
  }

  @discardableResult func requestStop() -> Bool {
    guard !settled else { return false }
    stopRequested = true
    phase = .stopping
    return true
  }

  /// Returns true if the originating recording must immediately stop.
  @discardableResult func didStart() -> Bool {
    guard !settled else { return false }
    startupWatchdog?.cancel(); startupWatchdog = nil
    phase = stopRequested ? .stopping : .recording
    return stopRequested
  }

  @discardableResult func finish(_ result: Result<[String: Any], Error>) -> Bool {
    guard !settled else { return false }
    settled = true; phase = .finished
    startupWatchdog?.cancel(); startupWatchdog = nil
    let callback = completion; completion = nil
    callback?(result)
    return true
  }
}
