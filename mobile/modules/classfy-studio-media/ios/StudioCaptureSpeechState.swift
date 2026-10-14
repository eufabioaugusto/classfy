import Foundation

/// Speech can replace the current utterance after a pause without completing
/// the task. Its word times are relative to that task's processed audio, so
/// retain only the earlier, non-overlapping prefix and revise the current span.
struct StudioCaptureSpeechTranscript {
  struct Segment { let timestamp: Double; let duration: Double; let range: NSRange }
  private struct Part { let timestamp: Double; let end: Double; let text: String }
  private var parts: [Part] = []
  private(set) var timeUsable = false
  private(set) var currentResultWordCount = 0
  private(set) var fullWordCount = 0
  private(set) var fallbackReason: String?
  private(set) var heldResult = false
  private(set) var currentFirstTimestamp: Double?
  private(set) var currentLastEnd: Double?
  var segmentCount: Int { parts.count }
  var firstTimestamp: Double? { parts.first?.timestamp }
  var lastEnd: Double? { parts.last?.end }
  mutating func reset() { self = Self() }
  mutating func append(formattedString: String, segments: [Segment]) -> String? {
    let formatted = formattedString as NSString
    let original = formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
    currentResultWordCount = Self.wordCount(original)
    currentFirstTimestamp = segments.first.flatMap { $0.timestamp.isFinite && $0.timestamp >= 0 ? $0.timestamp : nil }
    currentLastEnd = segments.last.flatMap {
      let end = $0.timestamp + $0.duration
      return end.isFinite && $0.timestamp >= 0 && $0.duration >= 0 ? end : nil
    }
    func fallback(_ reason: String) -> String? {
      timeUsable = false; fallbackReason = reason; heldResult = !parts.isEmpty
      // A shorter current utterance cannot replace a published cumulative
      // result under the same task token. Keep its timed history privately,
      // and publish again only once the new span has usable audio positions.
      if heldResult { return nil }
      fullWordCount = currentResultWordCount
      return original.isEmpty ? nil : original
    }
    guard !segments.isEmpty, segments.count <= 2048, formatted.length <= 16_384 else { return fallback("missing_or_unbounded_segments") }
    // Partial timings may be provisional, especially zero for every word.
    // Without distinguishable audio positions forward the original result;
    // never invent a cumulative prefix based on its text or segment count.
    guard segments.contains(where: { $0.timestamp > 0 }), segments.contains(where: { $0.duration > 0 }),
      segments.count == 1 || zip(segments, segments.dropFirst()).allSatisfy({ $0.timestamp < $1.timestamp }) else {
      return fallback("provisional_timing")
    }
    var next: [Part] = []
    for (index, segment) in segments.enumerated() {
      let range = segment.range
      guard segment.timestamp.isFinite, segment.timestamp >= 0, segment.duration.isFinite, segment.duration >= 0,
        (segment.timestamp + segment.duration).isFinite, range.location >= 0, range.length > 0,
        range.location <= formatted.length, range.length <= formatted.length - range.location,
        index == 0 || segment.timestamp >= segments[index - 1].timestamp else { return fallback("invalid_timing_or_range") }
      let end = index + 1 < segments.count ? segments[index + 1].range.location : formatted.length
      guard end >= NSMaxRange(range), end <= formatted.length else { return fallback("invalid_range") }
      let text = formatted.substring(with: NSRange(location: range.location, length: end - range.location))
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { return fallback("empty_segment") }
      next.append(Part(timestamp: segment.timestamp, end: segment.timestamp + segment.duration, text: text))
    }
    let first = next[0].timestamp
    let prefix = parts.prefix { $0.timestamp < first - 0.0001 && $0.end <= first + 0.0001 }
    guard prefix.count + next.count <= 2048 else { return fallback("unbounded_accumulation") }
    parts = Array(prefix) + next
    timeUsable = true; fallbackReason = nil; heldResult = false
    let text = parts.map(\.text).joined(separator: " ")
    fullWordCount = Self.wordCount(text)
    return text
  }
  private static func wordCount(_ text: String) -> Int {
    text.split(whereSeparator: { $0.isWhitespace }).count
  }
}

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
    // Keep the intention until a recognition request really exists. A
    // transient availability failure must not consume the only wake-up.
    retryAfter = now + 0.25
    return true
  }
  mutating func started() { awaitingActivity = false }
  mutating func waitForAvailability(now: Double) {
    awaitingActivity = true; retryAfter = now + 0.5
  }
  mutating func noteResult() { consecutiveFailures = 0 }
  private func hasRecentActivity(now: Double) -> Bool {
    lastActivityAt.map { now >= $0 && now - $0 <= 2 } ?? false
  }
  mutating func waitAfterEmptyFinal(now: Double) -> Bool {
    // Room noise does not justify repeatedly creating empty tasks with no
    // cooldown. The next actual audio window can resume the reader once.
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
    awaitingActivity = false // The scheduled retry owns this recovery attempt.
    let delay = 0.25 * Double(consecutiveFailures)
    retryAfter = now + delay
    return .retry(after: delay)
  }
}
