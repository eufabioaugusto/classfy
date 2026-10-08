import ExpoModulesCore
import ExpoCamera
import AVFoundation

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

public final class ClassfyStudioMediaModule: Module {
  private let engine = StudioMediaEngine()
  private let cameraControls = StudioCameraControls()

  public func definition() -> ModuleDefinition {
    Name("ClassfyStudioMedia")
    Events("onExportProgress")

    AsyncFunction("getMediaInfoAsync") { (uri: String) async throws -> [String: Any] in
      try await self.engine.mediaInfo(uri)
    }
    AsyncFunction("generateThumbnailAsync") { (uri: String, outputUri: String, timeSeconds: Double) async throws -> [String: Any] in
      try await self.engine.thumbnail(uri, outputUri: outputUri, timeSeconds: timeSeconds)
    }
    AsyncFunction("exportTimelineAsync") { (options: StudioExportRecord) async throws -> [String: Any] in
      try await self.engine.export(
        requestId: options.requestId,
        clips: options.clips.map { StudioClip(uri: $0.uri, startSeconds: $0.startSeconds, endSeconds: $0.endSeconds) },
        outputUri: options.outputUri,
        mediaType: options.mediaType,
        aspectRatio: options.aspectRatio,
        progress: { [weak self] value in
          self?.sendEvent("onExportProgress", ["requestId": options.requestId, "progress": value])
        })
    }
    AsyncFunction("cancelExportAsync") { (requestId: String) in
      self.engine.cancel(requestId)
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
    OnDestroy { self.engine.cancelAll() }
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
