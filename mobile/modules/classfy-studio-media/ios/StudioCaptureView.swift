import AVFoundation
import CoreImage
import ExpoModulesCore
import MetalKit
import UIKit
import livekit_react_native_webrtc

/// Expo owns the view registration; this view owns its AVFoundation session.
/// At most one unrendered frame and two GPU submissions are retained.
final class StudioCaptureView: ExpoView, MTKViewDelegate {
  let onReady = EventDispatcher()
  let onState = EventDispatcher()
  let onRecordingState = EventDispatcher()
  let onInterruption = EventDispatcher()
  let onError = EventDispatcher()
  let onAudioMonitor = EventDispatcher()
  let onSpeech = EventDispatcher()
  let capture = StudioCaptureSession()
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private var metalView: MTKView?
  private var commandQueue: MTLCommandQueue?
  private var renderer: StudioEffectRenderer?
  private var grade: StudioImageGrade = .identity
  private var gradeRevision = 0
  private var lastEffectPropJSON: String?
  private var confirmedGradeRevision: Int?
  private var confirmedGradeGeneration: Int?
  private var confirmedRemoteGradeRevision: Int?
  private var confirmedRemoteGradeGeneration: Int?
  private var processedConfiguration = false
  private var recordingEffectLocked = false
  private struct PendingEffect {
    let request: StudioCaptureEffectConfirmation
    let completion: StudioCaptureSession.Completion
  }
  private var pendingEffect: PendingEffect?
  private var effectTimeout: DispatchWorkItem?
  private var requestedActive = false
  private var speechEnabled = false
  private var speechSessionId = ""
  private var speechLocale = "pt-BR"
  private var inBackground = false
  private var currentGeneration = 0
  private var queuedFrame: (buffer: CVPixelBuffer, generation: Int, cinematic: Bool)?
  private var drawScheduled = false
  private var previewFailed = false
  private let frameLock = NSLock()
  private let gpuSlots = DispatchSemaphore(value: 2)
  private var lifecycleObservers: [NSObjectProtocol] = []
  private var remotePreview: StudioCameraRemotePreview?
  private var remotePreviewEpoch = 0
  private var remotePreviewPreparing = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black; clipsToBounds = true
    previewLayer.session = capture.session
    previewLayer.videoGravity = .resizeAspect
    layer.addSublayer(previewLayer)
    prepareMetal()
    capture.onFrame = { [weak self] buffer, generation, cinematic in
      self?.receiveFrame(buffer, generation: generation, cinematic: cinematic)
    }
    capture.onConfiguration = { [weak self] configuration, processed, generation in
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.frameLock.lock()
        self.currentGeneration = generation; self.queuedFrame = nil
        self.frameLock.unlock()
        self.processedConfiguration = processed
        self.confirmedGradeRevision = nil; self.confirmedGradeGeneration = nil
        self.confirmedRemoteGradeRevision = nil; self.confirmedRemoteGradeGeneration = nil
        self.finishPendingEffect(.failure(StudioCaptureError.invalid("O enquadramento mudou. Aguarde a imagem e escolha o tratamento novamente.")))
        self.previewLayer.opacity = 1
        self.metalView?.layer.opacity = 0
        self.applyPreviewConfiguration(configuration)
        let source = configuration.quality == "720p" ? (1280, 720) : (1920, 1080)
        self.remotePreview?.setProfile(sourceWidth: source.0, sourceHeight: source.1,
          portrait: configuration.orientation == "portrait", fps: configuration.fps, generation: generation)
        self.remotePreview?.setGrade(self.grade, revision: self.gradeRevision, generation: generation)
        if !processed { self.metalView?.isPaused = true }
      }
    }
    capture.onEvent = { [weak self] name, payload in
      DispatchQueue.main.async { [weak self] in self?.dispatch(name, payload) }
    }
    lifecycleObservers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
      object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.inBackground = true; self.applyActivity()
      })
    lifecycleObservers.append(NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification,
      object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.inBackground = false; self.applyActivity()
      })
  }

  deinit {
    remotePreview?.dispose()
    effectTimeout?.cancel()
    pendingEffect?.completion(.failure(StudioCaptureError.unavailable("A câmera foi fechada antes de confirmar o tratamento.")))
    lifecycleObservers.forEach { NotificationCenter.default.removeObserver($0) }
    capture.dispose()
  }

  func startRemotePreview(module: WebRTCModule, completion: @escaping StudioCaptureSession.Completion) {
    guard remotePreview == nil, !remotePreviewPreparing else { completion(.failure(StudioCaptureError.busy)); return }
    remotePreviewEpoch += 1; let epoch = remotePreviewEpoch; remotePreviewPreparing = true
    capture.capabilities { [weak self] result in
      DispatchQueue.main.async { [weak self] in
        do {
          guard let self, self.remotePreviewEpoch == epoch, self.remotePreviewPreparing,
            self.requestedActive, !self.inBackground, self.window != nil else {
            throw StudioCaptureError.unavailable("A prévia remota foi fechada.")
          }
          let state = try result.get()
          guard state["previewProcessed"] as? Bool == true else { throw StudioCaptureError.unavailable("Esta combinação não oferece prévia remota. Escolha um formato compatível.") }
          let portrait = state["orientation"] as? String == "portrait"
          let dimensions = StudioCapturePreviewProfile.dimensions(sourceWidth: state["width"] as? Int ?? 1920,
            sourceHeight: state["height"] as? Int ?? 1080, portrait: portrait)
          let preview = try StudioCameraRemotePreview(module: module, width: dimensions.width,
            height: dimensions.height, fps: min(StudioCapturePreviewProfile.maxFPS, state["fps"] as? Int ?? 30))
          self.remotePreview = preview
          self.confirmedRemoteGradeRevision = nil; self.confirmedRemoteGradeGeneration = nil
          preview.setGrade(self.grade, revision: self.gradeRevision, generation: self.currentGeneration)
          preview.onRendered = { [weak self, weak preview] revision, generation in
            DispatchQueue.main.async { [weak self, weak preview] in
              guard let self, let preview, self.remotePreview === preview else { return }
              self.confirmGradeFrame(revision: revision, generation: generation, remote: true)
            }
          }
          preview.onFailure = { [weak self, weak preview] in
            DispatchQueue.main.async { [weak self, weak preview] in
              guard let self, let preview, self.remotePreview === preview else { return }
              self.confirmedRemoteGradeRevision = nil; self.confirmedRemoteGradeGeneration = nil
              self.finishPendingEffect(.failure(StudioCaptureError.unavailable("A prévia remota não confirmou o tratamento. Reconecte a prévia antes de gravar.")))
              self.onInterruption(["reason": "remotePreviewUnavailable", "message": "A prévia remota do tratamento foi interrompida. O original permanece no iPhone."])
            }
          }
          self.capture.onRemoteFrame = { [weak preview] buffer, timestamp, generation, cinematic in
            preview?.receive(buffer, timestamp: timestamp, generation: generation, cinematic: cinematic)
          }
          preview.register { [weak self] descriptor in
            DispatchQueue.main.async { [weak self] in
              guard let self, self.remotePreviewEpoch == epoch, self.remotePreview === preview, !descriptor.isEmpty else { completion(.failure(StudioCaptureError.unavailable("A prévia remota foi fechada."))); return }
              self.remotePreviewPreparing = false
              completion(.success(descriptor))
            }
          }
        } catch { if self?.remotePreviewEpoch == epoch { self?.remotePreviewPreparing = false }; completion(.failure(error)) }
      }
    }
  }
  func stopRemotePreview() {
    remotePreviewEpoch += 1; remotePreviewPreparing = false
    capture.onRemoteFrame = nil
    remotePreview?.dispose(); remotePreview = nil
    confirmedRemoteGradeRevision = nil; confirmedRemoteGradeGeneration = nil
  }

  private func prepareMetal() {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      capture.setProcessedPreviewAvailable(false)
      return
    }
    let view = MTKView(frame: bounds, device: device)
    view.framebufferOnly = false
    view.colorPixelFormat = .bgra8Unorm
    view.isPaused = true; view.enableSetNeedsDisplay = false
    view.clearColor = MTLClearColorMake(0, 0, 0, 1)
    view.delegate = self
    view.isUserInteractionEnabled = false
    view.layer.opacity = 0
    if let metalLayer = view.layer as? CAMetalLayer { metalLayer.colorspace = StudioEffectRenderer.outputColorSpace }
    let context = CIContext(mtlCommandQueue: queue, options: [
      .workingColorSpace: StudioEffectRenderer.workingColorSpace,
      .outputColorSpace: StudioEffectRenderer.outputColorSpace,
      .cacheIntermediates: false
    ])
    self.commandQueue = queue
    renderer = StudioEffectRenderer(context: context)
    metalView = view; addSubview(view)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin(); CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    metalView?.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    applyActivity()
  }

  func setActive(_ active: Bool) {
    requestedActive = active
    applyActivity()
  }

  func setSpeechEnabled(_ enabled: Bool) { speechEnabled = enabled; applySpeech() }
  func setSpeechSessionId(_ id: String) { speechSessionId = id; applySpeech() }
  func setSpeechLocale(_ locale: String) { speechLocale = locale; applySpeech() }
  private func applySpeech() {
    capture.setSpeech(enabled: speechEnabled, sessionId: speechSessionId, locale: speechLocale)
  }

  private func applyActivity() {
    let active = requestedActive && window != nil && !inBackground
    if !active {
      frameLock.lock(); queuedFrame = nil; frameLock.unlock()
      finishPendingEffect(.failure(StudioCaptureError.unavailable("Abra a câmera para visualizar o tratamento.")))
    }
    capture.setActive(active)
  }

  func setEffectRecipeJSON(_ json: String) throws -> [String: Any] {
    guard !recordingEffectLocked else { throw StudioCaptureError.busy }
    guard let data = json.data(using: .utf8), data.count <= 16_384 else {
      throw StudioCaptureError.invalid("Os ajustes de imagem são inválidos.")
    }
    let decoded = try JSONDecoder().decode(StudioImageGrade.self, from: data)
    guard decoded.isValid else { throw StudioCaptureError.invalid("Escolha ajustes de imagem válidos.") }
    grade = decoded; gradeRevision += 1
    confirmedGradeRevision = nil; confirmedGradeGeneration = nil
    confirmedRemoteGradeRevision = nil; confirmedRemoteGradeGeneration = nil
    remotePreview?.setGrade(decoded, revision: gradeRevision, generation: currentGeneration)
    return effectState(processed: false)
  }

  /// A recipe is confirmed only after a frame with this exact revision has
  /// completed on the GPU. The movie output still writes the untouched source.
  func setCaptureEffect(_ json: String, completion: @escaping StudioCaptureSession.Completion) {
    do {
      guard requestedActive, !inBackground, window != nil else {
        throw StudioCaptureError.unavailable("Abra a câmera para visualizar o tratamento.")
      }
      finishPendingEffect(.failure(StudioCaptureError.invalid("O ajuste de imagem foi substituído.")))
      _ = try setEffectRecipeJSON(json)
      guard renderer != nil, processedConfiguration, !previewFailed else {
        completion(.success(effectState(processed: false))); return
      }
      let request = StudioCaptureEffectConfirmation(revision: gradeRevision, generation: currentGeneration, requiresRemote: remotePreview != nil)
      pendingEffect = PendingEffect(request: request, completion: completion)
      let timeout = DispatchWorkItem { [weak self] in
        guard let self, self.pendingEffect?.request === request else { return }
        self.finishPendingEffect(.failure(StudioCaptureError.unavailable("A câmera não confirmou a prévia do tratamento. Tente novamente ou use Natural.")))
      }
      effectTimeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
    } catch { completion(.failure(error)) }
  }

  private func effectState(processed: Bool) -> [String: Any] {
    ["effectRevision": gradeRevision, "previewProcessed": processed, "generation": currentGeneration,
     "grade": ["preset": grade.preset, "intensity": grade.intensity, "exposure": grade.exposure,
               "contrast": grade.contrast, "saturation": grade.saturation, "temperature": grade.temperature],
     "remotePreviewProcessed": confirmedRemoteGradeRevision == gradeRevision && confirmedRemoteGradeGeneration == currentGeneration]
  }

  private func confirmGradeFrame(revision: Int, generation: Int, remote: Bool) {
    guard revision == gradeRevision, generation == currentGeneration, requestedActive, !inBackground, window != nil else { return }
    if remote { confirmedRemoteGradeRevision = revision; confirmedRemoteGradeGeneration = generation }
    else { confirmedGradeRevision = revision; confirmedGradeGeneration = generation }
    guard let pending = pendingEffect,
      pending.request.acceptFrame(revision: revision, generation: generation, remote: remote) else { return }
    finishPendingEffect(.success(effectState(processed: true)))
  }

  private func finishPendingEffect(_ result: Result<[String: Any], Error>) {
    let pending = pendingEffect; pendingEffect = nil
    pending?.request.cancel()
    effectTimeout?.cancel(); effectTimeout = nil
    pending?.completion(result)
  }

  func applyEffectRecipeJSON(_ json: String) {
    // Expo can replay an unchanged prop alongside other updates. It must not
    // replace a newer imperative grade or invalidate its real frame receipt.
    guard lastEffectPropJSON != json else { return }
    do { _ = try setEffectRecipeJSON(json); lastEffectPropJSON = json }
    catch { onError(["code": "E_STUDIO_GRADE", "message": error.localizedDescription]) }
  }

  func capabilities(completion: @escaping StudioCaptureSession.Completion) {
    capture.capabilities { [weak self] result in DispatchQueue.main.async { [weak self] in
      guard let self else { completion(.failure(StudioCaptureError.unavailable("A câmera foi fechada."))); return }
      completion(result.map { state in var state = state
        state["imageGrade"] = self.effectState(processed: false)["grade"]
        state["imageGradeConfirmed"] = self.confirmedGradeRevision == self.gradeRevision && self.confirmedGradeGeneration == self.currentGeneration
        state["remoteGradeConfirmed"] = self.confirmedRemoteGradeRevision == self.gradeRevision && self.confirmedRemoteGradeGeneration == self.currentGeneration
        state["supportsImageGrade"] = self.renderer != nil && self.processedConfiguration && !self.previewFailed
        return state
      })
    } }
  }
  func configure(_ configuration: StudioCaptureConfiguration, completion: @escaping StudioCaptureSession.Completion) {
    capture.configure(configuration, completion: completion)
  }
  func setAudioInput(_ inputId: String?, completion: @escaping StudioCaptureSession.Completion) {
    guard requestedActive, !inBackground, window != nil else {
      completion(.failure(StudioCaptureAudioInputError.inactive)); return
    }
    guard !recordingEffectLocked, pendingEffect == nil else {
      completion(.failure(StudioCaptureAudioInputError.busy)); return
    }
    capture.setAudioInput(inputId, completion: completion)
  }
  func startRecording(_ operationId: String, completion: @escaping StudioCaptureSession.Completion) {
    startOwnedRecording(operationId, durableOwner: nil, durableSession: nil, completion: completion)
  }
  func startRemoteRecording(_ operationId: String, owner: String, session: String, completion: @escaping StudioCaptureSession.Completion) {
    startOwnedRecording(operationId, durableOwner: owner, durableSession: session, completion: completion)
  }
  private func startOwnedRecording(_ operationId: String, durableOwner: String?, durableSession: String?, completion: @escaping StudioCaptureSession.Completion) {
    guard !recordingEffectLocked, pendingEffect == nil else { completion(.failure(StudioCaptureError.busy)); return }
    let treated = !grade.isIdentity
    guard !treated || (processedConfiguration && !previewFailed && confirmedGradeRevision == gradeRevision && confirmedGradeGeneration == currentGeneration) else {
      completion(.failure(StudioCaptureError.unavailable("Confirme o tratamento na prévia ou escolha Natural antes de gravar."))); return
    }
    guard !treated || durableOwner == nil || remotePreview == nil ||
      (confirmedRemoteGradeRevision == gradeRevision && confirmedRemoteGradeGeneration == currentGeneration) else {
      completion(.failure(StudioCaptureError.unavailable("Aguarde o tratamento aparecer na prévia remota antes de gravar."))); return
    }
    recordingEffectLocked = true
    capture.startRecording(operationId, durableOwner: durableOwner, durableSession: durableSession) { [weak self] result in
      DispatchQueue.main.async { [weak self] in
        self?.recordingEffectLocked = false
        completion(result)
      }
    }
  }
  func stopRecording(_ operationId: String, completion: @escaping StudioCaptureSession.Completion) {
    capture.stopRecording(operationId, completion: completion)
  }
  func zoom(_ factor: Double, completion: @escaping StudioCaptureSession.Completion) { capture.zoom(factor, completion: completion) }
  func exposure(_ bias: Double, completion: @escaping StudioCaptureSession.Completion) { capture.exposure(bias, completion: completion) }
  func proSettings(_ settings: StudioCameraProSettings, completion: @escaping StudioCaptureSession.Completion) { capture.proSettings(settings, completion: completion) }
  func torch(_ enabled: Bool, completion: @escaping StudioCaptureSession.Completion) { capture.torch(enabled, completion: completion) }

  /// Uses the same aspect-fit geometry, rotation and mirroring as the Metal
  /// canvas. Ignore black rails instead of focusing a point outside the frame.
  func focus(x: Double, y: Double, locked: Bool, imageCoordinates: Bool = false, completion: @escaping StudioCaptureSession.Completion) {
    guard x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y), bounds.width > 0, bounds.height > 0 else {
      completion(.failure(StudioCaptureError.invalid("Toque dentro da imagem para escolher o foco."))); return
    }
    let videoRect = previewLayer.layerRectConverted(fromMetadataOutputRect: CGRect(x: 0, y: 0, width: 1, height: 1))
    guard !imageCoordinates || videoRect.width > 0 && videoRect.height > 0 else {
      completion(.failure(StudioCaptureError.unavailable("Aguarde a imagem da câmera antes de escolher o foco."))); return
    }
    let point = imageCoordinates ? CGPoint(x: videoRect.minX + videoRect.width * CGFloat(x), y: videoRect.minY + videoRect.height * CGFloat(y))
      : CGPoint(x: bounds.width * CGFloat(x), y: bounds.height * CGFloat(y))
    let metadataRect = previewLayer.metadataOutputRectConverted(fromLayerRect: CGRect(origin: point, size: CGSize(width: 1, height: 1)))
    guard metadataRect.minX >= 0, metadataRect.minY >= 0, metadataRect.maxX <= 1.01, metadataRect.maxY <= 1.01 else {
      completion(.failure(StudioCaptureError.invalid("Toque dentro da imagem, fora das margens pretas."))); return
    }
    let normalized = previewLayer.captureDevicePointConverted(fromLayerPoint: point)
    capture.focus(normalized, locked: locked, completion: completion)
  }

  private func applyPreviewConfiguration(_ configuration: StudioCaptureConfiguration) {
    let orientation: AVCaptureVideoOrientation
    switch configuration.orientation {
    case "landscapeLeft": orientation = .landscapeLeft
    case "landscape", "landscapeRight": orientation = .landscapeRight
    default: orientation = .portrait
    }
    if let connection = previewLayer.connection {
      if connection.isVideoOrientationSupported { connection.videoOrientation = orientation }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = configuration.mirrored
      }
    }
  }

  private func dispatch(_ name: String, _ payload: [String: Any]) {
    var value = payload; value["effectRevision"] = gradeRevision
    switch name {
    case "onReady": onReady(value)
    case "onState": onState(value)
    case "onRecordingState": onRecordingState(value)
    case "onInterruption": onInterruption(value)
    case "onAudioMonitor": onAudioMonitor(value)
    case "onSpeech": onSpeech(value)
    default: onError(value)
    }
  }

  private func receiveFrame(_ buffer: CVPixelBuffer, generation: Int, cinematic: Bool) {
    frameLock.lock()
    guard generation == currentGeneration, !previewFailed else { frameLock.unlock(); return }
    queuedFrame = (buffer, generation, cinematic)
    let schedule = !drawScheduled
    if schedule { drawScheduled = true }
    frameLock.unlock()
    if schedule { DispatchQueue.main.async { [weak self] in self?.drawPending() } }
  }

  private func drawPending() {
    frameLock.lock(); drawScheduled = false; frameLock.unlock()
    guard requestedActive, !inBackground, window != nil else { return }
    metalView?.draw()
  }

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  /// A processing failure cannot take the real camera or its original away.
  /// Stay on AVFoundation preview until this view is opened again.
  private func restoreOriginalPreview() {
    frameLock.lock(); previewFailed = true; queuedFrame = nil; frameLock.unlock()
    previewLayer.opacity = 1; metalView?.layer.opacity = 0
    capture.setProcessedPreviewAvailable(false)
    confirmedGradeRevision = nil; confirmedGradeGeneration = nil
    finishPendingEffect(.failure(StudioCaptureError.unavailable("O tratamento não está disponível nesta prévia. Use Natural e ajuste a imagem no editor.")))
    onInterruption(["reason": "previewFallback", "generation": currentGeneration,
      "message": "A prévia voltou à câmera original. Você pode continuar gravando e ajustar a imagem no editor."])
  }

  func draw(in view: MTKView) {
    guard gpuSlots.wait(timeout: .now()) == .success else { return }
    frameLock.lock()
    let pending = queuedFrame; queuedFrame = nil
    let failed = previewFailed
    frameLock.unlock()
    guard !failed, let pending, pending.generation == currentGeneration, let drawable = view.currentDrawable,
      let commands = commandQueue?.makeCommandBuffer(), let renderer else { gpuSlots.signal(); return }
    let input = CIImage(cvPixelBuffer: pending.buffer)
    let renderedGradeRevision = gradeRevision
    let source = renderer.outputImage(input, grade: grade, sourceStage: pending.cinematic ? .cinematicRendered : .standard)
    let target = CGRect(x: 0, y: 0, width: drawable.texture.width, height: drawable.texture.height)
    guard source.extent.width > 0, source.extent.height > 0 else { gpuSlots.signal(); return }
    let scale = min(target.width / source.extent.width, target.height / source.extent.height)
    let transform = CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY)
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))
      .concatenating(CGAffineTransform(translationX: (target.width - source.extent.width * scale) / 2,
                                      y: (target.height - source.extent.height * scale) / 2))
    let background = CIImage(color: .black).cropped(to: target)
    let canvas = source.transformed(by: transform).composited(over: background).cropped(to: target)
    let destination = CIRenderDestination(mtlTexture: drawable.texture, commandBuffer: commands)
    destination.colorSpace = StudioEffectRenderer.outputColorSpace
    // Metal drawable memory starts at the top row; Core Image coordinates
    // start at the bottom. Explicit destination flipping keeps faces upright.
    destination.isFlipped = true
    do { _ = try renderer.context.startTask(toRender: canvas, to: destination) }
    catch {
      gpuSlots.signal()
      restoreOriginalPreview()
      return
    }
    let retainedBuffer = pending.buffer
    let slots = gpuSlots
    commands.addCompletedHandler { [weak self] command in
      _ = retainedBuffer
      slots.signal()
      DispatchQueue.main.async { [weak self] in
        guard let self, pending.generation == self.currentGeneration,
          self.requestedActive, !self.inBackground, self.window != nil else { return }
        guard !self.previewFailed else { return }
        if command.status != .completed { self.restoreOriginalPreview(); return }
        self.previewLayer.opacity = 0
        self.metalView?.layer.opacity = 1
        self.confirmGradeFrame(revision: renderedGradeRevision, generation: pending.generation, remote: false)
      }
    }
    commands.present(drawable)
    commands.commit()
  }
}
