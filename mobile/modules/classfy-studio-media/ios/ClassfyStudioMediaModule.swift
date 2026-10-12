import ExpoModulesCore
import ExpoCamera
import AVFoundation
import UIKit
import Metal

struct StudioClipRecord: Record {
  @Field var uri: String = ""
  @Field var startSeconds: Double = 0
  @Field var endSeconds: Double = 0
}

struct StudioExportRecord: Record {
  @Field var requestId: String = ""
  @Field var clips: [StudioClipRecord] = []
  @Field var outputUri: String = ""
  @Field var mediaType: String = "video"
  @Field var aspectRatio: String = "landscape"
}

struct StudioCameraConfigurationRecord: Record {
  @Field var quality: String = "1080p"
  @Field var fps: Int = 30
}

struct StudioCameraFocusRecord: Record {
  @Field var x: Double = 0.5
  @Field var y: Double = 0.5
  @Field var locked: Bool = false
}

struct StudioRecipeExportRecord: Record {
  @Field var requestId: String = ""
  @Field var recipeJSON: String = ""
  @Field var outputUri: String = ""
}
struct StudioNativeCaptureConfigurationRecord: Record {
  @Field var position: String = "front"
  @Field var quality: String = "1080p"
  @Field var fps: Int = 30
  @Field var orientation: String = "portrait"
  @Field var cinematic: Bool = false
  @Field var mirrored: Bool = false
  var native: StudioCaptureConfiguration { StudioCaptureConfiguration(position: position, quality: quality, fps: fps, orientation: orientation, mirrored: mirrored, cinematic: cinematic) }
}

public final class ClassfyStudioMediaModule: Module {
  private let engine = StudioMediaEngine()
  private let recipeEngine = StudioRecipeEngine()
  private let transcription = StudioTranscription()
  private let cameraControls = StudioCameraControls()
  private var selectionFeedback: UISelectionFeedbackGenerator?
  private var lastSelectionFeedbackAt: TimeInterval?

  public func definition() -> ModuleDefinition {
    Name("ClassfyStudioMedia")
    Events("onExportProgress", "onTranscriptionProgress")

    AsyncFunction("performStudioSelectionFeedbackAsync") { () -> Bool in
      self.performSelectionFeedback()
    }.runOnQueue(.main)

    AsyncFunction("getMediaInfoAsync") { (uri: String) async throws -> [String: Any] in
      try await self.engine.mediaInfo(uri)
    }
    AsyncFunction("generateThumbnailAsync") { (uri: String, outputUri: String, timeSeconds: Double) async throws -> [String: Any] in
      try await self.engine.thumbnail(uri, outputUri: outputUri, timeSeconds: timeSeconds)
    }
    AsyncFunction("exportTimelineAsync") { (options: StudioExportRecord) async throws -> [String: Any] in
      try await self.withExportAwake { try await self.engine.export(
        requestId: options.requestId,
        clips: options.clips.map { StudioClip(uri: $0.uri, startSeconds: $0.startSeconds, endSeconds: $0.endSeconds) },
        outputUri: options.outputUri,
        mediaType: options.mediaType,
        aspectRatio: options.aspectRatio,
        progress: { [weak self] value in
          self?.sendEvent("onExportProgress", ["requestId": options.requestId, "progress": value])
        }) }
    }
    AsyncFunction("cancelExportAsync") { (requestId: String) in
      self.engine.cancel(requestId)
      self.recipeEngine.cancel(requestId)
    }

    AsyncFunction("getStudioCameraCapabilitiesAsync") { (tag: Int, promise: Promise) in
      self.withCamera(tag, promise: promise) { _, session in
        promise.resolve(try self.cameraControls.snapshot(session))
      }
    }.runOnQueue(.main)
    AsyncFunction("configureStudioCameraAsync") { (tag: Int, options: StudioCameraConfigurationRecord, promise: Promise) in
      self.withCamera(tag, promise: promise) { _, session in
        promise.resolve(try self.cameraControls.configure(session, quality: options.quality, fps: options.fps))
      }
    }.runOnQueue(.main)
    AsyncFunction("setStudioCameraZoomAsync") { (tag: Int, factor: Double, promise: Promise) in
      self.withCamera(tag, promise: promise) { view, session in
        try self.cameraControls.zoom(session, queue: view.sessionQueue, factor: factor, validate: self.validation(for: view, session: session)) { self.settleCamera($0, promise: promise) }
      }
    }.runOnQueue(.main)
    AsyncFunction("setStudioCameraExposureAsync") { (tag: Int, bias: Double, promise: Promise) in
      self.withCamera(tag, promise: promise) { view, session in
        try self.cameraControls.exposure(session, queue: view.sessionQueue, bias: bias, validate: self.validation(for: view, session: session)) { self.settleCamera($0, promise: promise) }
      }
    }.runOnQueue(.main)
    AsyncFunction("setStudioCameraFocusAsync") { (tag: Int, options: StudioCameraFocusRecord, promise: Promise) in
      do {
        let view = try self.cameraView(tag)
        let point = try self.cameraControls.capturePoint(in: view, x: options.x, y: options.y)
        self.enqueueCamera(view, promise: promise) { view, session in
          try self.cameraControls.focus(session, queue: view.sessionQueue, point: point, locked: options.locked, validate: self.validation(for: view, session: session)) { self.settleCamera($0, promise: promise) }
        }
      } catch { promise.reject("E_STUDIO_CAMERA", error.localizedDescription) }
    }.runOnQueue(.main)
    AsyncFunction("getStudioExportCapabilitiesAsync") { () async -> [String: Any] in
      await Task.detached(priority: .userInitiated) { StudioRecipeOutputSupport.capabilities() }.value
    }
    AsyncFunction("getStudioEditorCapabilitiesAsync") { () -> [String: Any] in
      ["version": 1, "available": true, "textEffects": true, "playbackRate": true,
       "mirror": true, "motion": true, "gradient": true, "audioExtraction": true]
    }
    AsyncFunction("renderStudioRecipeThumbnailAsync") { (recipeJSON: String, outputUri: String, seconds: Double) async throws -> [String: Any] in
      try await self.recipeEngine.thumbnail(recipeJSON: recipeJSON, outputUri: outputUri, seconds: seconds)
    }
    AsyncFunction("exportRecipeAsync") { (options: StudioRecipeExportRecord) async throws -> [String: Any] in
      try await self.withExportAwake { try await self.recipeEngine.export(requestId: options.requestId, recipeJSON: options.recipeJSON, outputUri: options.outputUri,
        progress: { [weak self] value in self?.sendEvent("onExportProgress", ["requestId": options.requestId, "progress": value]) }) }
    }
    View(StudioCaptureView.self) {
      Events("onReady", "onState", "onRecordingState", "onInterruption", "onError", "onAudioMonitor", "onSpeech")
      Prop("active") { (view: StudioCaptureView, active: Bool) in view.setActive(active) }
      Prop("speechEnabled") { (view: StudioCaptureView, enabled: Bool) in view.setSpeechEnabled(enabled) }
      Prop("speechSessionId") { (view: StudioCaptureView, id: String) in view.setSpeechSessionId(id) }
      Prop("speechLocale") { (view: StudioCaptureView, locale: String) in view.setSpeechLocale(locale) }
      Prop("effectRecipeJSON") { (view: StudioCaptureView, recipe: String) in view.applyEffectRecipeJSON(recipe) }
    }
    View(StudioCompositionView.self) {
      Events("onPlaybackState", "onError")
      Prop("recipeJSON") { (view: StudioCompositionView, json: String) in Task { @MainActor in view.setRecipeJSON(json) } }
      Prop("revision") { (view: StudioCompositionView, revision: String) in Task { @MainActor in view.setRevision(revision) } }
      Prop("paused") { (view: StudioCompositionView, paused: Bool) in Task { @MainActor in view.setPausedProp(paused) } }
      Prop("liveVisualJSON") { (view: StudioCompositionView, json: String) in Task { @MainActor in view.setLiveVisualJSON(json) } }
    }
    AsyncFunction("getStudioInteractiveCompositionVersionAsync") { () -> [String: Any] in
      ["version": 1, "available": MTLCreateSystemDefaultDevice() != nil]
    }
    AsyncFunction("getStudioNativeCameraCapabilitiesAsync") { (tag: Int, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.capabilities { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("getStudioNativeCameraAudioMonitorVersionAsync") { () -> [String: Any] in
      if #available(iOS 16.0, *) { return ["version": 1, "available": true] }
      return ["version": 1, "available": false]
    }
    AsyncFunction("getStudioNativeCameraSpeechVersionAsync") { () -> [String: Any] in
      ["version": 1, "available": true, "onDeviceOnly": true]
    }
    AsyncFunction("requestStudioCaptureSpeechPermissionAsync") { (promise: Promise) in
      StudioCaptureSpeech.requestPermission { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("configureStudioNativeCameraAsync") { (tag: Int, options: StudioNativeCaptureConfigurationRecord, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.configure(options.native) { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("startStudioNativeCameraRecordingAsync") { (tag: Int, operationId: String, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.startRecording(operationId) { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("stopStudioNativeCameraRecordingAsync") { (tag: Int, operationId: String, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.stopRecording(operationId) { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("setStudioNativeCameraZoomAsync") { (tag: Int, factor: Double, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.zoom(factor) { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("setStudioNativeCameraExposureAsync") { (tag: Int, bias: Double, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.exposure(bias) { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("setStudioNativeCameraTorchAsync") { (tag: Int, enabled: Bool, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.torch(enabled) { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("setStudioNativeCameraEffectAsync") { (tag: Int, recipeJSON: String, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in
        view.setCaptureEffect(recipeJSON) { self.settleCamera($0, promise: promise) }
      }
    }.runOnQueue(.main)
    AsyncFunction("setStudioNativeCameraFocusAsync") { (tag: Int, options: StudioCameraFocusRecord, promise: Promise) in
      self.withNativeCamera(tag, promise) { view in view.focus(x: options.x, y: options.y, locked: options.locked) { self.settleCamera($0, promise: promise) } }
    }.runOnQueue(.main)
    AsyncFunction("seekStudioCompositionAsync") { (tag: Int, seconds: Double, token: Int, promise: Promise) in
      Task { @MainActor in
        do { promise.resolve(try await self.compositionView(tag).seekAsync(seconds: seconds, token: token)) }
        catch { promise.reject("E_STUDIO_PREVIEW", error.localizedDescription) }
      }
    }.runOnQueue(.main)
    AsyncFunction("previewStudioCompositionSourceAsync") { (tag: Int, clipId: String, sourceSeconds: Double, timelineSeconds: Double, token: Int, promise: Promise) in
      Task { @MainActor in
        do { promise.resolve(try await self.compositionView(tag).previewSourceFrameAsync(clipId: clipId, sourceSeconds: sourceSeconds, timelineSeconds: timelineSeconds, token: token)) }
        catch { promise.reject("E_STUDIO_PREVIEW", error.localizedDescription) }
      }
    }.runOnQueue(.main)
    AsyncFunction("restoreStudioCompositionAsync") { (tag: Int, token: Int, promise: Promise) in
      Task { @MainActor in
        do { promise.resolve(try await self.compositionView(tag).restorePlaybackAsync(token: token)) }
        catch { promise.reject("E_STUDIO_PREVIEW", error.localizedDescription) }
      }
    }.runOnQueue(.main)
    AsyncFunction("getStudioTranscriptionCapabilitiesAsync") { (locale: String) async -> [String: Any] in
      await self.transcription.capabilities(localeIdentifier: locale)
    }
    AsyncFunction("installStudioTranscriptionModelAsync") { (requestId: String, locale: String) async throws -> [String: Any] in
      try await self.transcription.installModel(requestId: requestId, localeIdentifier: locale, progress: { [weak self] stage, value in
        self?.sendEvent("onTranscriptionProgress", ["requestId": requestId, "stage": stage, "progress": value])
      })
    }
    AsyncFunction("transcribeStudioAsync") { (requestId: String, uri: String, locale: String) async throws -> [String: Any] in
      try await self.transcription.transcribe(requestId: requestId, uri: uri, localeIdentifier: locale, progress: { [weak self] stage, value in
        self?.sendEvent("onTranscriptionProgress", ["requestId": requestId, "stage": stage, "progress": value])
      })
    }
    AsyncFunction("cancelStudioTranscriptionAsync") { (requestId: String) in self.transcription.cancel(requestId) }
    OnDestroy { self.engine.cancelAll(); self.recipeEngine.cancelAll(); self.transcription.cancelAll() }
  }

  private func withExportAwake<T>(_ operation: () async throws -> T) async rethrows -> T {
    let lease = await MainActor.run { StudioExportIdleLease.shared.begin() }
    do {
      let result = try await operation()
      await MainActor.run { StudioExportIdleLease.shared.end(lease) }
      return result
    } catch {
      await MainActor.run { StudioExportIdleLease.shared.end(lease) }
      throw error
    }
  }

  private func withNativeCamera(_ tag: Int, _ promise: Promise, _ operation: (StudioCaptureView) -> Void) {
    guard tag > 0, let view = appContext?.findView(withTag: tag, ofType: StudioCaptureView.self), view.window != nil else {
      promise.reject("E_STUDIO_CAPTURE", "Abra a câmera novamente para continuar."); return
    }
    operation(view)
  }
  @MainActor private func compositionView(_ tag: Int) throws -> StudioCompositionView {
    guard tag > 0, let view = appContext?.findView(withTag: tag, ofType: StudioCompositionView.self), view.window != nil else {
      throw StudioRecipeError.invalid("Abra a prévia novamente para continuar.")
    }
    return view
  }

  private func performSelectionFeedback() -> Bool {
    guard UIApplication.shared.applicationState == .active else {
      selectionFeedback = nil
      lastSelectionFeedbackAt = nil
      return false
    }
    let now = ProcessInfo.processInfo.systemUptime
    if let last = lastSelectionFeedbackAt, now - last < 0.07 { return false }
    let generator = selectionFeedback ?? UISelectionFeedbackGenerator()
    selectionFeedback = generator
    lastSelectionFeedbackAt = now
    generator.selectionChanged()
    // Preparing after this tick reduces latency for a subsequent snap. Apple
    // does not promise a benefit from preparing immediately before a tick.
    generator.prepare()
    return true
  }

  private func cameraView(_ tag: Int) throws -> CameraView {
    guard tag > 0, let view = appContext?.findView(withTag: tag, ofType: CameraView.self), view.window != nil else {
      throw StudioCameraControlError.unavailable
    }
    return view
  }

  private func withCamera(_ tag: Int, promise: Promise, operation: @escaping (CameraView, AVCaptureSession) throws -> Void) {
    do { enqueueCamera(try cameraView(tag), promise: promise, operation: operation) }
    catch { promise.reject("E_STUDIO_CAMERA", error.localizedDescription) }
  }

  private func enqueueCamera(_ view: CameraView, promise: Promise, operation: @escaping (CameraView, AVCaptureSession) throws -> Void) {
    view.sessionQueue.async { [weak view] in
      guard let view, let session = view.session else {
        promise.reject("E_STUDIO_CAMERA", StudioCameraControlError.unavailable.localizedDescription)
        return
      }
      do { try operation(view, session) }
      catch { promise.reject("E_STUDIO_CAMERA", error.localizedDescription) }
    }
  }

  private func validation(for view: CameraView, session: AVCaptureSession) -> StudioCameraControls.ViewValidation {
    let queue = view.sessionQueue
    return { [weak view] completion in
      DispatchQueue.main.async { [weak view] in
        // UIKit liveness is read only on main. Retain the queue, not an obsolete
        // CameraView, while waiting for the device to finish an adjustment.
        let active = view?.window != nil && view?.session === session
        queue.async { completion(active && session.isRunning) }
      }
    }
  }

  private func settleCamera(_ result: Result<[String: Any], Error>, promise: Promise) {
    switch result {
    case .success(let state): promise.resolve(state)
    case .failure(let error): promise.reject("E_STUDIO_CAMERA", error.localizedDescription)
    }
  }
}
