import AVFoundation
import CoreMedia
import ExpoCamera
import UIKit

enum StudioCameraControlError: LocalizedError {
  case unavailable
  case recording
  case invalid(String)
  case unsupported(String)

  var errorDescription: String? {
    switch self {
    case .unavailable: return "A câmera ainda não está pronta. Aguarde e tente novamente."
    case .recording: return "Finalize o take antes de alterar a resolução ou os FPS."
    case .invalid(let message), .unsupported(let message): return message
    }
  }
}

/// Uses the input already owned by Expo Camera. It never creates a device,
/// input or session, and all hardware operations run on CameraView.sessionQueue.
final class StudioCameraControls {
  typealias Completion = (Result<[String: Any], Error>) -> Void
  typealias ViewValidation = (@escaping (Bool) -> Void) -> Void
  private let requestLock = NSLock()
  private var focusRequests: [String: UUID] = [:]
  private var zoomRequests: [String: UUID] = [:]
  private let choices: [(quality: String, width: Int32, height: Int32)] = [
    ("720p", 1280, 720), ("1080p", 1920, 1080), ("2160p", 3840, 2160)
  ]
  private let frameRates = [24, 30, 60]

  func device(in session: AVCaptureSession) throws -> AVCaptureDevice {
    guard session.isRunning,
      let device = session.inputs.compactMap({ $0 as? AVCaptureDeviceInput })
      .first(where: { $0.device.hasMediaType(.video) })?.device else {
      throw StudioCameraControlError.unavailable
    }
    return device
  }

  private func dimensions(_ format: AVCaptureDevice.Format) -> CMVideoDimensions {
    CMVideoFormatDescriptionGetDimensions(format.formatDescription)
  }

  private func supports(_ format: AVCaptureDevice.Format, fps: Int) -> Bool {
    format.videoSupportedFrameRateRanges.contains {
      Double(fps) >= $0.minFrameRate && Double(fps) <= $0.maxFrameRate
    }
  }

  private func isCompatible(_ format: AVCaptureDevice.Format, session: AVCaptureSession) -> Bool {
    !session.outputs.contains { output in
      format.unsupportedCaptureOutputClasses.contains { output.isKind(of: $0) }
    }
  }

  private func formats(in session: AVCaptureSession, device: AVCaptureDevice, quality: String) -> [AVCaptureDevice.Format] {
    guard let choice = choices.first(where: { $0.quality == quality }) else { return [] }
    return device.formats.filter {
      let size = dimensions($0)
      return size.width == choice.width && size.height == choice.height && isCompatible($0, session: session)
    }
  }

  private func qualities(in session: AVCaptureSession, device: AVCaptureDevice) -> [[String: Any]] {
    choices.compactMap { choice in
      let available = formats(in: session, device: device, quality: choice.quality)
      let fps = frameRates.filter { rate in available.contains { supports($0, fps: rate) } }
      guard !fps.isEmpty else { return nil }
      return ["quality": choice.quality, "width": Int(choice.width), "height": Int(choice.height), "fps": fps]
    }
  }

  private func zoomRange(_ device: AVCaptureDevice) -> ClosedRange<CGFloat> {
    let lower = max(1, device.minAvailableVideoZoomFactor)
    let upper = max(lower, min(device.maxAvailableVideoZoomFactor, device.activeFormat.videoMaxZoomFactor))
    return lower...upper
  }

  func snapshot(_ session: AVCaptureSession) throws -> [String: Any] {
    let device = try device(in: session)
    let size = dimensions(device.activeFormat)
    let quality = choices.first(where: { $0.width == size.width && $0.height == size.height })?.quality
    let duration = CMTimeGetSeconds(device.activeVideoMinFrameDuration)
    let fps: Any = duration.isFinite && duration > 0 ? (1 / duration) : NSNull()
    let zoom = zoomRange(device)
    let focus = device.isFocusPointOfInterestSupported &&
      (device.isFocusModeSupported(.autoFocus) || device.isFocusModeSupported(.continuousAutoFocus))
    let exposure = (device.isExposureModeSupported(.autoExpose) || device.isExposureModeSupported(.continuousAutoExposure)) &&
      device.minExposureTargetBias.isFinite && device.maxExposureTargetBias.isFinite &&
      device.maxExposureTargetBias > device.minExposureTargetBias
    return [
      "deviceId": device.uniqueID,
      "position": device.position == .front ? "front" : device.position == .back ? "back" : "unspecified",
      "qualities": qualities(in: session, device: device), "quality": quality as Any? ?? NSNull(),
      "fps": fps, "width": Int(size.width), "height": Int(size.height),
      "minZoom": Double(zoom.lowerBound), "maxZoom": Double(zoom.upperBound), "zoom": Double(device.videoZoomFactor),
      "minExposure": Double(device.minExposureTargetBias), "maxExposure": Double(device.maxExposureTargetBias),
      "exposure": Double(device.exposureTargetBias),
      "aperture": device.lensAperture > 0 && device.lensAperture.isFinite ? Double(device.lensAperture) : NSNull(),
      "supportsFocus": focus, "supportsFocusLock": focus && device.isFocusModeSupported(.locked),
      "supportsExposure": exposure,
      "supportsExposureLock": device.isExposurePointOfInterestSupported && device.isExposureModeSupported(.locked),
      "supportsTorch": device.hasTorch && device.isTorchAvailable && device.isTorchModeSupported(.on),
      "focusLocked": focus && device.focusMode == .locked,
      "exposureLocked": device.exposureMode == .locked,
      "torchEnabled": device.isTorchActive,
      "isRecording": session.outputs.compactMap { $0 as? AVCaptureMovieFileOutput }.contains { $0.isRecording }
    ]
  }

  func configure(_ session: AVCaptureSession, quality: String, fps: Int) throws -> [String: Any] {
    let device = try device(in: session)
    guard !session.outputs.compactMap({ $0 as? AVCaptureMovieFileOutput }).contains(where: { $0.isRecording }) else {
      throw StudioCameraControlError.recording
    }
    guard frameRates.contains(fps), choices.contains(where: { $0.quality == quality }) else {
      throw StudioCameraControlError.invalid("Escolha uma resolução e um FPS disponíveis nesta câmera.")
    }
    let available = formats(in: session, device: device, quality: quality).filter { supports($0, fps: fps) }
    guard !available.isEmpty, session.canSetSessionPreset(.inputPriority) else {
      throw StudioCameraControlError.unsupported("Esta câmera não suporta \(quality) a \(fps) FPS. Escolha outra combinação.")
    }
    // Preserve an already matching format. Otherwise prefer ordinary full-range
    // video instead of a photo-only/HDR subtype with an incompatible output.
    let selected = available.first(where: { $0 === device.activeFormat }) ?? available.first(where: {
      CMFormatDescriptionGetMediaSubType($0.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    }) ?? available[0]
    let frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
    session.beginConfiguration()
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      session.sessionPreset = .inputPriority
      device.activeFormat = selected
      device.activeVideoMinFrameDuration = frameDuration
      device.activeVideoMaxFrameDuration = frameDuration
      // A new format can reduce the legal zoom range.
      let range = zoomRange(device)
      device.cancelVideoZoomRamp()
      device.videoZoomFactor = min(range.upperBound, max(range.lowerBound, device.videoZoomFactor))
    } catch {
      session.commitConfiguration()
      throw error
    }
    session.commitConfiguration()
    return try snapshot(session)
  }

  /// The point is normalized in CameraView coordinates, not sensor coordinates.
  /// CALayer conversion belongs on main, before dispatching device work.
  func capturePoint(in view: CameraView, x: Double, y: Double) throws -> CGPoint {
    guard x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y), view.bounds.width > 0, view.bounds.height > 0 else {
      throw StudioCameraControlError.invalid("Toque dentro da imagem para escolher o foco.")
    }
    func findPreview(_ layer: CALayer) -> AVCaptureVideoPreviewLayer? {
      if let preview = layer as? AVCaptureVideoPreviewLayer, preview.session === view.session { return preview }
      for child in layer.sublayers ?? [] { if let preview = findPreview(child) { return preview } }
      return nil
    }
    guard let preview = findPreview(view.layer), preview.connection?.isEnabled == true else {
      throw StudioCameraControlError.unavailable
    }
    let point = CGPoint(x: view.bounds.minX + CGFloat(x) * view.bounds.width, y: view.bounds.minY + CGFloat(y) * view.bounds.height)
    let layerPoint = preview.convert(point, from: view.layer)
    let sensorPoint = preview.captureDevicePointConverted(fromLayerPoint: layerPoint)
    guard sensorPoint.x.isFinite, sensorPoint.y.isFinite else { throw StudioCameraControlError.unavailable }
    return CGPoint(x: min(1, max(0, sensorPoint.x)), y: min(1, max(0, sensorPoint.y)))
  }

  func zoom(_ session: AVCaptureSession, queue: DispatchQueue, factor: Double, validate: @escaping ViewValidation, completion: @escaping Completion) throws {
    guard factor.isFinite else { throw StudioCameraControlError.invalid("Escolha um zoom válido.") }
    let device = try device(in: session)
    let range = zoomRange(device)
    guard range.upperBound > range.lowerBound else {
      throw StudioCameraControlError.unsupported("O zoom não está disponível nesta câmera.")
    }
    let target = min(range.upperBound, max(range.lowerBound, CGFloat(factor)))
    let token = UUID()
    requestLock.lock(); zoomRequests[device.uniqueID] = token; requestLock.unlock()
    try device.lockForConfiguration()
    device.cancelVideoZoomRamp()
    device.ramp(toVideoZoomFactor: target, withRate: 4)
    device.unlockForConfiguration()
    let deadline = Date().addingTimeInterval(2)
    func confirm() {
      validate { active in
      do {
        guard active else { throw StudioCameraControlError.unavailable }
        guard try self.device(in: session) === device else { throw StudioCameraControlError.unavailable }
        self.requestLock.lock(); let latest = self.zoomRequests[device.uniqueID] == token; self.requestLock.unlock()
        if !latest { completion(.success(try self.snapshot(session))); return }
        if !device.isRampingVideoZoom || Date() >= deadline {
          if Date() >= deadline && device.isRampingVideoZoom {
            try device.lockForConfiguration()
            device.cancelVideoZoomRamp()
            device.videoZoomFactor = target
            device.unlockForConfiguration()
          }
          completion(.success(try self.snapshot(session)))
        } else { queue.asyncAfter(deadline: .now() + 0.05) { confirm() } }
      } catch { completion(.failure(error)) }
      }
    }
    queue.asyncAfter(deadline: .now() + 0.05) { confirm() }
  }

  func exposure(_ session: AVCaptureSession, queue: DispatchQueue, bias: Double, validate: @escaping ViewValidation, completion: @escaping Completion) throws {
    guard bias.isFinite else { throw StudioCameraControlError.invalid("Escolha uma exposição válida.") }
    let device = try device(in: session)
    guard device.maxExposureTargetBias > device.minExposureTargetBias,
      device.isExposureModeSupported(.continuousAutoExposure) || device.isExposureModeSupported(.autoExpose) else {
      throw StudioCameraControlError.unsupported("O ajuste de exposição não está disponível nesta câmera.")
    }
    guard device.exposureMode != .locked else {
      throw StudioCameraControlError.unsupported("Destrave a exposição antes de ajustar a luz.")
    }
    let target = min(device.maxExposureTargetBias, max(device.minExposureTargetBias, Float(bias)))
    var settled = false
    func finish(_ result: Result<[String: Any], Error>) {
      // Both completion and timeout are serialized by CameraView.sessionQueue.
      guard !settled else { return }
      settled = true
      completion(result)
    }
    try device.lockForConfiguration()
    device.setExposureTargetBias(target) { _ in
      validate { active in
        do {
          guard active else { throw StudioCameraControlError.unavailable }
          guard try self.device(in: session) === device else { throw StudioCameraControlError.unavailable }
          finish(.success(try self.snapshot(session)))
        } catch { finish(.failure(error)) }
      }
    }
    device.unlockForConfiguration()
    queue.asyncAfter(deadline: .now() + 3) {
      finish(.failure(StudioCameraControlError.invalid("A câmera interrompeu o ajuste de luz. Tente novamente.")))
    }
  }

  func focus(_ session: AVCaptureSession, queue: DispatchQueue, point: CGPoint, locked: Bool, validate: @escaping ViewValidation, completion: @escaping Completion) throws {
    let device = try device(in: session)
    let focus = device.isFocusPointOfInterestSupported &&
      (device.isFocusModeSupported(.autoFocus) || device.isFocusModeSupported(.continuousAutoFocus))
    let exposure = device.isExposurePointOfInterestSupported &&
      (device.isExposureModeSupported(.autoExpose) || device.isExposureModeSupported(.continuousAutoExposure))
    guard focus || exposure else { throw StudioCameraControlError.unsupported("Esta câmera não oferece foco ou exposição por toque.") }
    if locked && !(focus && device.isFocusModeSupported(.locked) || exposure && device.isExposureModeSupported(.locked)) {
      throw StudioCameraControlError.unsupported("Esta câmera não permite travar foco ou exposição.")
    }
    let token = UUID()
    requestLock.lock(); focusRequests[device.uniqueID] = token; requestLock.unlock()
    try device.lockForConfiguration()
    if focus {
      device.focusPointOfInterest = point
      device.focusMode = device.isFocusModeSupported(.autoFocus) ? .autoFocus : .continuousAutoFocus
    }
    if exposure {
      device.exposurePointOfInterest = point
      device.exposureMode = device.isExposureModeSupported(.autoExpose) ? .autoExpose : .continuousAutoExposure
    }
    device.unlockForConfiguration()
    guard locked else { completion(.success(try snapshot(session))); return }
    // Allow the selected point to settle before locking. A newer tap supersedes
    // the old lock, so delayed work cannot lock an unrelated point or camera.
    let deadline = Date().addingTimeInterval(1.5)
    func finishLock() {
      validate { active in
      do {
        guard active else { throw StudioCameraControlError.unavailable }
        guard try self.device(in: session) === device else { throw StudioCameraControlError.unavailable }
        self.requestLock.lock(); let latest = self.focusRequests[device.uniqueID] == token; self.requestLock.unlock()
        guard latest else { completion(.success(try self.snapshot(session))); return }
        if (device.isAdjustingFocus || device.isAdjustingExposure) && Date() < deadline {
          queue.asyncAfter(deadline: .now() + 0.05) { finishLock() }; return
        }
        try device.lockForConfiguration()
        if focus && device.isFocusModeSupported(.locked) { device.focusMode = .locked }
        if exposure && device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
        device.unlockForConfiguration()
        completion(.success(try self.snapshot(session)))
      } catch { completion(.failure(error)) }
      }
    }
    queue.asyncAfter(deadline: .now() + 0.15) { finishLock() }
  }
}
