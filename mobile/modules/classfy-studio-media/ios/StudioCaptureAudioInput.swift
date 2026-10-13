import Foundation

struct StudioCaptureAudioInputPort: Equatable {
  let id: String
  let name: String
  let type: String
  var json: [String: String] { ["id": id, "name": name, "type": type] }
}

enum StudioCaptureAudioInputError: LocalizedError {
  case inactive, unavailable, busy, cancelled, timeout
  var errorDescription: String? {
    switch self {
    case .inactive: return "Abra a câmera para escolher o microfone do iPhone."
    case .unavailable: return "Este microfone não está disponível no iPhone. Escolha outra entrada ou Automático."
    case .busy: return "Finalize o take e aguarde a câmera antes de trocar o microfone."
    case .cancelled: return "A escolha do microfone foi cancelada. Abra a câmera para tentar novamente."
    case .timeout: return "O iPhone não confirmou áudio do microfone escolhido. Confira a conexão ou use Automático."
    }
  }
}

/// Confined to the capture queue. A requested port is confirmed only by a new
/// PCM observation on the effective route; setting a preference is not an ACK.
final class StudioCaptureAudioInputSelection {
  struct Request {
    let id: UUID
    let generation: Int
    let inputId: String?
    let after: Double
  }
  private(set) var pending: Request?
  private(set) var requestedId: String?
  private(set) var hasSelection = false
  private var available: [StudioCaptureAudioInputPort] = []
  private var current: StudioCaptureAudioInputPort?
  private var preferredId: String?
  private var active = false
  private var generation = -1
  private var sampleTime: Double?
  private var sampleInputId: String?
  private var warning: String?
  private var after = 0.0
  static let freshness = 0.35

  func observe(available: [StudioCaptureAudioInputPort], current: StudioCaptureAudioInputPort?,
               preferredId: String?, active: Bool, generation: Int, now: Double, reason: String? = nil) {
    let changed = self.generation != generation || self.current?.id != current?.id || self.active != active
    if changed || !active {
      sampleTime = nil; sampleInputId = nil
      // A buffer queued before the newly observed route must not inherit its
      // UID when processed later, even when it was captured after begin().
      if now.isFinite { after = max(after, now) }
    }
    self.available = available; self.current = current; self.preferredId = preferredId
    self.active = active; self.generation = generation
    if reason == "inputLost" {
      warning = "Microfone desconectado. Confira a entrada em uso no iPhone."
    } else if let requestedId, !available.contains(where: { $0.id == requestedId }) {
      warning = "O microfone escolhido não está disponível. Escolha outra entrada ou Automático."
    } else if let requestedId, active, pending == nil, current?.id != requestedId {
      warning = "A entrada de áudio mudou no iPhone. Confira o microfone em uso antes de continuar."
    }
  }

  func begin(inputId: String?, now: Double) throws -> Request {
    guard active, now.isFinite else { throw StudioCaptureAudioInputError.inactive }
    guard pending == nil else { throw StudioCaptureAudioInputError.busy }
    if let inputId {
      guard !inputId.isEmpty, inputId.utf8.count <= 512,
        available.contains(where: { $0.id == inputId }) else { throw StudioCaptureAudioInputError.unavailable }
    }
    let request = Request(id: UUID(), generation: generation, inputId: inputId, after: now)
    pending = request; requestedId = inputId; hasSelection = true; after = now
    sampleTime = nil; sampleInputId = nil; warning = nil
    return request
  }

  @discardableResult
  func receivePCM(inputId: String, generation: Int, hostPTS: Double, now: Double) -> Bool {
    guard active, generation == self.generation, current?.id == inputId,
      hostPTS.isFinite, now.isFinite, hostPTS >= after, hostPTS <= now + 0.05,
      now - hostPTS <= Self.freshness,
      sampleTime.map({ hostPTS >= $0 }) != false else { return false }
    sampleTime = hostPTS; sampleInputId = inputId
    return true
  }

  func confirmed(now: Double) -> Bool {
    guard active, let current, let sampleTime, sampleInputId == current.id,
      now.isFinite, now - sampleTime <= Self.freshness, sampleTime <= now + 0.05,
      requestedId == nil || requestedId == current.id else { return false }
    return true
  }

  @discardableResult
  func finish(_ requestId: UUID, now: Double) -> Bool {
    guard let pending, pending.id == requestId, pending.generation == generation,
      confirmed(now: now) else { return false }
    self.pending = nil; warning = nil
    return true
  }

  @discardableResult
  func fail(_ requestId: UUID, error: Error) -> Bool {
    guard pending?.id == requestId else { return false }
    pending = nil; sampleTime = nil; sampleInputId = nil; warning = error.localizedDescription
    return true
  }

  func invalidate() {
    pending = nil; active = false; sampleTime = nil; sampleInputId = nil
  }

  func snapshot(now: Double) -> [String: Any] {
    ["version": 1, "available": available.map(\.json), "preferredId": preferredId as Any? ?? NSNull(),
     "current": active ? current?.json as Any? ?? NSNull() : NSNull(),
     "confirmed": confirmed(now: now), "selecting": pending != nil, "warning": warning as Any? ?? NSNull()]
  }
}
