import AVFoundation
import CoreMedia
import Foundation

struct StudioCaptureConfiguration {
  var position = "front"
  var quality = "1080p"
  var fps = 30
  var orientation = "portrait"
  var mirrored = false
  var cinematic = false
}

enum StudioCaptureError: LocalizedError {
  case unavailable(String), invalid(String), busy, permission(String)
  var errorDescription: String? {
    switch self {
    case .unavailable(let message), .invalid(let message), .permission(let message): return message
    case .busy: return "Finalize o take antes de alterar a câmera ou a qualidade."
    }
  }
}

/// Sole owner of a Studio capture session. UIKit/Metal belong to its view;
/// hardware configuration and recording delegates are serialized here.
// Hardware and recording state are queue-confined; the frame mailbox and its
// callback are protected separately because AVCapture delivers on videoQueue.
final class StudioCaptureSession: NSObject, @unchecked Sendable, AVCaptureFileOutputRecordingDelegate,
  AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate, AVCaptureMetadataOutputObjectsDelegate {
  typealias Completion = (Result<[String: Any], Error>) -> Void
  let session = AVCaptureSession()
  let queue = DispatchQueue(label: "br.com.classfy.studio.capture")
  private let videoQueue = DispatchQueue(label: "br.com.classfy.studio.capture.preview", qos: .userInteractive)
  private let audioQueue = DispatchQueue(label: "br.com.classfy.studio.capture.audio", qos: .userInitiated)
  private let movie = AVCaptureMovieFileOutput()
  private let audioFrames = AVCaptureAudioDataOutput()
  private let audioMonitor = StudioCaptureAudioMonitor()
  private let audioInputSelection = StudioCaptureAudioInputSelection()
  private var pendingAudioInput: (request: StudioCaptureAudioInputSelection.Request, previousId: String?, completion: Completion)?
  private var audioInputTimeout: DispatchWorkItem?
  private lazy var speech = StudioCaptureSpeech(queue: audioQueue)
  private var speechEnabled = false
  private var speechSessionId = ""
  private var speechLocale = "pt-BR"
  private var audioTimer: DispatchSourceTimer?
  private var storageTimer: DispatchSourceTimer?
  private var audioMonitoringAvailable = false
  private let frames = AVCaptureVideoDataOutput()
  private let metadata = AVCaptureMetadataOutput()
  private let controls = StudioCameraControls()
  private var configuration = StudioCaptureConfiguration()
  private var videoInput: AVCaptureDeviceInput?
  private var active = false
  private var disposed = false
  private var configured = false
  private var proControlPending = false
  private var proUnconfirmed = false
  private var generation = 0
  private var revision = 0
  private var previewProcessed = false
  private var processedPreviewAvailable = true
  private var operation: StudioCaptureOperation?
  private var recordingRetention: StudioCaptureSession?
  private var observers: [NSObjectProtocol] = []
  private var pressureObservation: NSKeyValueObservation?
  private var frameGeneration = 0
  private var frameIsCinematic = false
  private var frameEnabled = false
  private let frameLock = NSLock()
  private var cinematicFocusLocked = false
  /// Enabling capture alone would lose bokeh in the existing export pipeline.
  /// Keep this closed until the Cinematic compositor has passed end-to-end QA.
  static let cinematicPipelineReady = false

  var onEvent: ((String, [String: Any]) -> Void)?
  private var frameCallback: ((CVPixelBuffer, Int, Bool) -> Void)?
  private var remoteFrameCallback: ((CVPixelBuffer, CMTime, Int, Bool) -> Void)?
  var onRemoteFrame: ((CVPixelBuffer, CMTime, Int, Bool) -> Void)? {
    get { frameLock.lock(); defer { frameLock.unlock() }; return remoteFrameCallback }
    set { frameLock.lock(); remoteFrameCallback = newValue; frameLock.unlock() }
  }
  var onFrame: ((CVPixelBuffer, Int, Bool) -> Void)? {
    get { frameLock.lock(); defer { frameLock.unlock() }; return frameCallback }
    set { frameLock.lock(); frameCallback = newValue; frameLock.unlock() }
  }
  var onConfiguration: ((StudioCaptureConfiguration, Bool, Int) -> Void)?

  override init() {
    super.init()
    speech.onEvent = { [weak self] payload in
      self?.queue.async { [weak self] in
        guard let self, !self.disposed, payload["generation"] as? Int == self.generation,
          payload["sessionId"] as? String == self.speechSessionId else { return }
        // Keep the speech task's captured generation; emit() stamps the
        // current camera generation and must not relabel stale results.
        self.onEvent?("onSpeech", payload)
      }
    }
    observeSession()
  }

  deinit {
    audioTimer?.cancel()
    storageTimer?.cancel()
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    pressureObservation?.invalidate()
  }

  private func emit(_ name: String, _ payload: [String: Any] = [:]) {
    var value = payload
    value["generation"] = generation; value["revision"] = revision
    if let operation { value["operationId"] = operation.id }
    onEvent?(name, value)
  }

  private func requirePermissions() throws {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      throw StudioCaptureError.permission("Autorize a câmera nos Ajustes para gravar no Studio.")
    }
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
      throw StudioCaptureError.permission("Autorize o microfone nos Ajustes para gravar seu take com áudio.")
    }
  }

  func setActive(_ value: Bool, stopReason: StudioCaptureOperation.StopReason = .viewInactive) {
    queue.async {
      guard !self.disposed else { return }
      if value == self.active, self.configured, self.session.isRunning, value { return }
      self.active = value
      if value {
        do {
          try self.requirePermissions()
          if !self.configured { try self.applyConfiguration(self.configuration) }
          if !self.session.isRunning { self.session.startRunning() }
          self.frameLock.lock(); self.frameGeneration = self.generation; self.frameEnabled = self.previewProcessed; self.frameLock.unlock()
          self.emit("onReady", try self.snapshot())
          self.startAudioMonitor()
        } catch { self.emit("onError", ["code": "E_STUDIO_CAPTURE", "message": error.localizedDescription]) }
      } else {
        self.failAudioInputSelection(StudioCaptureAudioInputError.cancelled, restore: false)
        self.audioInputSelection.invalidate()
        self.stopAudioMonitor(reason: "inactive")
        self.stopStorageMonitor()
        self.invalidateFrames()
        if let operation = self.operation {
          self.stopOwned(operation, reason: stopReason)
        } else if self.session.isRunning { self.session.stopRunning() }
        self.emitState()
      }
    }
  }

  func setSpeech(enabled: Bool, sessionId: String, locale: String) {
    queue.async {
      guard !self.disposed else { return }
      self.speechEnabled = enabled
      self.speechSessionId = sessionId
      self.speechLocale = locale
      self.refreshSpeech()
    }
  }

  private func refreshSpeech(forceInactive: Bool = false) {
    let enabled = speechEnabled && !disposed
    let sessionId = speechSessionId, locale = speechLocale, generation = generation
    let running = !forceInactive && active && !disposed && session.isRunning && !session.isInterrupted
    let audioAvailable = audioMonitoringAvailable
    audioQueue.async { [weak self] in
      self?.speech.configure(enabled: enabled, sessionId: sessionId, locale: locale,
        generation: generation, running: running, audioAvailable: audioAvailable)
    }
  }

  func dispose() {
    queue.async {
      guard !self.disposed else { return }
      self.disposed = true; self.active = false
      self.failAudioInputSelection(StudioCaptureAudioInputError.cancelled, restore: false)
      self.audioInputSelection.invalidate()
      self.stopAudioMonitor(reason: "inactive")
      self.stopStorageMonitor()
      self.invalidateFrames()
      if let operation = self.operation { self.stopOwned(operation, reason: .disposed) }
      else { self.finishDisposal() }
    }
  }

  private func finishDisposal() {
    if session.isRunning { session.stopRunning() }
    frames.setSampleBufferDelegate(nil, queue: nil)
    audioFrames.setSampleBufferDelegate(nil, queue: nil)
    audioTimer?.cancel(); audioTimer = nil
    stopStorageMonitor()
    audioInputTimeout?.cancel(); audioInputTimeout = nil
    metadata.setMetadataObjectsDelegate(nil, queue: nil)
    pressureObservation?.invalidate(); pressureObservation = nil
    observers.forEach { NotificationCenter.default.removeObserver($0) }; observers.removeAll()
    onFrame = nil; onConfiguration = nil; onEvent = nil
  }

  private func invalidateFrames() {
    frameLock.lock(); frameEnabled = false; frameLock.unlock()
  }

  func setProcessedPreviewAvailable(_ available: Bool) {
    queue.async {
      self.processedPreviewAvailable = available
      if !available {
        self.previewProcessed = false; self.invalidateFrames()
        self.frames.setSampleBufferDelegate(nil, queue: nil)
        self.emitState()
      }
    }
  }

  func capabilities(completion: @escaping Completion) {
    queue.async {
      do { completion(.success(try self.snapshot())) }
      catch { completion(.failure(error)) }
    }
  }

  func configure(_ request: StudioCaptureConfiguration, completion: @escaping Completion) {
    queue.async {
      do {
        guard self.active, !self.disposed else { throw StudioCaptureError.unavailable("Abra a câmera para escolher a qualidade.") }
        guard self.operation == nil, !self.proControlPending, self.pendingAudioInput == nil else { throw StudioCaptureError.busy }
        try self.requirePermissions()
        try self.applyConfiguration(request)
        if !self.session.isRunning { self.session.startRunning() }
        let state = try self.snapshot()
        self.emit("onState", state)
        self.startAudioMonitor()
        completion(.success(state))
      } catch { completion(.failure(error)) }
    }
  }

  /// Uses the active capture audio session; does not open another microphone or
  /// change the application's category, mode, output route, or audio engine.
  func setAudioInput(_ inputId: String?, completion: @escaping Completion) {
    queue.async {
      do {
        guard self.active, !self.disposed, self.session.isRunning, !self.session.isInterrupted,
          self.audioInputSelectionSupported else { throw StudioCaptureAudioInputError.inactive }
        guard self.operation == nil, !self.proControlPending, self.pendingAudioInput == nil else {
          throw StudioCaptureAudioInputError.busy
        }
        self.observeAudioInput()
        let audio = AVAudioSession.sharedInstance()
        let previousId = audio.preferredInput?.uid
        let request = try self.audioInputSelection.begin(inputId: inputId, now: StudioCaptureAudioMonitor.now())
        self.pendingAudioInput = (request, previousId, completion)
        do {
          let port = inputId.flatMap { id in audio.availableInputs?.first(where: { $0.uid == id }) }
          if inputId != nil && port == nil { throw StudioCaptureAudioInputError.unavailable }
          try audio.setPreferredInput(port)
          // Even an unchanged route needs PCM recorded after this request.
          self.revision += 1
          self.refreshAudioMonitor(reason: "preparing")
          self.observeAudioInput()
          self.emitState()
          let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.pendingAudioInput?.request.id == request.id else { return }
            self.failAudioInputSelection(StudioCaptureAudioInputError.timeout, restore: true)
          }
          self.audioInputTimeout = timeout
          self.queue.asyncAfter(deadline: .now() + 3, execute: timeout)
        } catch { self.failAudioInputSelection(error, restore: true) }
      } catch { completion(.failure(error)) }
    }
  }

  private var audioInputSelectionSupported: Bool {
    if #available(iOS 16.0, *) { return configured && audioMonitoringAvailable && session.usesApplicationAudioSession }
    return false
  }

  private func observeAudioInput(reason: String? = nil) {
    let audio = AVAudioSession.sharedInstance()
    let ports = (audio.availableInputs ?? []).map { StudioCaptureAudioInputPort(id: $0.uid, name: $0.portName, type: $0.portType.rawValue) }
    let current = audio.currentRoute.inputs.first.map { StudioCaptureAudioInputPort(id: $0.uid, name: $0.portName, type: $0.portType.rawValue) }
    audioInputSelection.observe(available: ports, current: current, preferredId: audio.preferredInput?.uid,
      active: active && !disposed && session.isRunning && !session.isInterrupted,
      generation: generation, now: StudioCaptureAudioMonitor.now(), reason: reason)
  }

  private func failAudioInputSelection(_ error: Error, restore: Bool) {
    guard let pending = pendingAudioInput else { return }
    pendingAudioInput = nil; audioInputTimeout?.cancel(); audioInputTimeout = nil
    _ = audioInputSelection.fail(pending.request.id, error: error)
    // A late callback must never change the route owned by another screen.
    if restore, active, !disposed, generation == pending.request.generation, operation == nil {
      let audio = AVAudioSession.sharedInstance()
      let previous = pending.previousId.flatMap { id in audio.availableInputs?.first(where: { $0.uid == id }) }
      try? audio.setPreferredInput(previous)
    }
    observeAudioInput(); emitState(); pending.completion(.failure(error))
  }

  private func captureOrientation(_ value: String) throws -> AVCaptureVideoOrientation {
    switch value {
    case "portrait": return .portrait
    case "landscapeLeft": return .landscapeLeft
    case "landscape", "landscapeRight": return .landscapeRight
    default: throw StudioCaptureError.invalid("Escolha a orientação vertical ou horizontal do take.")
    }
  }

  private func dimensions(_ quality: String) throws -> (Int32, Int32) {
    switch quality {
    case "720p": return (1280, 720)
    case "1080p": return (1920, 1080)
    case "1440p", "2160p": return (3840, 2160)
    default: throw StudioCaptureError.invalid("Escolha uma resolução disponível nesta câmera.")
    }
  }

  private func chooseDevice(_ request: StudioCaptureConfiguration) throws -> AVCaptureDevice {
    let position: AVCaptureDevice.Position
    switch request.position {
    case "front": position = .front
    case "back": position = .back
    default: throw StudioCaptureError.invalid("Escolha a câmera frontal ou traseira.")
    }
    let type: AVCaptureDevice.DeviceType = request.cinematic
      ? (position == .front ? .builtInTrueDepthCamera : .builtInDualWideCamera)
      : .builtInWideAngleCamera
    guard let device = AVCaptureDevice.default(type, for: .video, position: position) else {
      throw StudioCaptureError.unavailable("Esta câmera não está disponível no aparelho. No simulador, importe um vídeo.")
    }
    return device
  }

  private func availableFormats(_ device: AVCaptureDevice, _ request: StudioCaptureConfiguration,
                                processedPreview: Bool) throws -> [AVCaptureDevice.Format] {
    let (width, height) = try dimensions(request.quality)
    return device.formats.filter { format in
      let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      guard size.width == width, size.height == height,
        format.videoSupportedFrameRateRanges.contains(where: {
          Double(request.fps) >= $0.minFrameRate && Double(request.fps) <= $0.maxFrameRate
        }) else { return false }
      let outputs: [AVCaptureOutput] = processedPreview ? [movie, frames] : [movie]
      guard !outputs.contains(where: { output in
        format.unsupportedCaptureOutputClasses.contains(where: { output.isKind(of: $0) })
      }) else { return false }
      if request.cinematic {
        if #available(iOS 26.0, *) { return format.isCinematicVideoCaptureSupported }
        return false
      }
      return true
    }
  }

  private func applyConfiguration(_ request: StudioCaptureConfiguration) throws {
    guard [24, 30, 60].contains(request.fps) else {
      throw StudioCaptureError.invalid("Escolha um FPS disponível nesta câmera.")
    }
    let orientation = try captureOrientation(request.orientation)
    // Orientation-only changes preserve manual settings, input/microphone and
    // Speech. Recreating the entire session here would reset ISO before REC.
    if configured, configuration.position == request.position, configuration.quality == request.quality,
      configuration.fps == request.fps, configuration.cinematic == request.cinematic {
      // Clear explicit proxy dimensions before turning its connection. iOS
      // rejects width/height whose aspect ratio disagrees with orientation.
      frames.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
      for connection in [movie.connection(with: .video), frames.connection(with: .video)] {
        if connection?.isVideoOrientationSupported == true { connection?.videoOrientation = orientation }
        if connection?.isVideoMirroringSupported == true {
          connection?.automaticallyAdjustsVideoMirroring = false; connection?.isVideoMirrored = request.mirrored
        }
      }
      if let device = videoInput?.device { configurePreviewDimensions(device: device, orientation: orientation) }
      configuration = request; revision += 1
      onConfiguration?(request, previewProcessed, generation)
      return
    }
    if request.cinematic && !Self.cinematicPipelineReady {
      throw StudioCaptureError.unavailable("Edição e exportação Cinema ainda não estão disponíveis. Use os ajustes de imagem do Studio.")
    }
    let device = try chooseDevice(request)
    var formats = processedPreviewAvailable ? try availableFormats(device, request, processedPreview: true) : []
    var useProcessed = processedPreviewAvailable && !formats.isEmpty
    if formats.isEmpty { formats = try availableFormats(device, request, processedPreview: false) }
    guard !formats.isEmpty else {
      throw StudioCaptureError.unavailable("Esta câmera não suporta \(request.quality) a \(request.fps) FPS. Escolha outra combinação.")
    }
    let format = formats.first(where: {
      CMFormatDescriptionGetMediaSubType($0.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    }) ?? formats[0]
    let input = try AVCaptureDeviceInput(device: device)
    guard let microphone = AVCaptureDevice.default(for: .audio) else {
      throw StudioCaptureError.unavailable("O microfone não está disponível para gravar o take.")
    }
    let audio = try AVCaptureDeviceInput(device: microphone)
    let previousInputs = session.inputs
    let previousOutputs = session.outputs
    let previousFormat = device.activeFormat
    let previousMin = device.activeVideoMinFrameDuration
    let previousMax = device.activeVideoMaxFrameDuration
    let previousPreset = session.sessionPreset
    stopAudioMonitor(reason: "preparing")
    session.beginConfiguration()
    do {
      previousOutputs.forEach { session.removeOutput($0) }
      previousInputs.forEach { session.removeInput($0) }
      guard session.canAddInput(input), session.canAddInput(audio) else {
        throw StudioCaptureError.unavailable("Não foi possível preparar a câmera e o microfone.")
      }
      session.addInput(input); session.addInput(audio)
      guard session.canSetSessionPreset(.inputPriority) else {
        throw StudioCaptureError.unavailable("A configuração de câmera não está disponível neste aparelho.")
      }
      session.sessionPreset = .inputPriority
      try device.lockForConfiguration()
      device.activeFormat = format
      device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: CMTimeScale(request.fps))
      device.activeVideoMaxFrameDuration = device.activeVideoMinFrameDuration
      if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
      if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
      if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
      let minimum = max(1, device.minAvailableVideoZoomFactor)
      device.cancelVideoZoomRamp()
      device.videoZoomFactor = min(device.maxAvailableVideoZoomFactor, max(minimum, device.videoZoomFactor))
      device.unlockForConfiguration()
      if #available(iOS 26.0, *), request.cinematic {
        guard input.isCinematicVideoCaptureSupported else { throw StudioCaptureError.unavailable("Cinema não é compatível com este formato.") }
        input.isCinematicVideoCaptureEnabled = true
      }
      guard session.canAddOutput(movie) else { throw StudioCaptureError.unavailable("Não foi possível preparar a gravação do vídeo.") }
      session.addOutput(movie)
      // A branch of the SAME audio input, available alongside MovieFileOutput
      // from iOS 16. Never replace the movie or create a second audio session.
      audioMonitoringAvailable = false
      if #available(iOS 16.0, *), session.canAddOutput(audioFrames) {
        session.addOutput(audioFrames)
        audioFrames.setSampleBufferDelegate(self, queue: audioQueue)
        audioMonitoringAvailable = true
      } else { audioFrames.setSampleBufferDelegate(nil, queue: nil) }
      frames.alwaysDiscardsLateVideoFrames = true
      // This output feeds the display/network proxy, never MovieFileOutput.
      // Its explicit dimensions are applied after its orientation is set.
      frames.automaticallyConfiguresOutputBufferDimensions = false
      frames.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
      if useProcessed && session.canAddOutput(frames) {
        session.addOutput(frames)
        frames.setSampleBufferDelegate(self, queue: videoQueue)
      } else { useProcessed = false; frames.setSampleBufferDelegate(nil, queue: nil) }
      if #available(iOS 26.0, *), request.cinematic {
        guard session.canAddOutput(metadata) else { throw StudioCaptureError.unavailable("Não foi possível preparar os metadados Cinema.") }
        session.addOutput(metadata)
        metadata.metadataObjectTypes = metadata.requiredMetadataObjectTypesForCinematicVideoCapture
        metadata.setMetadataObjectsDelegate(self, queue: queue)
      }
      for connection in [movie.connection(with: .video), frames.connection(with: .video)] {
        guard let connection else { continue }
        if connection.isVideoOrientationSupported { connection.videoOrientation = orientation }
        if connection.isVideoMirroringSupported {
          connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = request.mirrored
        }
      }
      if useProcessed { configurePreviewDimensions(device: device, orientation: orientation) }
      if let connection = movie.connection(with: .video), connection.isVideoStabilizationSupported {
        connection.preferredVideoStabilizationMode = .standard
      }
      session.commitConfiguration()
      videoInput = input; configuration = request; configured = true
      proUnconfirmed = false
      previewProcessed = useProcessed; cinematicFocusLocked = false
      generation += 1; revision += 1
      frameLock.lock(); frameGeneration = generation; frameIsCinematic = request.cinematic; frameEnabled = active && useProcessed; frameLock.unlock()
      pressureObservation?.invalidate()
      pressureObservation = device.observe(\.systemPressureState, options: [.new]) { [weak self] _, _ in
        self?.queue.async { [weak self] in self?.reportPressure() }
      }
      onConfiguration?(request, useProcessed, generation)
    } catch {
      session.outputs.forEach { session.removeOutput($0) }
      session.inputs.forEach { session.removeInput($0) }
      previousInputs.forEach { if session.canAddInput($0) { session.addInput($0) } }
      if session.canSetSessionPreset(previousPreset) { session.sessionPreset = previousPreset }
      if (try? device.lockForConfiguration()) != nil {
        device.activeFormat = previousFormat
        device.activeVideoMinFrameDuration = previousMin; device.activeVideoMaxFrameDuration = previousMax
        device.unlockForConfiguration()
      }
      previousOutputs.forEach { if session.canAddOutput($0) { session.addOutput($0) } }
      session.commitConfiguration()
      audioMonitoringAvailable = previousOutputs.contains { $0 === audioFrames }
      if audioMonitoringAvailable { audioFrames.setSampleBufferDelegate(self, queue: audioQueue) }
      startAudioMonitor()
      throw error
    }
  }

  private func configurePreviewDimensions(device: AVCaptureDevice, orientation: AVCaptureVideoOrientation) {
    frames.automaticallyConfiguresOutputBufferDimensions = false
    if #available(iOS 16.0, *) {
      let source = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
      let dimensions = StudioCapturePreviewProfile.dimensions(sourceWidth: Int(source.width),
        sourceHeight: Int(source.height), portrait: orientation == .portrait)
      // iOS 16+ downsamples directly in AVCapture, avoiding both an arbitrary
      // screen-sized source and 4K frames sent through the real-time encoder.
      frames.deliversPreviewSizedOutputBuffers = false
      frames.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
        kCVPixelBufferWidthKey as String: dimensions.width, kCVPixelBufferHeightKey as String: dimensions.height]
    } else {
      // iOS 15 does not accept explicit VideoDataOutput dimensions.
      frames.deliversPreviewSizedOutputBuffers = true
    }
  }

  private func cinematicCaptureSupported() -> Bool {
    guard #available(iOS 26.0, *) else { return false }
    let position: AVCaptureDevice.Position = configuration.position == "front" ? .front : .back
    let type: AVCaptureDevice.DeviceType = position == .front ? .builtInTrueDepthCamera : .builtInDualWideCamera
    guard let device = AVCaptureDevice.default(type, for: .video, position: position) else { return false }
    return device.formats.contains { $0.isCinematicVideoCaptureSupported }
  }

  private func snapshot() throws -> [String: Any] {
    var state = try controls.snapshot(session)
    observeAudioInput()
    state["supportsAudioInputSelection"] = audioInputSelectionSupported
    state["audioInput"] = audioInputSelection.snapshot(now: StudioCaptureAudioMonitor.now())
    state["proConfirmed"] = !proUnconfirmed && !proControlPending
    if let device = videoInput?.device {
      let source = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
      state["sourceWidth"] = Int(source.width); state["sourceHeight"] = Int(source.height)
      var choices = state["qualities"] as? [[String: Any]] ?? []
      if let fourK = choices.first(where: { $0["quality"] as? String == "2160p" }) {
        choices.removeAll { $0["quality"] as? String == "1440p" }
        let twoK: [String: Any] = ["quality": "1440p", "width": 2560, "height": 1440, "fps": fourK["fps"] ?? [],
          "sourceWidth": 3840, "sourceHeight": 2160, "downsampled": true]
        let index = choices.firstIndex(where: { $0["quality"] as? String == "2160p" }) ?? choices.count
        choices.insert(twoK, at: index)
      }
      state["qualities"] = choices
      if configuration.quality == "1440p" {
        state["quality"] = "1440p"; state["width"] = 2560; state["height"] = 1440; state["downsampled"] = true
      }
    }
    state["generation"] = generation; state["revision"] = revision
    state["phase"] = operation?.phase.rawValue ?? (active && session.isRunning ? "idle" : "inactive")
    state["operationId"] = operation?.id as Any? ?? NSNull()
    state["isRecording"] = movie.isRecording || (operation != nil && operation?.nativeFinished == false)
    let storageURL = operation?.fileURL ?? FileManager.default.temporaryDirectory.appendingPathComponent("classfy-recording-space")
    let storage = try? FileManager.default.attributesOfFileSystem(forPath: storageURL.deletingLastPathComponent().path)
    let availableBytes = (storage?[.systemFreeSize] as? NSNumber)?.int64Value
    if let availableBytes { state["storageAvailableBytes"] = availableBytes }
    if let totalBytes = (storage?[.systemSize] as? NSNumber)?.int64Value { state["storageTotalBytes"] = totalBytes }
    let recordedDuration = movie.recordedDuration
    if movie.isRecording, let remaining = StudioCaptureStoragePolicy.estimatedRemainingSeconds(availableBytes: availableBytes,
        recordedBytes: movie.recordedFileSize, recordedSeconds: recordedDuration.seconds) {
      state["estimatedRemainingRecordingSeconds"] = remaining
    }
    if operation != nil, recordedDuration.isNumeric, recordedDuration.seconds.isFinite, recordedDuration.seconds >= 0 {
      state["recordedDurationSeconds"] = recordedDuration.seconds
    }
    state["previewProcessed"] = previewProcessed
    state["orientation"] = configuration.orientation; state["mirrored"] = configuration.mirrored
    state["cinematic"] = configuration.cinematic
    let captureSupported = cinematicCaptureSupported()
    state["supportsCinematicCapture"] = captureSupported
    state["supportsCinematic"] = captureSupported && Self.cinematicPipelineReady
    if !captureSupported { state["cinematicUnavailableReason"] = "Cinema não é compatível com esta câmera e versão do iOS." }
    else if !Self.cinematicPipelineReady { state["cinematicUnavailableReason"] = "Edição e exportação Cinema ainda não estão disponíveis." }
    else { state["cinematicUnavailableReason"] = NSNull() }
    state["supportsSimulatedAperture"] = false
    if #available(iOS 26.0, *), configuration.cinematic, let input = videoInput {
      state["focusLocked"] = cinematicFocusLocked
      state["simulatedAperture"] = input.simulatedAperture
      state["minSimulatedAperture"] = input.device.activeFormat.minSimulatedAperture
      state["maxSimulatedAperture"] = input.device.activeFormat.maxSimulatedAperture
      state["supportsSimulatedAperture"] = input.device.activeFormat.maxSimulatedAperture > input.device.activeFormat.minSimulatedAperture
    }
    return state
  }

  private func emitState() { if let state = try? snapshot() { emit("onState", state) } }

  private static func freeDiskBytes(at url: URL) -> Int64? {
    let attributes = try? FileManager.default.attributesOfFileSystem(forPath: url.deletingLastPathComponent().path)
    return (attributes?[.systemFreeSize] as? NSNumber)?.int64Value
  }

  private static func thermalStateName() -> String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  func startRecording(_ operationId: String, durableOwner: String? = nil, durableSession: String? = nil, completion: @escaping Completion) {
    queue.async {
      do {
        guard self.active, !self.disposed, self.session.isRunning, !self.session.isInterrupted else {
          throw StudioCaptureError.unavailable("A câmera foi interrompida. Abra o Studio novamente para gravar.")
        }
        guard self.operation == nil, !self.proControlPending, self.pendingAudioInput == nil else { throw StudioCaptureError.busy }
        guard !self.proUnconfirmed else { throw StudioCaptureError.unavailable("Confirme os ajustes PRO ou retorne ao automático antes de gravar.") }
        self.observeAudioInput()
        if self.audioInputSelection.hasSelection && !self.audioInputSelection.confirmed(now: StudioCaptureAudioMonitor.now()) {
          throw StudioCaptureError.unavailable("Confirme o microfone em uso no iPhone ou escolha Automático antes de gravar.")
        }
        guard !operationId.isEmpty, operationId.count <= 128 else { throw StudioCaptureError.invalid("A identificação do take é inválida.") }
        try self.requirePermissions()
        let durable = durableOwner != nil || durableSession != nil
        var directory = FileManager.default.temporaryDirectory.appendingPathComponent("classfy-studio-capture", isDirectory: true)
        if durable {
          guard let owner = durableOwner, let session = durableSession, UUID(uuidString: owner) != nil,
            UUID(uuidString: session) != nil, UUID(uuidString: operationId) != nil else { throw StudioCaptureError.invalid("A identificação da câmera remota não é válida.") }
          directory = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("classfy-studio-remote", isDirectory: true).appendingPathComponent(owner, isDirectory: true).appendingPathComponent(session, isDirectory: true)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("\(durable ? operationId : UUID().uuidString).mov")
        guard !FileManager.default.fileExists(atPath: file.path) else { throw StudioCaptureError.invalid("Este take já possui um original. Recupere o arquivo antes de gravar novamente.") }
        let freeDiskBytes = Self.freeDiskBytes(at: file)
        guard StudioCaptureStoragePolicy.canStart(availableBytes: freeDiskBytes) else {
          throw StudioCaptureError.unavailable("Libere espaço no iPhone antes de gravar. O Studio precisa de pelo menos 1 GB livre. Seus originais permanecem no aparelho.")
        }
        let operation = StudioCaptureOperation(id: operationId, fileURL: file, generation: self.generation,
          sourceKind: self.configuration.cinematic ? "cinematic" : "standard", durableSource: durable,
          freeDiskBytes: freeDiskBytes, thermalState: Self.thermalStateName(), completion: completion)
        self.operation = operation; self.recordingRetention = self
        self.emit("onRecordingState", ["phase": "preparing", "operationId": operation.id])
        self.movie.minFreeDiskSpaceLimit = StudioCaptureStoragePolicy.finalizationReserveBytes
        self.movie.startRecording(to: file, recordingDelegate: self)
        let watchdog = DispatchWorkItem { [weak self, weak operation] in
          guard let self, let operation, self.operation === operation, !operation.settled,
            operation.phase == .preparing || operation.phase == .stopping else { return }
          if self.movie.isRecording {
            self.stopOwned(operation, reason: .startupTimeout)
          } else {
            // Native start failed to acknowledge. Do not free this operation
            // and allow a second REC to take ownership of a delayed callback.
            self.stopOwned(operation, reason: .startupTimeout)
            self.session.stopRunning()
            self.emit("onError", ["code": "E_STUDIO_CAPTURE_START", "message": "A câmera demorou para iniciar. Aguarde a recuperação do take e abra o Studio novamente."])
          }
        }
        operation.startupWatchdog = watchdog
        self.queue.asyncAfter(deadline: .now() + 8, execute: watchdog)
      } catch { completion(.failure(error)) }
    }
  }

  func stopRecording(_ operationId: String, completion: @escaping Completion) {
    queue.async {
      do {
        if let operation = self.operation {
          guard operation.id == operationId else { throw StudioCaptureError.invalid("Este comando pertence a outro take.") }
          self.stopOwned(operation)
        }
        completion(.success(try self.snapshot()))
      } catch { completion(.failure(error)) }
    }
  }

  private func stopOwned(_ operation: StudioCaptureOperation, reason: StudioCaptureOperation.StopReason = .userStop) {
    guard self.operation === operation, operation.requestStop(reason: reason) else { return }
    if movie.isRecording { movie.stopRecording() }
    emit("onRecordingState", ["phase": operation.phase.rawValue, "operationId": operation.id])
  }

  func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL,
                  from connections: [AVCaptureConnection]) {
    let startedAtEpochMs = Date().timeIntervalSince1970 * 1000
    let startedUptime = ProcessInfo.processInfo.systemUptime
    queue.async {
      guard let operation = self.operation, operation.fileURL == fileURL, !operation.settled else { return }
      let stop = operation.didStart(atEpochMs: startedAtEpochMs, uptime: startedUptime)
      self.emit("onRecordingState", ["phase": operation.phase.rawValue, "operationId": operation.id, "startedAtEpochMs": startedAtEpochMs])
      if stop { self.stopOwned(operation) }
      else if self.disposed { self.stopOwned(operation, reason: .disposed) }
      else if !self.active { self.stopOwned(operation, reason: .viewInactive) }
    }
  }

  func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo fileURL: URL,
                  from connections: [AVCaptureConnection], error: Error?) {
    let finishedAtEpochMs = Date().timeIntervalSince1970 * 1000
    let finishedUptime = ProcessInfo.processInfo.systemUptime
    let nativeError = error as NSError?
    let recordedDuration = output.recordedDuration
    let mediaDurationSeconds = recordedDuration.isNumeric && recordedDuration.seconds.isFinite && recordedDuration.seconds > 0 ? recordedDuration.seconds : nil
    let thermalState = Self.thermalStateName()
    let successfullyFinished = nativeError?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool
    queue.async {
      guard let operation = self.operation, operation.fileURL == fileURL,
        operation.didFinish(error: nativeError, successfullyFinished: successfullyFinished,
          mediaDurationSeconds: mediaDurationSeconds, freeDiskBytes: Self.freeDiskBytes(at: fileURL), thermalState: thermalState,
          atEpochMs: finishedAtEpochMs, uptime: finishedUptime) else { return }
      try? operation.persistReceipt()
      self.emit("onRecordingState", ["phase": "stopping", "operationId": operation.id,
        "captureReceipt": operation.captureReceipt() ?? [:]])
      self.emitState()
      let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.int64Value ?? 0
      guard size > 0 else { self.settle(operation, .failure(error ?? StudioCaptureError.unavailable("O take não contém um arquivo de vídeo válido."))); return }
      // Even an unsuccessful capture delegate can leave a usable partial MOV
      // after interruption. Inspect the original before rejecting: a valid
      // file must reach the JS journal, including after the view unmounted.
      let requestedQuality = self.configuration.quality, requestedFPS = self.configuration.fps
      Task {
        do {
          let encodedURL = requestedQuality == "1440p" ? try await StudioCaptureDownsample.twoK(fileURL, fps: requestedFPS) : fileURL
          let encodedSize = (try FileManager.default.attributesOfItem(atPath: encodedURL.path)[.size] as? NSNumber)?.int64Value ?? 0
          let asset = AVURLAsset(url: encodedURL)
          let duration = try await asset.load(.duration)
          guard duration.isNumeric, duration.seconds > 0, let track = try await asset.loadTracks(withMediaType: .video).first else {
            throw StudioCaptureError.unavailable("O take não contém vídeo reproduzível.")
          }
          let dimensions = try await track.load(.naturalSize)
          let transform = try await track.load(.preferredTransform)
          let rate = try await track.load(.nominalFrameRate)
          let descriptions = try await track.load(.formatDescriptions)
          let extensions = descriptions.first.flatMap { CMFormatDescriptionGetExtensions($0) as NSDictionary? }
          let display = CGRect(origin: .zero, size: dimensions).applying(transform)
          let captureResult: [String: Any] = ["uri": encodedURL.absoluteString, "operationId": operation.id,
            "sourceKind": operation.sourceKind, "duration": duration.seconds,
            "width": Int(abs(display.width).rounded()), "height": Int(abs(display.height).rounded()),
            "frameRate": Double(rate), "fileSize": encodedSize, "generation": operation.generation,
            "sourceStage": operation.sourceKind == "cinematic" ? "cinematicRaw" : "standard",
            "colorPrimaries": extensions?[kCMFormatDescriptionExtension_ColorPrimaries] as? String ?? "unknown",
            "transferFunction": extensions?[kCMFormatDescriptionExtension_TransferFunction] as? String ?? "unknown",
            "yCbCrMatrix": extensions?[kCMFormatDescriptionExtension_YCbCrMatrix] as? String ?? "unknown"]
          if encodedURL != fileURL && !operation.durableSource { try? FileManager.default.removeItem(at: fileURL) }
          self.queue.async {
            var result = captureResult
            if let receipt = operation.captureReceipt(mediaDurationSeconds: duration.seconds) { result["captureReceipt"] = receipt }
            try? operation.persistReceipt(mediaDurationSeconds: duration.seconds)
            self.settle(operation, .success(result))
          }
        } catch { self.queue.async { self.settle(operation, .failure(error)) } }
      }
    }
  }

  private func settle(_ operation: StudioCaptureOperation, _ result: Result<[String: Any], Error>) {
    guard self.operation === operation, !operation.settled else { return }
    self.operation = nil
    var payload: [String: Any] = ["phase": "finished", "operationId": operation.id]
    if case .success(let value) = result {
      payload["result"] = value
      payload["captureReceipt"] = value["captureReceipt"] ?? operation.captureReceipt()
    } else { payload["captureReceipt"] = operation.captureReceipt() }
    if case .failure(let error) = result { payload["error"] = error.localizedDescription; payload["recoveryUri"] = operation.fileURL.absoluteString }
    emit("onRecordingState", payload)
    operation.finish(result)
    recordingRetention = nil
    if disposed { finishDisposal() }
    else {
      if !active && session.isRunning { session.stopRunning() }
      emitState()
    }
  }

  private func validationForGeneration() -> StudioCameraControls.ViewValidation {
    let expected = generation
    return { completion in completion(self.generation == expected && self.active && !self.disposed && self.session.isRunning && !self.session.isInterrupted) }
  }

  func zoom(_ factor: Double, completion: @escaping Completion) {
    queue.async {
      do { try self.controls.zoom(self.session, queue: self.queue, factor: factor, validate: self.validationForGeneration()) {
        self.confirmControl($0, completion: completion)
      } } catch { completion(.failure(error)) }
    }
  }

  func exposure(_ bias: Double, completion: @escaping Completion) {
    queue.async {
      do { try self.controls.exposure(self.session, queue: self.queue, bias: bias, validate: self.validationForGeneration()) {
        self.confirmControl($0, completion: completion)
      } } catch { completion(.failure(error)) }
    }
  }

  func proSettings(_ settings: StudioCameraProSettings, completion: @escaping Completion) {
    queue.async {
      do {
        guard self.active, !self.disposed, self.operation == nil, !self.proControlPending else { throw StudioCaptureError.busy }
        let device = try self.controls.device(in: self.session)
        self.proControlPending = true
        self.proUnconfirmed = true
        try StudioCameraProControls.apply(device, settings: settings, queue: self.queue, validate: self.validationForGeneration()) { result in
          self.proControlPending = false
          switch result {
          case .failure(let error): self.emitState(); completion(.failure(error))
          case .success: self.proUnconfirmed = false; self.confirmControl(.success([:]), completion: completion)
          }
        }
      } catch { self.proControlPending = false; completion(.failure(error)) }
    }
  }

  func focus(_ point: CGPoint, locked: Bool, completion: @escaping Completion) {
    queue.async {
      do {
        guard point.x.isFinite, point.y.isFinite, (0...1).contains(point.x), (0...1).contains(point.y) else {
          throw StudioCaptureError.invalid("Toque dentro da imagem para escolher o foco.")
        }
        if #available(iOS 26.0, *), self.configuration.cinematic, let input = self.videoInput {
          input.device.setCinematicVideoTrackingFocus(at: point, focusMode: locked ? .strong : .weak)
          self.cinematicFocusLocked = locked
          self.confirmControl(.success(try self.snapshot()), completion: completion)
        } else {
          try self.controls.focus(self.session, queue: self.queue, point: point, locked: locked, validate: self.validationForGeneration()) {
            self.confirmControl($0, completion: completion)
          }
        }
      } catch { completion(.failure(error)) }
    }
  }

  func torch(_ enabled: Bool, completion: @escaping Completion) {
    queue.async {
      do {
        let device = try self.controls.device(in: self.session)
        guard device.hasTorch, device.isTorchAvailable, device.isTorchModeSupported(enabled ? .on : .off) else {
          throw StudioCaptureError.unavailable("A iluminação da câmera não está disponível neste aparelho.")
        }
        try device.lockForConfiguration()
        device.torchMode = enabled ? .on : .off
        device.unlockForConfiguration()
        self.confirmControl(.success(try self.snapshot()), completion: completion)
      } catch { completion(.failure(error)) }
    }
  }

  private func confirmControl(_ result: Result<[String: Any], Error>, completion: @escaping Completion) {
    switch result {
    case .failure(let error): completion(.failure(error))
    case .success:
      do {
        revision += 1
        let state = try snapshot(); emit("onState", state); completion(.success(state))
      } catch { completion(.failure(error)) }
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    if output === audioFrames {
      // Decode only once; auxiliary Speech uses RMS solely to wake an ended
      // task after silence, while actual transcripts determine reader progress.
      let measurement = StudioCaptureAudioPCM.measure(sampleBuffer)
      speech.append(sampleBuffer, measurement: measurement)
      guard let ticket = audioMonitor.ticket() else { return }
      guard let measurement else { audioMonitor.unsupported(ticket); return }
      let presentation = CMSyncConvertTime(CMSampleBufferGetPresentationTimeStamp(sampleBuffer), from: ticket.clock, to: CMClockGetHostTimeClock())
      audioMonitor.receive(measurement, ticket: ticket, hostPTS: CMTimeGetSeconds(presentation))
      return
    }
    guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    frameLock.lock()
    let token = frameGeneration; let cinematic = frameIsCinematic
    let callback = frameEnabled ? frameCallback : nil
    let remote = frameEnabled ? remoteFrameCallback : nil
    frameLock.unlock()
    remote?(buffer, CMSampleBufferGetPresentationTimeStamp(sampleBuffer), token, cinematic)
    callback?(buffer, token, cinematic)
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
                      from connection: AVCaptureConnection) {
    // Keeping the required metadata output active supplies Cinematic tracking.
    // This first delivery does not expose decorative rectangles or fake depth.
  }

  private func reportPressure() {
    guard let device = videoInput?.device else { return }
    let level = device.systemPressureState.level
    guard level == .serious || level == .critical || level == .shutdown else { return }
    emit("onInterruption", ["reason": "systemPressure", "message": "O aparelho está aquecendo. A câmera pode reduzir o desempenho.", "pressure": level.rawValue])
  }

  private func observeSession() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: AVAudioSession.sharedInstance(), queue: nil) { [weak self] notice in
      let reason = (notice.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
      let previous = notice.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
      let previousInputID = previous?.inputs.first?.uid
      self?.queue.async { [weak self] in
        guard let self, self.active, !self.disposed else { return }
        let currentInputID = AVAudioSession.sharedInstance().currentRoute.inputs.first?.uid
        let lost = reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue && previousInputID != nil && previousInputID != currentInputID
        // A new microphone route must get a fresh recognizer segment, using
        // only the shared capture output after it has resumed.
        self.refreshSpeech(forceInactive: true)
        self.refreshAudioMonitor(reason: lost ? "inputLost" : "routeChanged")
        self.observeAudioInput(reason: lost ? "inputLost" : "routeChanged")
        self.refreshSpeech()
        // Audio samples can arrive between reset and snapshot. The route-loss
        // notice must still be delivered even if the new input is already live.
        self.emitAudioMonitor(reason: lost ? "inputLost" : "routeChanged")
        self.emitState()
      }
    })
    observers.append(center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: session, queue: nil) { [weak self] notice in
      let reason = (notice.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue ?? 0
      self?.queue.async { [weak self] in
        guard let self else { return }
        self.failAudioInputSelection(StudioCaptureAudioInputError.cancelled, restore: false)
        self.audioInputSelection.invalidate()
        self.stopAudioMonitor(reason: "interrupted")
        if let operation = self.operation {
          operation.noteInterruption(reason: reason)
          self.stopOwned(operation, reason: .captureInterrupted)
        }
        self.emit("onInterruption", ["reason": reason, "message": "A gravação foi interrompida. Estamos finalizando o take para recuperação."])
      }
    })
    observers.append(center.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: session, queue: nil) { [weak self] _ in
      self?.queue.async { [weak self] in
        guard let self, self.active, !self.disposed else { return }
        self.startAudioMonitor()
      }
    })
    observers.append(center.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: nil) { [weak self] notice in
      let error = notice.userInfo?[AVCaptureSessionErrorKey] as? Error
      self?.queue.async { [weak self] in
        guard let self else { return }
        self.failAudioInputSelection(StudioCaptureAudioInputError.cancelled, restore: false)
        self.audioInputSelection.invalidate()
        self.stopAudioMonitor(reason: "interrupted")
        if let operation = self.operation {
          operation.noteRuntimeError(error as NSError?)
          self.stopOwned(operation, reason: .runtimeError)
        }
        self.emit("onError", ["code": "E_STUDIO_CAPTURE_RUNTIME", "message": error?.localizedDescription ?? "A câmera foi interrompida."])
      }
    })
  }

  private func refreshAudioMonitor(reason: String) {
    let port = AVAudioSession.sharedInstance().currentRoute.inputs.first
    let running = active && !disposed && session.isRunning && !session.isInterrupted
    let input: [String: String]? = running ? port.map { ["id": $0.uid, "name": $0.portName, "type": $0.portType.rawValue] } : nil
    let clock: CMClock?
    if #available(iOS 15.4, *) { clock = session.synchronizationClock } else { clock = nil }
    audioMonitor.reset(generation: generation, revision: revision, input: input,
      enabled: running && audioMonitoringAvailable, clock: clock,
      reason: audioMonitoringAvailable ? reason : "unavailable")
  }

  private func emitAudioMonitor(reason: String? = nil) {
    // Keep the age and its host-clock origin together. Reading a later clock
    // after route observation would incorrectly move an old PCM sample ahead.
    let sampleSnapshotNow = StudioCaptureAudioMonitor.now()
    var value = audioMonitor.snapshot(now: sampleSnapshotNow)
    if let reason { value["reason"] = reason }
    observeAudioInput(reason: reason)
    let now = StudioCaptureAudioMonitor.now()
    if value["active"] as? Bool == true, value["generation"] as? Int == generation,
      let input = value["input"] as? [String: String], let id = input["id"],
      let age = value["ageMs"] as? Double, age.isFinite, age >= 0 {
      _ = audioInputSelection.receivePCM(inputId: id, generation: generation, hostPTS: sampleSnapshotNow - age / 1000, now: now)
    }
    if let pending = pendingAudioInput, audioInputSelection.finish(pending.request.id, now: now) {
      pendingAudioInput = nil; audioInputTimeout?.cancel(); audioInputTimeout = nil
      do {
        let state = try snapshot()
        // USB can disappear between the PCM receipt and the snapshot. Never
        // resolve success with a route that is already unconfirmed.
        guard audioInputSelection.confirmed(now: StudioCaptureAudioMonitor.now()) else { throw StudioCaptureAudioInputError.unavailable }
        emit("onState", state); pending.completion(.success(state))
      }
      catch { pending.completion(.failure(error)) }
    }
    value["audioInput"] = audioInputSelection.snapshot(now: now)
    emit("onAudioMonitor", value)
  }

  private func startAudioMonitor() {
    guard active, !disposed, session.isRunning else { return }
    startStorageMonitor()
    refreshAudioMonitor(reason: "preparing")
    refreshSpeech()
    emitAudioMonitor()
    guard audioTimer == nil, audioMonitoringAvailable else { return }
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100), leeway: .milliseconds(10))
    timer.setEventHandler { [weak self] in
      guard let self, self.active, !self.disposed else { return }
      self.emitAudioMonitor()
    }
    audioTimer = timer; timer.resume()
  }

  private func startStorageMonitor() {
    guard storageTimer == nil else { return }
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + .seconds(2), repeating: .seconds(2), leeway: .milliseconds(200))
    timer.setEventHandler { [weak self] in
      guard let self, self.active, !self.disposed, self.session.isRunning else { return }
      self.emitState()
    }
    storageTimer = timer; timer.resume()
  }

  private func stopStorageMonitor() {
    storageTimer?.cancel(); storageTimer = nil
  }

  private func stopAudioMonitor(reason: String) {
    refreshSpeech(forceInactive: true)
    audioTimer?.cancel(); audioTimer = nil
    audioMonitor.reset(generation: generation, revision: revision, input: nil, enabled: false, clock: nil, reason: reason)
    emitAudioMonitor()
  }
}
