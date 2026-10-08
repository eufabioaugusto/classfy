import Foundation

/// A GPU completion belongs to one grade revision and one capture format.
/// Cancellation/timeout settle the request once; later frames cannot revive it.
final class StudioCaptureEffectConfirmation {
  let revision: Int
  let generation: Int
  private(set) var settled = false

  init(revision: Int, generation: Int) {
    self.revision = revision; self.generation = generation
  }

  func acceptFrame(revision: Int, generation: Int) -> Bool {
    guard !settled, revision == self.revision, generation == self.generation else { return false }
    settled = true
    return true
  }

  @discardableResult func cancel() -> Bool {
    guard !settled else { return false }
    settled = true
    return true
  }
}
