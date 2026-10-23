import Foundation

/// One native recording owns its stop intent, even before MovieFileOutput
/// acknowledges didStartRecording. A late delegate cannot affect a newer take.
// Mutable fields are confined to StudioCaptureSession.queue.
final class StudioCaptureOperation: @unchecked Sendable {
  enum Phase: String { case preparing, recording, stopping, finished }
  enum StopReason: String {
    case userStop = "user_stop", appBackground = "app_background", viewInactive = "view_inactive"
    case disposed, captureInterrupted = "capture_interrupted", runtimeError = "runtime_error"
    case startupTimeout = "startup_timeout", nativeFinished = "native_finished"
  }
  let id: String
  let fileURL: URL
  let generation: Int
  let sourceKind: String
  let durableSource: Bool
  let requestedAtEpochMs: Double
  private(set) var phase: Phase = .preparing
  private(set) var stopRequested = false
  private(set) var settled = false
  private(set) var nativeFinished = false
  private var startedAtEpochMs: Double?
  private var startedUptime: TimeInterval?
  private var stopRequestedAtEpochMs: Double?
  private var requestedStopReason: StopReason?
  private var finishedAtEpochMs: Double?
  private var finishedUptime: TimeInterval?
  private var interruptionReason: Int?
  private var runtimeFailure = false
  private var nativeError: [String: Any]?
  private var nativeMediaDurationSeconds: Double?
  private let freeDiskBytesAtStart: Int64?
  private let thermalStateAtStart: String?
  private var freeDiskBytesAtEnd: Int64?
  private var thermalStateAtEnd: String?
  var completion: ((Result<[String: Any], Error>) -> Void)?
  var startupWatchdog: DispatchWorkItem?

  init(id: String, fileURL: URL, generation: Int, sourceKind: String,
       durableSource: Bool = false, freeDiskBytes: Int64? = nil, thermalState: String? = nil,
       requestedAtEpochMs: Double = Date().timeIntervalSince1970 * 1000,
       completion: @escaping (Result<[String: Any], Error>) -> Void) {
    self.id = id; self.fileURL = fileURL; self.generation = generation
    self.sourceKind = sourceKind; self.completion = completion
    self.durableSource = durableSource; self.requestedAtEpochMs = requestedAtEpochMs
    self.freeDiskBytesAtStart = freeDiskBytes; self.thermalStateAtStart = thermalState
  }

  @discardableResult func requestStop(reason: StopReason = .userStop,
      atEpochMs: Double = Date().timeIntervalSince1970 * 1000) -> Bool {
    // Inspection can still be running after capture ended. A late browser STOP
    // must never turn an already interrupted take into an intentional ending.
    guard !settled, !nativeFinished else { return false }
    if requestedStopReason == nil {
      requestedStopReason = reason; stopRequestedAtEpochMs = atEpochMs
    }
    stopRequested = true; phase = .stopping
    return true
  }

  /// Returns true if the originating recording must immediately stop.
  @discardableResult func didStart(atEpochMs: Double = Date().timeIntervalSince1970 * 1000,
      uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Bool {
    guard !settled, !nativeFinished else { return false }
    startupWatchdog?.cancel(); startupWatchdog = nil
    if startedAtEpochMs == nil { startedAtEpochMs = atEpochMs; startedUptime = uptime }
    phase = stopRequested ? .stopping : .recording
    return stopRequested
  }

  func noteInterruption(reason: Int) {
    guard !settled, !nativeFinished else { return }
    if interruptionReason == nil { interruptionReason = reason }
  }

  func noteRuntimeError(_ error: NSError?) {
    guard !settled, !nativeFinished else { return }
    runtimeFailure = true
    if let error, nativeError == nil { nativeError = Self.errorReceipt(error, successfullyFinished: nil) }
  }

  @discardableResult func didFinish(error: NSError? = nil, successfullyFinished: Bool? = nil,
      mediaDurationSeconds: Double? = nil, freeDiskBytes: Int64? = nil, thermalState: String? = nil,
      atEpochMs: Double = Date().timeIntervalSince1970 * 1000,
      uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Bool {
    guard !settled, !nativeFinished else { return false }
    nativeFinished = true; phase = .stopping
    finishedAtEpochMs = atEpochMs; finishedUptime = uptime
    nativeMediaDurationSeconds = mediaDurationSeconds
    freeDiskBytesAtEnd = freeDiskBytes; thermalStateAtEnd = thermalState
    startupWatchdog?.cancel(); startupWatchdog = nil
    if let error {
      if nativeError == nil { nativeError = Self.errorReceipt(error, successfullyFinished: successfullyFinished) }
      if successfullyFinished != true { runtimeFailure = true }
    }
    return true
  }

  private static func errorReceipt(_ error: NSError, successfullyFinished: Bool?) -> [String: Any] {
    // Keep only a framework identifier and numeric code. localizedDescription
    // and userInfo can contain file URLs or other private capture details.
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    let domain = String(String.UnicodeScalarView(error.domain.unicodeScalars.filter { allowed.contains($0) }.prefix(128)))
    var value: [String: Any] = ["domain": domain, "code": error.code]
    if let successfullyFinished { value["recordingSuccessfullyFinished"] = successfullyFinished }
    return value
  }

  func captureReceipt(mediaDurationSeconds: Double? = nil) -> [String: Any]? {
    guard let finishedAtEpochMs else { return nil }
    // A real OS interruption or unfinished native error wins over user intent;
    // the first request remains separately visible for an unambiguous audit.
    let reason: StopReason = interruptionReason != nil ? .captureInterrupted :
      runtimeFailure ? .runtimeError : requestedStopReason ?? .nativeFinished
    var value: [String: Any] = ["version": 1, "operationId": id,
      "requestedAtEpochMs": requestedAtEpochMs, "finishedAtEpochMs": finishedAtEpochMs,
      "stopReason": reason.rawValue, "interrupted": reason != .userStop]
    if let startedAtEpochMs { value["startedAtEpochMs"] = startedAtEpochMs }
    if let stopRequestedAtEpochMs { value["stopRequestedAtEpochMs"] = stopRequestedAtEpochMs }
    if let requestedStopReason { value["requestedStopReason"] = requestedStopReason.rawValue }
    if let start = startedUptime, let end = finishedUptime, end >= start {
      value["wallDurationSeconds"] = end - start
    }
    if let duration = mediaDurationSeconds ?? nativeMediaDurationSeconds, duration.isFinite, duration >= 0 { value["mediaDurationSeconds"] = duration }
    if let freeDiskBytesAtStart { value["freeDiskBytesAtStart"] = freeDiskBytesAtStart }
    if let freeDiskBytesAtEnd { value["freeDiskBytesAtEnd"] = freeDiskBytesAtEnd }
    if let thermalStateAtStart { value["thermalStateAtStart"] = thermalStateAtStart }
    if let thermalStateAtEnd { value["thermalStateAtEnd"] = thermalStateAtEnd }
    if let interruptionReason { value["interruptionReason"] = interruptionReason }
    if let nativeError { value["nativeError"] = nativeError }
    return value
  }

  /// Private recovery evidence lives next to the original, never in its bytes.
  /// Write the termination evidence before asynchronous AVAsset inspection.
  func persistReceipt(mediaDurationSeconds: Double? = nil) throws {
    guard let receipt = captureReceipt(mediaDurationSeconds: mediaDurationSeconds) else { return }
    let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
    try data.write(to: fileURL.appendingPathExtension("capture.json"), options: .atomic)
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

/// A conservative free-space floor, not a promise of recording duration.
/// The movie output preserves this reserve while it finalizes a usable MOV.
enum StudioCaptureStoragePolicy {
  static let minimumStartBytes: Int64 = 1_024 * 1_024 * 1_024
  static let finalizationReserveBytes: Int64 = 512 * 1_024 * 1_024

  static func canStart(availableBytes: Int64?) -> Bool {
    guard let availableBytes else { return false }
    return availableBytes >= minimumStartBytes
  }

  static func estimatedRemainingSeconds(availableBytes: Int64?, recordedBytes: Int64,
      recordedSeconds: Double) -> Double? {
    guard let availableBytes, availableBytes >= 0, recordedBytes > 0,
      recordedSeconds.isFinite, recordedSeconds >= 3 else { return nil }
    let bytesPerSecond = Double(recordedBytes) / recordedSeconds
    guard bytesPerSecond.isFinite, bytesPerSecond > 0 else { return nil }
    return Double(max(0, availableBytes - finalizationReserveBytes)) / bytesPerSecond
  }
}
