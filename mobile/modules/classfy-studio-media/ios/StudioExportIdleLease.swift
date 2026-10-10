import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Reference-counted ownership of the export's idle-timer override. A nested
/// export cannot restore the screen timer while another export is still alive.
@MainActor
final class StudioExportIdleLease {
  private let read: () -> Bool
  private let write: (Bool) -> Void
  private var owners = Set<UUID>()
  private var original = false
  init(read: @escaping () -> Bool, write: @escaping (Bool) -> Void) {
    self.read = read; self.write = write
  }
  func begin() -> UUID {
    if owners.isEmpty { original = read(); write(true) }
    let token = UUID(); owners.insert(token); return token
  }
  func end(_ token: UUID) {
    guard owners.remove(token) != nil, owners.isEmpty else { return }
    write(original)
  }
  #if canImport(UIKit)
  static let shared = StudioExportIdleLease(read: { UIApplication.shared.isIdleTimerDisabled },
    write: { UIApplication.shared.isIdleTimerDisabled = $0 })
  #endif
}
