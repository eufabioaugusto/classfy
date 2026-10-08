#if canImport(UIKit) && canImport(ExpoModulesCore)
import AVFoundation
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
  private let inspectedFrame = UIImageView()
  private var prepared: StudioPreparedRecipe?
  private var recipeJSON = ""
  private var revision = ""
  private var paused = true
  private var loading = false
  private var buildGeneration = 0
  private var commandToken = 0
  private var disposed = false
  private var sourceInspection: (clipId: String, seconds: Double)?
  private struct PendingSeek {
    let seconds: Double
    let token: Int
    let continuation: CheckedContinuation<[String: Any], Error>
  }
  private var pendingSeek: PendingSeek?
  private var buildTask: Task<Void, Never>?
  private var frameTask: Task<CGImage, Error>?
  private var replayTask: Task<Void, Never>?
  private var replayGeneration = 0
  private var replayPending = false
  private var periodicObserver: Any?
  private var statusObserver: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
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
    inspectedFrame.contentMode = .scaleAspectFit; inspectedFrame.backgroundColor = .black
    inspectedFrame.isHidden = true; inspectedFrame.isUserInteractionEnabled = false
    addSubview(inspectedFrame)
    periodicObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 15), queue: .main) { [weak self] _ in
      Task { @MainActor [weak self] in self?.publish() }
    }
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor [weak self] in self?.setPaused(true) }
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
    playerLayer.frame = bounds; inspectedFrame.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      player.pause(); frameTask?.cancel(); cancelReplay()
      sourceInspection = nil; inspectedFrame.isHidden = true
    }
  }

  func setRevision(_ value: String) { revision = value }

  func setRecipeJSON(_ value: String) {
    guard !disposed, value != recipeJSON else { return }
    recipeJSON = value; buildGeneration += 1
    let generation = buildGeneration
    let oldPosition = pendingSeek?.seconds ?? max(0, player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0)
    player.pause(); buildTask?.cancel(); frameTask?.cancel(); cancelReplay()
    sourceInspection = nil; inspectedFrame.isHidden = true
    loading = true; publish()
    // Prop updates are batched before this task resumes on main; revision has
    // therefore been set when a result is emitted, regardless of prop order.
    buildTask = Task { [weak self] in
      guard let self else { return }
      do {
        await Task.yield()
        try Task.checkCancellation()
        if let previous = self.prepared, let updated = try engine.updateVisuals(previous, recipeJSON: value),
           generation == buildGeneration, let item = player.currentItem {
          self.prepared = updated; item.videoComposition = updated.videoComposition
          loading = item.status != .readyToPlay
          if !paused && !loading && window != nil { startPlayback() }
          drainPendingSeek(); publish(); return
        }
        let prepared = try await engine.prepare(recipeJSON: value)
        try Task.checkCancellation()
        guard generation == buildGeneration else { return }
        self.prepared = prepared
        let item = prepared.playerItem()
        statusObserver?.invalidate()
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        statusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
          Task { @MainActor [weak self, weak item] in
            guard let self, let item, self.player.currentItem === item, generation == self.buildGeneration else { return }
            if item.status == .failed {
              self.loading = false; self.paused = true; self.player.pause()
              self.fail(item.error ?? StudioRecipeError.invalid("Não foi possível abrir esta edição."))
            } else if item.status == .readyToPlay {
              self.loading = false
              if !self.paused && self.window != nil { self.startPlayback() }
              self.publish()
            }
          }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self, weak item] _ in
          Task { @MainActor [weak self, weak item] in
            guard let self, let item, self.player.currentItem === item,
                  generation == self.buildGeneration, !self.replayPending else { return }
            let elapsed = self.player.currentTime().seconds
            guard elapsed.isFinite, elapsed >= prepared.recipe.durationSeconds - 1 / 30.0 else { return }
            self.setPaused(true)
          }
        }
        player.replaceCurrentItem(with: item)
        let position = min(oldPosition, max(0, prepared.recipe.durationSeconds - 1 / 30.0))
        if position > 0 {
          await seekPlayer(position)
          guard generation == buildGeneration, !Task.isCancelled else { return }
        }
        loading = item.status != .readyToPlay
        if !paused && !loading && window != nil { startPlayback() }
        drainPendingSeek()
        publish()
      } catch {
        guard generation == buildGeneration, !Task.isCancelled else { return }
        loading = false; prepared = nil; player.replaceCurrentItem(with: nil)
        pendingSeek?.continuation.resume(throwing: error); pendingSeek = nil
        fail(error)
      }
    }
  }

  func setPaused(_ value: Bool) {
    guard !disposed else { return }
    cancelReplay()
    paused = value
    if value { player.pause() }
    else if !loading, window != nil, sourceInspection == nil, let prepared {
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
          await self.seekPlayer(0)
          guard !Task.isCancelled, !self.disposed, !self.paused, self.window != nil,
                self.sourceInspection == nil, self.buildGeneration == generation,
                self.commandToken == token, self.replayGeneration == replay,
                self.player.currentItem === item else { return }
          self.startPlayback(); self.publish()
        }
      } else { startPlayback() }
    }
    publish()
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
      // AVCaptureSession does not restore the shared audio session when capture
      // ends. Select movie playback only when the user actually starts playing.
      let audio = AVAudioSession.sharedInstance()
      if audio.category != .playback || audio.mode != .moviePlayback || !audio.categoryOptions.isEmpty {
        try audio.setCategory(.playback, mode: .moviePlayback, options: [])
      }
      try audio.setActive(true)
      player.play()
    } catch {
      paused = true; player.pause()
      fail(StudioRecipeError.invalid("Não foi possível ativar o som da prévia. \(error.localizedDescription)"), code: "E_STUDIO_AUDIO_SESSION")
    }
  }

  private func claim(_ token: Int) throws {
    guard !disposed, token >= commandToken else { throw StudioRecipeError.cancelled }
    commandToken = token; frameTask?.cancel(); cancelReplay(); player.currentItem?.cancelPendingSeeks()
    if let pending = pendingSeek { pending.continuation.resume(throwing: StudioRecipeError.cancelled); pendingSeek = nil }
  }

  private func drainPendingSeek() {
    guard let pending = pendingSeek, prepared != nil else { return }
    pendingSeek = nil
    Task { [weak self] in
      guard let self else { pending.continuation.resume(throwing: StudioRecipeError.cancelled); return }
      do { pending.continuation.resume(returning: try await performSeek(seconds: pending.seconds, token: pending.token)) }
      catch { pending.continuation.resume(throwing: error) }
    }
  }

  private func seekPlayer(_ seconds: Double) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      player.seek(to: CMTime(seconds: seconds, preferredTimescale: 120_000), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
        continuation.resume()
      }
    }
  }

  func seekAsync(seconds: Double, token: Int) async throws -> [String: Any] {
    try claim(token)
    guard seconds.isFinite else { throw StudioRecipeError.invalid("Escolha um tempo válido da edição.") }
    if loading || prepared == nil {
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
    await seekPlayer(target)
    guard commandToken == token, generation == buildGeneration else { throw StudioRecipeError.cancelled }
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
    let contextual = clipStart + sourceSeconds - Double(inspected.clip.sourceStartTicks) / base
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
  private func publish() { onPlaybackState(state()) }
  private func fail(_ error: Error, code: String = "E_STUDIO_COMPOSITION") {
    onError(["message": error.localizedDescription, "code": code, "revision": revision, "token": commandToken]); publish()
  }

  func dispose() {
    disposed = true; buildGeneration += 1
    buildTask?.cancel(); frameTask?.cancel(); cancelReplay(); player.pause(); player.replaceCurrentItem(with: nil)
    pendingSeek?.continuation.resume(throwing: StudioRecipeError.cancelled); pendingSeek = nil
    prepared = nil; inspectedFrame.image = nil; sourceInspection = nil
    statusObserver?.invalidate()
    if let periodicObserver { player.removeTimeObserver(periodicObserver); self.periodicObserver = nil }
    for observer in [endObserver, backgroundObserver, interruptionObserver, captureObserver].compactMap({ $0 }) {
      NotificationCenter.default.removeObserver(observer)
    }
    endObserver = nil; backgroundObserver = nil; interruptionObserver = nil; captureObserver = nil
    captureSessions.removeAllObjects()
  }

  deinit {
    pendingSeek?.continuation.resume(throwing: StudioRecipeError.cancelled)
    buildTask?.cancel(); frameTask?.cancel(); replayTask?.cancel(); statusObserver?.invalidate()
    if let periodicObserver { player.removeTimeObserver(periodicObserver) }
    for observer in [endObserver, backgroundObserver, interruptionObserver, captureObserver].compactMap({ $0 }) {
      NotificationCenter.default.removeObserver(observer)
    }
  }
}
#endif
