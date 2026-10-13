import Foundation

/// A GPU completion belongs to one grade revision and one capture format.
/// Cancellation/timeout settle the request once; later frames cannot revive it.
final class StudioCaptureEffectConfirmation {
  let revision: Int
  let generation: Int
  private(set) var settled = false
  private let requiresRemote: Bool
  private var localReady = false
  private var remoteReady = false

  init(revision: Int, generation: Int, requiresRemote: Bool = false) {
    self.revision = revision; self.generation = generation
    self.requiresRemote = requiresRemote
  }

  func acceptFrame(revision: Int, generation: Int, remote: Bool = false) -> Bool {
    guard !settled, revision == self.revision, generation == self.generation else { return false }
    if remote { remoteReady = true } else { localReady = true }
    guard localReady, !requiresRemote || remoteReady else { return false }
    settled = true
    return true
  }

  @discardableResult func cancel() -> Bool {
    guard !settled else { return false }
    settled = true
    return true
  }
}
