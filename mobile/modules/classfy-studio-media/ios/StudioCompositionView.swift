import AVFoundation
import CoreImage
import Foundation

struct StudioCompositionReplacementGate {
  struct Lease { let epoch: Int; let generation: Int }
  private var epoch = 0
  func lease(generation: Int) -> Lease { Lease(epoch: epoch, generation: generation) }
  mutating func invalidate() { epoch += 1 }
  func owns(_ lease: Lease, generation: Int) -> Bool { lease.epoch == epoch && lease.generation == generation }
}

/// Fabric reapplies the entire prop dictionary when any prop changes. A bool
/// already received from JS is not a new Play/Pause command: EOF, background
/// and imperative commands can have changed the native state since then.
struct StudioCompositionPausePropGate {
  private var lastValue: Bool?
  mutating func accept(_ value: Bool) -> Bool {
    guard lastValue != value else { return false }
    lastValue = value
    return true
  }
}

/// A recipe revision can reuse an item. Observer ownership changes only when
/// its registration/item is replaced, so a queued old callback cannot leak
/// into the next item while a visual/audio update keeps its observers alive.
@MainActor
final class StudioCompositionItemObservers {
  private weak var item: AVPlayerItem?
  private weak var player: AVPlayer?
  private var epoch = 0
  private var status: NSKeyValueObservation?
  private var end: NSObjectProtocol?

  func observe(item: AVPlayerItem, player: AVPlayer,
               onStatus: @escaping @MainActor (AVPlayerItem) -> Void,
               onEnd: @escaping @MainActor (AVPlayerItem) -> Void) {
    invalidate()
    self.item = item; self.player = player
    let epoch = self.epoch
    status = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
      Task { @MainActor [weak self, weak item] in
        guard let self, let item, self.owns(item, epoch: epoch) else { return }
        onStatus(item)
      }
    }
    end = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self, weak item] _ in
      Task { @MainActor [weak self, weak item] in
        guard let self, let item, self.owns(item, epoch: epoch) else { return }
        onEnd(item)
      }
    }
  }

  private func owns(_ item: AVPlayerItem, epoch: Int) -> Bool {
    self.epoch == epoch && self.item === item && player?.currentItem === item
  }
  static func isAtEnd(seconds: Double, duration: Double, replayPending: Bool) -> Bool {
    !replayPending && seconds.isFinite && duration.isFinite && duration > 0 && seconds >= duration - 1 / 30.0
  }
  func invalidate() {
    epoch += 1; item = nil; player = nil
    status?.invalidate(); status = nil
    if let end { NotificationCenter.default.removeObserver(end) }
    end = nil
  }
  deinit {
    status?.invalidate()
    if let end { NotificationCenter.default.removeObserver(end) }
  }
}

/// Confirms the pixels produced by the current recipe, not merely a completed
/// seek at a timestamp which AVPlayer may satisfy from its older cache.
@MainActor
final class StudioCompositionFrameOutput {
  let output: AVPlayerItemVideoOutput
  private weak var item: AVPlayerItem?
  private var confirmed: (revision: String, seconds: Double, buffer: CVPixelBuffer)?

  init(item: AVPlayerItem) {
    self.item = item
    output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    item.add(output)
  }
  func prepareForChange(at seconds: Double) {
    _ = output.copyPixelBuffer(forItemTime: CMTime(seconds: seconds, preferredTimescale: 120_000), itemTimeForDisplay: nil)
    confirmed = nil
    output.requestNotificationOfMediaDataChange(withAdvanceInterval: 0)
  }
  func clear() { confirmed = nil }
  func frame(at seconds: Double, revision: String) -> CVPixelBuffer? {
    let target = CMTime(seconds: seconds, preferredTimescale: 120_000)
    // An exact seek may display the preceding frame at the composition's
    // cadence. A fixed 30fps window incorrectly rejects valid 24fps frames.
    let duration = item?.videoComposition?.frameDuration.seconds ?? .nan
    let tolerance = (duration.isFinite && duration > 0 ? duration : 1 / 30.0) + 0.001
    var displayed = CMTime.invalid
    if let buffer = output.copyPixelBuffer(forItemTime: target, itemTimeForDisplay: &displayed),
      let receipt = CVBufferGetAttachment(buffer, StudioRecipeCompositor.visualRevisionKey, nil)?.takeUnretainedValue() as? String,
      receipt == revision, displayed.seconds.isFinite, abs(displayed.seconds - seconds) <= tolerance {
      confirmed = (revision, seconds, buffer)
      return buffer
    }
    if let confirmed, confirmed.revision == revision, abs(confirmed.seconds - seconds) < 1 / 120_000 { return confirmed.buffer }
    return nil
  }
}

/** Readiness precedes the first exact seek; a cancelled seek is never a frame. */
@MainActor
enum StudioCompositionInitialFrame {
  static func prime(player: AVPlayer, item: AVPlayerItem, seconds: Double,
                    visualRevision: String? = nil, frameOutput: StudioCompositionFrameOutput? = nil,
                    isCurrent: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(15)
    while item.status == .unknown {
      try Task.checkCancellation()
      guard isCurrent(), player.currentItem === item else { throw StudioRecipeError.cancelled }
      guard Date() < deadline else { throw StudioRecipeError.invalid("A prévia demorou para preparar o primeiro quadro. Tente abrir o projeto novamente.") }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    try Task.checkCancellation()
    guard isCurrent(), player.currentItem === item else { throw StudioRecipeError.cancelled }
    guard item.status == .readyToPlay else {
      throw item.error ?? StudioRecipeError.invalid("Não foi possível preparar o primeiro quadro desta edição.")
    }
    let finished = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
      player.seek(to: CMTime(seconds: seconds, preferredTimescale: 120_000), toleranceBefore: .zero, toleranceAfter: .zero) {
        continuation.resume(returning: $0)
      }
    }
    try Task.checkCancellation()
    guard isCurrent(), player.currentItem === item else { throw StudioRecipeError.cancelled }
    guard finished else { throw StudioRecipeError.invalid("O primeiro quadro da prévia foi interrompido. Tente abrir o projeto novamente.") }
    if let visualRevision, let frameOutput {
      while frameOutput.frame(at: seconds, revision: visualRevision) == nil {
        try Task.checkCancellation()
        guard isCurrent(), player.currentItem === item else { throw StudioRecipeError.cancelled }
        guard Date() < deadline else {
          throw StudioRecipeError.invalid("A prévia não confirmou o quadro atualizado. Tente abrir o projeto novamente.")
        }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
    }
  }
}

#if canImport(UIKit) && canImport(ExpoModulesCore)
import ExpoModulesCore
import UIKit

// One AVPlayerItem owns the entire timeline. Selecting an editing layer never
// replaces its source or seeks. Original-frame inspection is a separate surface
// and token stream, so trimming cannot move the playback cursor underneath it.
@MainActor
final class StudioCompositionView: ExpoView {
  let onPlaybackState = EventDispatcher()
  let onError = EventDispatcher()
  private let engine = StudioRecipeEngine()
  private let player = AVPlayer()
  private let playerLayer = AVPlayerLayer()
  private let replacementFrame = UIImageView()
  private var replacementPosition: Double?
  private var replacementGate = StudioCompositionReplacementGate()
  private var frameOutput: StudioCompositionFrameOutput?
  private let inspectedFrame = UIImageView()
  private let interactiveSurface = StudioCompositionInteractiveSurface()
  private var interactivePatch: StudioCompositionInteractionPatch?
  private var lastLiveSequence = -1
  private var interactiveHandoffGate = StudioCompositionHandoffGate()
  private var interactiveHandoff = false
  private var interactiveCanonicalRecipe: StudioRecipe?
  private var frozen: StudioRecipeFrozenFrame?
  private var frozenGeneration = -1
  private var frozenPosition = -1.0
  private var frozenTask: Task<Void, Never>?
  private var frozenRequest = 0
  private var prepared: StudioPreparedRecipe?
  private var recipeJSON = ""
  private var revision = ""
  private var paused = true
  private var pausePropGate = StudioCompositionPausePropGate()
  private var loading = false
  private var buildGeneration = 0
  private var recipeBuildPending = false
  private var commandToken = 0
  private var disposed = false
  private var sourceInspection: (clipId: String, seconds: Double)?
  private struct PendingSeek {
    let seconds: Double
    let token: Int
    let continuation: CheckedContinuation<[String: Any], Error>
  }
  private var pendingSeek: PendingSeek?
  private var initializingItem: AVPlayerItem?
  private var buildTask: Task<Void, Never>?
  private var frameTask: Task<CGImage, Error>?
  private var replayTask: Task<Void, Never>?
  private var replayGeneration = 0
  private var replayPending = false
  private var periodicObserver: Any?
  private let itemObservers = StudioCompositionItemObservers()
  private var backgroundObserver: NSObjectProtocol?
  private var interruptionObserver: NSObjectProtocol?
  private var captureObserver: NSObjectProtocol?
  private let captureSessions = NSHashTable<AVCaptureSession>.weakObjects()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black; clipsToBounds = true
    player.actionAtItemEnd = .pause
    playerLayer.player = player; playerLayer.videoGravity = .resizeAspect
    layer.addSublayer(playerLayer)
    replacementFrame.contentMode = .scaleAspectFit; replacementFrame.backgroundColor = .black
    replacementFrame.isHidden = true; replacementFrame.isUserInteractionEnabled = false
    addSubview(replacementFrame)
    inspectedFrame.contentMode = .scaleAspectFit; inspectedFrame.backgroundColor = .black
    inspectedFrame.isHidden = true; inspectedFrame.isUserInteractionEnabled = false
    addSubview(inspectedFrame)
    if let surface = interactiveSurface {
      addSubview(surface.view)
      surface.onFailure = { [weak self] error in
        self?.cancelInteractive(); self?.fail(error, code: "E_STUDIO_INTERACTION")
      }
    }
    periodicObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 15), queue: .main) { [weak self] _ in
      Task { @MainActor [weak self] in self?.publish() }
    }
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor [weak self] in self?.cancelInteractive(); self?.clearReplacementFrame(); self?.setPaused(true) }
    }
    interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor [weak self] in self?.setPaused(true) }
    }
    captureObserver = NotificationCenter.default.addObserver(forName: .AVCaptureSessionDidStartRunning, object: nil, queue: .main) { [weak self] notice in
      guard let session = notice.object as? AVCaptureSession else { return }
      Task { @MainActor [weak self] in
        guard let self, !self.disposed else { return }
        self.captureSessions.add(session); self.setPaused(true)
      }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin(); CATransaction.setDisableActions(true)
    playerLayer.frame = bounds; replacementFrame.frame = bounds; inspectedFrame.frame = bounds; interactiveSurface?.view.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      cancelInteractive()
      clearReplacementFrame()
      player.pause(); frameTask?.cancel(); cancelReplay()
      sourceInspection = nil; inspectedFrame.isHidden = true
    }
  }

  func setRevision(_ value: String) { revision = value }

  func setLiveVisualJSON(_ json: String) {
    guard !disposed, let patch = try? StudioCompositionInteractionPatch.decode(json),
      patch.sequence > lastLiveSequence else { return }
    lastLiveSequence = patch.sequence
    if !patch.active {
      guard interactivePatch?.operationId == patch.operationId else { return }
      if patch.finish == "commit" {
        interactivePatch = interactiveCanonicalRecipe.map(patch.withCanonicalTransform) ?? patch
        interactiveHandoffGate.acknowledgeCommit(operationId: patch.operationId)
        if let prepared, interactivePatch?.matches(prepared.recipe) == true, interactiveHandoffGate.canRevealCanonical, initializingItem == nil, !loading { cancelInteractive() }
        else if let frozen, let current = interactivePatch { interactiveSurface?.update(frozen, patch: current) }
      } else { cancelInteractive() }
      return
    }
    if interactivePatch?.operationId == patch.operationId && interactiveHandoff {
      // Late gesture samples cannot replace the canonical pose received on
      // Fabric. A terminal phase still belongs to the same live operation.
      if patch.phase == "committing", let recipe = interactiveCanonicalRecipe { interactivePatch = patch.withCanonicalTransform(recipe) }
      return
    }
    guard window != nil, UIApplication.shared.applicationState == .active,
      interactiveSurface != nil, patch.revision == revision, !loading,
      sourceInspection == nil, let prepared,
      prepared.layers.contains(where: { $0.clip.id == patch.clipId }) else { return }
    if interactivePatch?.operationId != patch.operationId {
      cancelInteractive(keepFrozen: true)
      paused = true; player.pause(); cancelReplay()
    }
    interactivePatch = patch
    let raw = player.currentTime().seconds
    let at = max(0, min(raw.isFinite ? raw : 0, prepared.recipe.durationSeconds - 1 / 120_000))
    if frozenGeneration == buildGeneration, abs(frozenPosition - at) < 1 / 120_000, let frozen {
      interactiveSurface?.update(frozen, patch: patch)
    } else { prepareInteractiveFrame(prepared, at: at) }
  }

  private func cancelInteractive(keepFrozen: Bool = false) {
    interactivePatch = nil; interactiveSurface?.clear()
    interactiveHandoffGate.reset()
    interactiveHandoff = false
    interactiveCanonicalRecipe = nil
    if keepFrozen { return }
    frozenRequest += 1; frozenTask?.cancel(); frozenTask = nil
    frozen = nil; frozenGeneration = -1; frozenPosition = -1
  }

  private func warmInteractiveFrame() {
    guard interactivePatch == nil, paused, !loading, player.rate == 0,
      initializingItem == nil, !disposed, window != nil,
      UIApplication.shared.applicationState == .active, sourceInspection == nil,
      interactiveSurface != nil, let prepared else { return }
    let raw = player.currentTime().seconds
    let at = max(0, min(raw.isFinite ? raw : 0, prepared.recipe.durationSeconds - 1 / 120_000))
    prepareInteractiveFrame(prepared, at: at)
  }

  private func prepareInteractiveFrame(_ prepared: StudioPreparedRecipe, at seconds: Double) {
    if frozenGeneration == buildGeneration && abs(frozenPosition - seconds) < 1 / 120_000 && (frozen != nil || frozenTask != nil) { return }
    frozenRequest += 1; let request = frozenRequest, generation = buildGeneration
    frozenTask?.cancel(); frozen = nil; frozenGeneration = generation; frozenPosition = seconds
    let engine = self.engine
    frozenTask = Task { [weak self] in
      let worker = Task.detached(priority: .userInitiated) { try await engine.frozenFrame(prepared, at: seconds).processed() }
      do {
        let frame = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
        try Task.checkCancellation()
        guard let self, !disposed, generation == buildGeneration, request == frozenRequest, window != nil else { return }
        frozen = frame; frozenTask = nil
        if let patch = interactivePatch { interactiveSurface?.update(frame, patch: patch) }
      } catch {
        guard let self, request == frozenRequest, generation == buildGeneration, !Task.isCancelled else { return }
        frozenTask = nil; frozenGeneration = -1; frozenPosition = -1
        if interactivePatch != nil { cancelInteractive(); fail(error, code: "E_STUDIO_INTERACTION") }
      }
    }
  }

  func setRecipeJSON(_ value: String) {
    guard !disposed, value != recipeJSON else { return }
    let cachedFrame = frozenGeneration == buildGeneration ? frozen : nil
    recipeJSON = value; buildGeneration += 1
    recipeBuildPending = true
    // A successful write replaces the canonical recipe once. Keep its live
    // Metal frame until that exact pose has been primed in AVPlayerLayer.
    let nextRecipe = try? StudioRecipeEngine.decode(value)
    let handingOff = interactivePatch.map { patch in
      guard let previous = prepared?.recipe, let nextRecipe else { return false }
      return patch.preservesComposition(previous, nextRecipe)
    } ?? false
    if handingOff, let nextRecipe, let patch = interactivePatch {
      interactiveHandoffGate.begin(operationId: patch.operationId,
        committed: patch.phase == "idle" && patch.finish == "commit")
      interactiveHandoff = true
      interactiveCanonicalRecipe = nextRecipe
      interactivePatch = interactivePatch?.withCanonicalTransform(nextRecipe)
      if let frozen, let patch = interactivePatch { interactiveSurface?.update(frozen, patch: patch) }
    }
    if !handingOff { cancelInteractive() }
    frozenTask?.cancel(); frozenTask = nil; frozenRequest += 1
    let generation = buildGeneration
    let oldPosition = pendingSeek?.seconds ?? max(0, player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0)
    buildTask?.cancel(); frameTask?.cancel(); cancelReplay()
    sourceInspection = nil; inspectedFrame.isHidden = true
    // A pose/style update keeps a ready decoder and the displayed frame. Do
    // not flash a loading state for every gesture draft; full rebuilds below
    // publish loading only after the visual fast path has been ruled out.
    // If this supersedes a full rebuild, its ready *old* item was deliberately
    // paused. Keep that loading state until the latest worker can resume it.
    loading = loading || prepared == nil || player.currentItem?.status != .readyToPlay
    // A ready visual update must keep its actual rate: publishing a temporary
    // pause with loading=false would turn a running preview into a user pause
    // in the JS state adapter before the worker can finish.
    if loading { player.pause(); publish() }
    // Prop updates are batched before this task resumes on main; revision has
    // therefore been set when a result is emitted, regardless of prop order.
    buildTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if generation == buildGeneration {
          recipeBuildPending = false
          drainPendingSeek()
        }
      }
      do {
        await Task.yield()
        try Task.checkCancellation()
        if let previous = self.prepared {
          // Immutable prepared snapshots can be read off-main. The worker
          // builds new visual objects; only assigning the player stays on main.
          let worker = Task.detached(priority: .userInitiated) { [engine = self.engine] in
            try engine.updateVisuals(previous, recipeJSON: value)
          }
          let updated = try await withTaskCancellationHandler(operation: {
            try await worker.value
          }, onCancel: { worker.cancel() })
          try Task.checkCancellation()
          guard generation == buildGeneration, !disposed else { return }
          if let updated, let item = player.currentItem, item.status == .readyToPlay {
            let pictureChanged = updated.videoComposition !== previous.videoComposition
            if pictureChanged && paused && !handingOff {
              try await holdReplacementFrame(previous, cached: cachedFrame, generation: generation)
            }
            guard generation == buildGeneration, !disposed, !Task.isCancelled else { return }
            self.prepared = updated
            if pictureChanged {
              frameOutput?.prepareForChange(at: max(0, player.currentTime().seconds))
              item.videoComposition = updated.videoComposition
            }
            if updated.audioMix !== previous.audioMix { item.audioMix = updated.audioMix }
            if initializingItem === item || handingOff || pictureChanged && paused {
              initializingItem = item
              let raw = player.currentTime().seconds
              let position = min(pendingSeek?.seconds ?? (raw.isFinite ? max(0, raw) : oldPosition),
                max(0, updated.recipe.durationSeconds - 1 / 30.0))
              try await primeInitialFrame(item: item, seconds: position, generation: generation)
            }
            loading = false
            clearReplacementFrame()
            if handingOff { completeInteractiveHandoff() }
            if !paused && window != nil { startPlayback() }
            drainPendingSeek(); publish(); return
          }
        }
        // Full rebuilds retain the pause/loading behavior. Capture the cursor
        // now, since playback may have advanced while testing the fast path.
        let rawPosition = player.currentTime().seconds
        let rebuildPosition = pendingSeek?.seconds ?? (rawPosition.isFinite ? max(0, rawPosition) : oldPosition)
        player.pause()
        if !loading { loading = true; publish() }
        if paused, let previous = self.prepared, !handingOff {
          try await holdReplacementFrame(previous, cached: cachedFrame, generation: generation)
        }
        let prepared = try await engine.prepare(recipeJSON: value)
        try Task.checkCancellation()
        guard generation == buildGeneration else { return }
        self.prepared = prepared
        let item = prepared.playerItem()
        frameOutput = StudioCompositionFrameOutput(item: item)
        initializingItem = item
        itemObservers.observe(item: item, player: player, onStatus: { [weak self] item in
            guard let self, !self.disposed else { return }
            if item.status == .failed {
              self.loading = false; self.paused = true; self.player.pause()
              self.fail(item.error ?? StudioRecipeError.invalid("Não foi possível abrir esta edição."))
            } else if item.status == .readyToPlay {
              // The decoder becoming ready can precede the first composed
              // frame. Keep commands queued until the exact seek completes.
              if !self.recipeBuildPending && self.initializingItem !== item && !self.replayPending {
                self.loading = false
                if !self.paused && self.window != nil { self.startPlayback() }
              }
              self.publish()
            }
        }, onEnd: { [weak self] _ in
            guard let self, !self.disposed, let prepared = self.prepared,
              StudioCompositionItemObservers.isAtEnd(seconds: self.player.currentTime().seconds,
                duration: prepared.recipe.durationSeconds, replayPending: self.replayPending) else { return }
            self.setPaused(true)
        })
        player.replaceCurrentItem(with: item)
        let position = min(rebuildPosition, max(0, prepared.recipe.durationSeconds - 1 / 30.0))
        // Even a paused item at zero must request its first composed frame.
        // Merely becoming ready does not prime AVPlayerLayer on every device.
        try await primeInitialFrame(item: item, seconds: position, generation: generation)
        guard generation == buildGeneration, !Task.isCancelled, !disposed,
              player.currentItem === item else { return }
        loading = item.status != .readyToPlay
        clearReplacementFrame()
        if handingOff { completeInteractiveHandoff() }
        if !paused && !loading && window != nil { startPlayback() }
        drainPendingSeek()
        publish()
      } catch {
        guard generation == buildGeneration, !Task.isCancelled else { return }
        loading = false; prepared = nil; initializingItem = nil
        itemObservers.invalidate(); player.replaceCurrentItem(with: nil)
        cancelInteractive()
        clearReplacementFrame()
        pendingSeek?.continuation.resume(throwing: error); pendingSeek = nil
        fail(error)
      }
    }
  }

  // A paused composition swap invalidates AVPlayerLayer's current drawable.
  // Hold the exact old composed frame until the new exact seek confirms its
  // compositor frame, rather than hiding all layers or waiting a fixed delay.
  private func holdReplacementFrame(_ previous: StudioPreparedRecipe, cached: StudioRecipeFrozenFrame?, generation: Int) async throws {
    guard window != nil, UIApplication.shared.applicationState == .active, paused,
      player.currentItem?.status == .readyToPlay else { return }
    let raw = player.currentTime().seconds
    let seconds = max(0, min(raw.isFinite ? raw : 0, previous.recipe.durationSeconds - 1 / 120_000))
    let lease = replacementGate.lease(generation: generation)
    let actualBuffer = previous.visualRevision.flatMap { frameOutput?.frame(at: seconds, revision: $0) }
    let currentCache = cached.flatMap { abs($0.seconds - seconds) < 1 / 120_000 ? $0 : nil }
    let engine = self.engine
    let worker = Task.detached(priority: .userInitiated) { () async throws -> CGImage in
      if let actualBuffer {
        let image = CIImage(cvPixelBuffer: actualBuffer, options: [.colorSpace: StudioEffectRenderer.outputColorSpace])
        guard let result = previous.renderer.context.createCGImage(image, from: image.extent,
          format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace) else {
          throw StudioRecipeError.invalid("Não foi possível preservar o quadro desta edição.")
        }
        return result
      }
      if let currentCache {
        let image = try currentCache.image()
        guard let result = previous.renderer.context.createCGImage(image, from: CGRect(origin: .zero, size: previous.recipe.size),
          format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace) else {
          throw StudioRecipeError.invalid("Não foi possível preservar o quadro desta edição.")
        }
        return result
      }
      return try await engine.frame(previous, at: seconds)
    }
    let image = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
    try Task.checkCancellation()
    guard replacementGate.owns(lease, generation: buildGeneration), !disposed, window != nil, paused,
      UIApplication.shared.applicationState == .active else { return }
    replacementFrame.image = UIImage(cgImage: image); replacementFrame.isHidden = false
    replacementPosition = seconds
  }

  private func clearReplacementFrame() {
    replacementGate.invalidate()
    replacementFrame.isHidden = true; replacementFrame.image = nil; replacementPosition = nil
  }

  func setPausedProp(_ value: Bool) {
    guard !disposed, pausePropGate.accept(value) else { return }
    setPaused(value)
  }

  func setPaused(_ value: Bool) {
    guard !disposed else { return }
    cancelReplay()
    paused = value
    if value { player.pause() }
    else if !loading, window != nil, sourceInspection == nil, let prepared {
      cancelInteractive()
      let position = player.currentTime().seconds
      if position.isFinite && position >= prepared.recipe.durationSeconds - 1 / 30.0 {
        let generation = buildGeneration, token = commandToken, item = player.currentItem
        let replay = replayGeneration
        replayPending = true
        replayTask = Task { [weak self] in
          guard let self else { return }
          defer {
            // An older seek must not clear a newer replay's loading state.
            if self.replayGeneration == replay {
              self.replayPending = false; self.replayTask = nil; self.publish()
            }
          }
          let finished = await self.seekPlayer(0)
          guard !Task.isCancelled, !self.disposed, !self.paused, self.window != nil,
                self.sourceInspection == nil, self.buildGeneration == generation,
                self.commandToken == token, self.replayGeneration == replay,
                self.player.currentItem === item, finished else { return }
          self.startPlayback(); self.publish()
        }
      } else { startPlayback() }
    }
    publish()
  }

  private func completeInteractiveHandoff() {
    guard let patch = interactivePatch else { return }
    interactiveHandoffGate.prime(operationId: patch.operationId)
    if interactiveHandoffGate.canRevealCanonical { cancelInteractive() }
  }

  private func cancelReplay() {
    replayGeneration += 1; replayTask?.cancel(); replayTask = nil; replayPending = false
  }

  private func startPlayback() {
    guard !disposed, !paused, !loading, prepared != nil, window != nil,
          UIApplication.shared.applicationState == .active, sourceInspection == nil else { return }
    guard !captureSessions.allObjects.contains(where: { $0.isRunning }) else {
      paused = true; player.pause(); publish(); return
    }
    do {
      // Expo's active voiceover recorder owns playAndRecord. Changing that
      // category here stops its microphone; activating the same session lets
      // preview audio and recording coexist. After capture, movie playback
      // restores the category only when no recorder currently owns it.
      let audio = AVAudioSession.sharedInstance()
      if audio.category != .playAndRecord && (audio.category != .playback || audio.mode != .moviePlayback || !audio.categoryOptions.isEmpty) {
        try audio.setCategory(.playback, mode: .moviePlayback, options: [])
      }
      try audio.setActive(true)
      player.play()
    } catch {
      paused = true; player.pause()
      fail(StudioRecipeError.invalid("Não foi possível ativar o som da prévia. \(error.localizedDescription)"), code: "E_STUDIO_AUDIO_SESSION")
    }
  }

  private func claim(_ token: Int, preserveInteractive: Bool = false, preserveReplacement: Bool = false) throws {
    guard !disposed, token >= commandToken else { throw StudioRecipeError.cancelled }
    commandToken = token; frameTask?.cancel(); cancelReplay()
    if !preserveInteractive { cancelInteractive() }
    if !preserveReplacement { clearReplacementFrame() }
    // A restore/seek arriving during replacement must not cancel the only
    // request for the paused first frame. seekAsync queues the latest intent.
    if initializingItem == nil || player.currentItem !== initializingItem { player.currentItem?.cancelPendingSeeks() }
    if let pending = pendingSeek { pending.continuation.resume(throwing: StudioRecipeError.cancelled); pendingSeek = nil }
  }

  private func drainPendingSeek() {
    guard let pending = pendingSeek, prepared != nil, !loading, !recipeBuildPending, initializingItem == nil else { return }
    pendingSeek = nil
    Task { [weak self] in
      guard let self else { pending.continuation.resume(throwing: StudioRecipeError.cancelled); return }
      do { pending.continuation.resume(returning: try await performSeek(seconds: pending.seconds, token: pending.token)) }
      catch { pending.continuation.resume(throwing: error) }
    }
  }

  private func primeInitialFrame(item: AVPlayerItem, seconds: Double, generation: Int) async throws {
    try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: seconds,
      visualRevision: prepared?.visualRevision, frameOutput: frameOutput) { [weak self, weak item] in
      guard let self, let item else { return false }
      return !self.disposed && self.buildGeneration == generation && self.initializingItem === item
    }
    guard generation == buildGeneration, !disposed, initializingItem === item else { throw StudioRecipeError.cancelled }
    initializingItem = nil
  }

  private func seekPlayer(_ seconds: Double) async -> Bool {
    await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
      player.seek(to: CMTime(seconds: seconds, preferredTimescale: 120_000), toleranceBefore: .zero, toleranceAfter: .zero) { finished in
        continuation.resume(returning: finished)
      }
    }
  }

  func seekAsync(seconds: Double, token: Int) async throws -> [String: Any] {
    guard seconds.isFinite else { throw StudioRecipeError.invalid("Escolha um tempo válido da edição.") }
    // The editor restores its stationary anchor after a durable pose change.
    // It must not tear down the live frame or race the canonical first seek.
    let sameAnchor = interactivePatch != nil && abs(seconds - frozenPosition) <= 1 / 30.0 + 0.001
    let sameReplacementAnchor = replacementPosition.map { abs(seconds - $0) <= 1 / 30.0 + 0.001 } ?? false
    try claim(token, preserveInteractive: sameAnchor, preserveReplacement: sameReplacementAnchor)
    if loading || prepared == nil || recipeBuildPending || initializingItem != nil {
      return try await withCheckedThrowingContinuation { continuation in
        pendingSeek = PendingSeek(seconds: seconds, token: token, continuation: continuation)
      }
    }
    return try await performSeek(seconds: seconds, token: token)
  }

  private func performSeek(seconds: Double, token: Int) async throws -> [String: Any] {
    guard token == commandToken else { throw StudioRecipeError.cancelled }
    guard seconds.isFinite, let prepared else { throw StudioRecipeError.invalid("Aguarde a edição carregar para navegar.") }
    let generation = buildGeneration
    paused = true; player.pause(); sourceInspection = nil
    inspectedFrame.isHidden = true
    let target = max(0, min(seconds, max(0, prepared.recipe.durationSeconds - 1 / 30.0)))
    let finished = await seekPlayer(target)
    guard commandToken == token, generation == buildGeneration, finished else { throw StudioRecipeError.cancelled }
    publish(); return state()
  }

  func previewSourceFrameAsync(clipId: String, sourceSeconds: Double,
                               timelineSeconds: Double, token: Int) async throws -> [String: Any] {
    try claim(token)
    guard let prepared, sourceSeconds.isFinite, timelineSeconds.isFinite,
          let inspected = prepared.layers.first(where: { $0.clip.id == clipId && $0.clip.kind == "video" }) else {
      throw StudioRecipeError.invalid("Escolha um take de vídeo para inspecionar o corte.")
    }
    paused = true; player.pause()
    let generation = buildGeneration
    let base = Double(prepared.recipe.timebase)
    let clipStart = Double(inspected.clip.startTicks) / base
    let clipEnd = Double(inspected.clip.endTicks) / base
    let contextual = clipStart + (sourceSeconds - Double(inspected.clip.sourceStartTicks) / base)
      / inspected.clip.sourceSecondsPerTimelineSecond
    let at = max(clipStart, min(contextual, clipEnd - min(0.001, (clipEnd - clipStart) / 2)))
    let engine = self.engine
    let task = Task.detached(priority: .userInitiated) {
      try await engine.frame(prepared, at: at, sourceOverride: (clipId, sourceSeconds))
    }
    frameTask = task
    do {
      let image = try await task.value
      guard commandToken == token, generation == buildGeneration, window != nil else { throw StudioRecipeError.cancelled }
      sourceInspection = (clipId, sourceSeconds)
      inspectedFrame.image = UIImage(cgImage: image); inspectedFrame.isHidden = false
      publish(); return state()
    } catch {
      if commandToken == token && generation == buildGeneration && !(error is CancellationError) { fail(error) }
      throw error
    }
  }

  func restorePlaybackAsync(token: Int) async throws -> [String: Any] {
    try claim(token)
    sourceInspection = nil; inspectedFrame.image = nil; inspectedFrame.isHidden = true
    // Source inspection has never sought the player, so its actual anchor is
    // still intact. A caller can separately seek after the recipe is committed.
    publish(); return state()
  }

  private func state() -> [String: Any] {
    let raw = player.currentTime().seconds
    let recipe = prepared?.recipe
    let position = raw.isFinite ? max(0, min(raw, recipe?.durationSeconds ?? raw)) : 0
    let tick = Int64((position * Double(recipe?.timebase ?? 120_000)).rounded(.down))
    var selected = recipe?.clips.first { $0.kind == "video" && $0.zIndex == 0 && $0.startTicks <= tick && $0.endTicks > tick }
    if selected == nil, let recipe, position >= recipe.durationSeconds - 0.001 {
      selected = recipe.clips.filter { $0.kind == "video" && $0.zIndex == 0 }
        .max { $0.endTicks < $1.endTicks }
    }
    let clipID = sourceInspection?.clipId ?? selected?.id
    let source: Double
    if let inspection = sourceInspection { source = inspection.seconds }
    else if let selected, let recipe {
      let base = Double(recipe.timebase)
      source = max(Double(selected.sourceStartTicks) / base,
        min(Double(selected.sourceEndTicks) / base,
          Double(selected.sourceStartTicks) / base + position - Double(selected.startTicks) / base))
    } else { source = 0 }
    return ["positionSeconds": position, "sourcePositionSeconds": source,
            "clipId": clipID as Any? ?? NSNull(), "playing": player.rate > 0,
            "loading": loading || replayPending, "revision": revision, "token": commandToken]
  }
  private func publish() { onPlaybackState(state()); warmInteractiveFrame() }
  private func fail(_ error: Error, code: String = "E_STUDIO_COMPOSITION") {
    onError(["message": error.localizedDescription, "code": code, "revision": revision, "token": commandToken]); publish()
  }

  func dispose() {
    disposed = true; buildGeneration += 1
    cancelInteractive()
    clearReplacementFrame()
    buildTask?.cancel(); frameTask?.cancel(); cancelReplay(); player.pause(); player.replaceCurrentItem(with: nil)
    pendingSeek?.continuation.resume(throwing: StudioRecipeError.cancelled); pendingSeek = nil
    prepared = nil; initializingItem = nil; frameOutput = nil; inspectedFrame.image = nil; sourceInspection = nil
    itemObservers.invalidate()
    if let periodicObserver { player.removeTimeObserver(periodicObserver); self.periodicObserver = nil }
    for observer in [backgroundObserver, interruptionObserver, captureObserver].compactMap({ $0 }) {
      NotificationCenter.default.removeObserver(observer)
    }
    backgroundObserver = nil; interruptionObserver = nil; captureObserver = nil
    captureSessions.removeAllObjects()
  }

  deinit {
    pendingSeek?.continuation.resume(throwing: StudioRecipeError.cancelled)
    frozenTask?.cancel()
    buildTask?.cancel(); frameTask?.cancel(); replayTask?.cancel()
    if let periodicObserver { player.removeTimeObserver(periodicObserver) }
    for observer in [backgroundObserver, interruptionObserver, captureObserver].compactMap({ $0 }) {
      NotificationCenter.default.removeObserver(observer)
    }
  }
}
#endif
