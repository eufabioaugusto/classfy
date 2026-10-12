import Foundation

struct StudioCaptureSpeechToken: Equatable, Sendable {
  let sessionId: String
  let generation: Int
  let epoch: Int
  let segmentId: Int
}

/// Confined to the capture audio queue. A task callback can arrive after a
/// cancel, a camera change or a new reader: only its exact token may publish.
struct StudioCaptureSpeechState {
  private(set) var sessionId = ""
  private(set) var generation = 0
  private(set) var sequence = 0
  private(set) var segmentId = 0
  private(set) var enabled = false
  private(set) var token: StudioCaptureSpeechToken?
  private var epoch = 0

  mutating func configure(sessionId: String, generation: Int, enabled: Bool) {
    if self.sessionId != sessionId || self.generation != generation {
      invalidate()
      self.sessionId = sessionId
      self.generation = generation
      sequence = 0; segmentId = 0
    }
    self.enabled = enabled && !sessionId.isEmpty && sessionId.count <= 128
    if !self.enabled { invalidate() }
  }

  mutating func beginSegment() -> StudioCaptureSpeechToken? {
    guard enabled else { return nil }
    epoch += 1; segmentId += 1
    let next = StudioCaptureSpeechToken(sessionId: sessionId, generation: generation, epoch: epoch, segmentId: segmentId)
    token = next
    return next
  }

  mutating func invalidate() { epoch += 1; token = nil }
  func accepts(_ candidate: StudioCaptureSpeechToken) -> Bool { enabled && token == candidate }
  mutating func event(_ payload: [String: Any]) -> [String: Any] {
    sequence += 1
    var result = payload
    result["sessionId"] = sessionId; result["generation"] = generation
    result["sequence"] = sequence; result["segmentId"] = segmentId
    return result
  }
}

/// Audio activity wakes an ended recognition task; it never advances the
/// teleprompter. Only a matched transcript is allowed to advance words in JS.
struct StudioCaptureSpeechRecovery {
  enum FailureAction: Equatable { case awaitActivity, retry(after: Double), terminal }
  private(set) var awaitingActivity = false
  private(set) var terminal = false
  private(set) var consecutiveFailures = 0
  private var lastActivityAt: Double?
  private var retryAfter = 0.0
  static let activityFloor = 0.0031622776601683794 // -50 dBFS RMS, wake-up only

  mutating func reset() { self = Self() }
  /// Returns true only once when fresh audio can resume an idle task.
  mutating func noteAudio(rms: Double?, now: Double) -> Bool {
    guard now.isFinite, let rms, rms.isFinite, rms >= Self.activityFloor else { return false }
    lastActivityAt = now
    guard awaitingActivity, !terminal, now >= retryAfter else { return false }
    awaitingActivity = false
    return true
  }
  mutating func noteResult() { consecutiveFailures = 0 }
  private func hasRecentActivity(now: Double) -> Bool {
    lastActivityAt.map { now >= $0 && now - $0 <= 2 } ?? false
  }
  mutating func waitAfterEmptyFinal(now: Double) -> Bool {
    guard !hasRecentActivity(now: now) else { return false }
    awaitingActivity = true; retryAfter = now + 0.25
    return true
  }
  mutating func failed(now: Double, noSpeech: Bool = false) -> FailureAction {
    guard !noSpeech, hasRecentActivity(now: now) else {
      // A documented no-speech result is a natural pause even in a room with
      // audible background noise. It cannot consume the engine-failure budget.
      consecutiveFailures = 0; awaitingActivity = true; retryAfter = now + (noSpeech ? 1 : 0.25)
      return .awaitActivity
    }
    consecutiveFailures += 1
    guard consecutiveFailures <= 2 else { terminal = true; awaitingActivity = false; return .terminal }
    let delay = 0.25 * Double(consecutiveFailures)
    retryAfter = now + delay
    return .retry(after: delay)
  }
}
