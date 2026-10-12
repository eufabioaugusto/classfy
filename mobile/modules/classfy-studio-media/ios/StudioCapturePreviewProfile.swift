import Foundation

/// The display/network proxy is independent of the MovieFileOutput master.
/// Keep 4K capture off the GPU/real-time encoder and never enlarge a 720p source.
enum StudioCapturePreviewProfile {
  static let maxWidth = 1920
  static let maxHeight = 1080
  static let maxFPS = 30

  static func dimensions(sourceWidth: Int, sourceHeight: Int, portrait: Bool) -> (width: Int, height: Int) {
    let longEdge = max(sourceWidth, sourceHeight), shortEdge = min(sourceWidth, sourceHeight)
    let width = longEdge >= maxWidth && shortEdge >= maxHeight ? maxWidth : 1280
    let height = width == maxWidth ? maxHeight : 720
    return portrait ? (height, width) : (width, height)
  }

  static func timestampNanoseconds(seconds: Double) -> Int64? {
    let nanoseconds = seconds * 1_000_000_000
    guard seconds.isFinite, seconds >= 0, nanoseconds.isFinite,
      nanoseconds < Double(Int64.max) else { return nil }
    return Int64(nanoseconds)
  }
}

/// One pending frame, rather than an FIFO whose latency grows under load.
/// The owner protects this mailbox with its frame lock.
struct StudioRemotePreviewMailbox<Frame> {
  typealias Ticket = (frame: Frame, epoch: Int)
  private var pending: Ticket?
  private(set) var epoch = 0
  var isEmpty: Bool { pending == nil }
  mutating func replace(with frame: Frame) { pending = (frame, epoch) }
  mutating func take() -> Frame? { takeTicket()?.frame }
  mutating func takeTicket() -> Ticket? { let latest = pending; pending = nil; return latest }
  func isCurrent(_ ticketEpoch: Int) -> Bool { ticketEpoch == epoch }
  mutating func clear() { pending = nil; epoch += 1 }
}

struct StudioRemotePreviewFrameGate {
  private var lastTimestamp: Int64?
  private var fps: Int
  init(fps: Int) { self.fps = max(1, min(StudioCapturePreviewProfile.maxFPS, fps)) }
  mutating func setFPS(_ fps: Int) {
    // A profile change keeps the same published track and timestamp domain.
    // Resetting this value would admit frames from before the reconfiguration.
    self.fps = max(1, min(StudioCapturePreviewProfile.maxFPS, fps))
  }
  mutating func accept(_ timestamp: Int64) -> Bool {
    guard timestamp >= 0 else { return false }
    if let lastTimestamp {
      // Small capture-clock jitter must not cut a 30fps feed down to 15fps.
      let minimumInterval = Int64(900_000_000 / fps)
      guard timestamp > lastTimestamp, timestamp - lastTimestamp >= minimumInterval else { return false }
    }
    lastTimestamp = timestamp
    return true
  }
}
