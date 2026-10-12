import AVFoundation
import CoreMedia
import Foundation

#if !os(macOS)
struct StudioCameraProSettings {
  var autoExposure: Bool?
  var iso: Double?
  var shutterSeconds: Double?
  var autoWhiteBalance: Bool?
  var redGain: Double?
  var greenGain: Double?
  var blueGain: Double?
  var temperatureKelvin: Double?
  var whiteBalanceTint: Double?
  var autoFocus: Bool?
  var lensPosition: Double?
}

/// Controls the existing input. No replacement session or microphone is opened.
enum StudioCameraProControls {
  static func snapshot(_ device: AVCaptureDevice) -> [String: Any] {
    let frame = CMTimeGetSeconds(device.activeVideoMinFrameDuration)
    let minimum = CMTimeGetSeconds(device.activeFormat.minExposureDuration)
    let maximum = min(CMTimeGetSeconds(device.activeFormat.maxExposureDuration), frame)
    let exposure = device.isExposureModeSupported(.custom) && minimum.isFinite && maximum.isFinite && minimum > 0 && maximum >= minimum
    let gains = device.deviceWhiteBalanceGains
    let wb = device.isLockingWhiteBalanceWithCustomDeviceGainsSupported && device.isWhiteBalanceModeSupported(.locked) && device.maxWhiteBalanceGain.isFinite && device.maxWhiteBalanceGain >= 1
    let temperature = device.temperatureAndTintValues(for: gains)
    var result: [String: Any] = ["version": 1,
      "supportsExposure": exposure, "autoExposure": device.exposureMode != .custom && device.exposureMode != .locked,
      "minISO": Double(device.activeFormat.minISO), "maxISO": Double(device.activeFormat.maxISO), "iso": Double(device.iso),
      "minShutterSeconds": minimum.isFinite ? minimum : 0, "maxShutterSeconds": maximum.isFinite ? maximum : 0,
      "shutterSeconds": CMTimeGetSeconds(device.exposureDuration),
      "supportsWhiteBalance": wb, "autoWhiteBalance": device.whiteBalanceMode != .locked,
      "minWhiteBalanceGain": 1, "maxWhiteBalanceGain": Double(device.maxWhiteBalanceGain),
      "redGain": Double(gains.redGain), "greenGain": Double(gains.greenGain), "blueGain": Double(gains.blueGain),
      "supportsFocus": device.isLockingFocusWithCustomLensPositionSupported && device.isFocusModeSupported(.locked),
      "autoFocus": device.focusMode != .locked, "lensPosition": Double(device.lensPosition)]
    let temperatureAvailable = wb && temperature.temperature.isFinite && temperature.temperature > 0 && temperature.tint.isFinite
    result["supportsTemperatureAndTint"] = temperatureAvailable
    if temperatureAvailable { result["temperatureKelvin"] = Double(temperature.temperature); result["whiteBalanceTint"] = Double(temperature.tint) }
    return result
  }

  static func apply(_ device: AVCaptureDevice, settings: StudioCameraProSettings, queue: DispatchQueue,
                    validate: @escaping (@escaping (Bool) -> Void) -> Void,
                    completion: @escaping (Result<Void, Error>) -> Void) throws {
    let values = [settings.iso, settings.shutterSeconds, settings.redGain, settings.greenGain, settings.blueGain, settings.lensPosition, settings.temperatureKelvin, settings.whiteBalanceTint].compactMap { $0 }
    guard values.allSatisfy(\.isFinite) else { throw StudioCameraProError.invalid }
    let caps = snapshot(device)
    let exposure = settings.iso != nil || settings.shutterSeconds != nil || settings.autoExposure == false
    let temperature = settings.temperatureKelvin != nil || settings.whiteBalanceTint != nil
    let rgb = settings.redGain != nil || settings.greenGain != nil || settings.blueGain != nil
    let balance = temperature || rgb || settings.autoWhiteBalance == false
    let focus = settings.lensPosition != nil || settings.autoFocus == false
    guard !(settings.autoExposure == true && exposure), !(settings.autoWhiteBalance == true && balance), !(settings.autoFocus == true && focus) else { throw StudioCameraProError.invalid }
    guard !(temperature && rgb) else { throw StudioCameraProError.invalid }
    if temperature && caps["supportsTemperatureAndTint"] as? Bool != true { throw StudioCameraProError.unsupported }
    if exposure && caps["supportsExposure"] as? Bool != true || balance && caps["supportsWhiteBalance"] as? Bool != true || focus && caps["supportsFocus"] as? Bool != true { throw StudioCameraProError.unsupported }
    if settings.autoExposure == true && !device.isExposureModeSupported(.continuousAutoExposure) && !device.isExposureModeSupported(.autoExpose) { throw StudioCameraProError.unsupported }
    if settings.autoWhiteBalance == true && !device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) && !device.isWhiteBalanceModeSupported(.autoWhiteBalance) { throw StudioCameraProError.unsupported }
    if settings.autoFocus == true && !device.isFocusModeSupported(.continuousAutoFocus) && !device.isFocusModeSupported(.autoFocus) { throw StudioCameraProError.unsupported }
    let frame = device.activeVideoMinFrameDuration
    let minSeconds = CMTimeGetSeconds(device.activeFormat.minExposureDuration)
    let maxSeconds = min(CMTimeGetSeconds(device.activeFormat.maxExposureDuration), CMTimeGetSeconds(frame))
    func bounded(_ value: Double, _ min: Double, _ max: Double) -> Double { Swift.min(max, Swift.max(min, value)) }
    let seconds = bounded(settings.shutterSeconds ?? CMTimeGetSeconds(device.exposureDuration), minSeconds, maxSeconds)
    let iso = Float(bounded(settings.iso ?? Double(device.iso), Double(device.activeFormat.minISO), Double(device.activeFormat.maxISO)))
    let previous = device.deviceWhiteBalanceGains
    let requested: AVCaptureDevice.WhiteBalanceGains
    if temperature {
      let current = device.temperatureAndTintValues(for: previous)
      // 2000–10000 K is the product's adjustment window, not an advertised
      // sensor range. The applied gains and effective temperature are read back.
      requested = device.deviceWhiteBalanceGains(for: AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
        temperature: Float(bounded(settings.temperatureKelvin ?? Double(current.temperature), 2000, 10000)),
        tint: Float(bounded(settings.whiteBalanceTint ?? Double(current.tint), -150, 150))))
    } else {
      requested = AVCaptureDevice.WhiteBalanceGains(redGain: Float(settings.redGain ?? Double(previous.redGain)),
        greenGain: Float(settings.greenGain ?? Double(previous.greenGain)), blueGain: Float(settings.blueGain ?? Double(previous.blueGain)))
    }
    let gains = try validatedGains(requested, maximum: device.maxWhiteBalanceGain)
    var pending = (exposure ? 1 : 0) + (balance ? 1 : 0) + (focus ? 1 : 0)
    var settled = false
    var watchdog: DispatchWorkItem?
    func finish(_ result: Result<Void, Error>) {
      guard !settled else { return }; settled = true; watchdog?.cancel(); completion(result)
    }
    func receipt() {
      queue.async {
        guard !settled else { return }
        validate { valid in
          guard valid else { finish(.failure(StudioCameraProError.interrupted)); return }
          pending -= 1
          if pending == 0 {
            do {
              try device.lockForConfiguration()
              device.activeVideoMinFrameDuration = frame; device.activeVideoMaxFrameDuration = frame
              device.unlockForConfiguration()
              finish(.success(()))
            } catch { finish(.failure(error)) }
          }
        }
      }
    }
    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    if settings.autoExposure == true { device.exposureMode = device.isExposureModeSupported(.continuousAutoExposure) ? .continuousAutoExposure : .autoExpose }
    if settings.autoWhiteBalance == true { device.whiteBalanceMode = device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) ? .continuousAutoWhiteBalance : .autoWhiteBalance }
    if settings.autoFocus == true { device.focusMode = device.isFocusModeSupported(.continuousAutoFocus) ? .continuousAutoFocus : .autoFocus }
    if exposure { device.setExposureModeCustom(duration: CMTime(seconds: seconds, preferredTimescale: 1_000_000_000), iso: iso) { _ in receipt() } }
    if balance { device.setWhiteBalanceModeLocked(with: gains) { _ in receipt() } }
    if focus { device.setFocusModeLocked(lensPosition: Float(bounded(settings.lensPosition ?? Double(device.lensPosition), 0, 1))) { _ in receipt() } }
    if pending == 0 { finish(.success(())); return }
    let timeout = DispatchWorkItem { finish(.failure(StudioCameraProError.interrupted)) }
    watchdog = timeout; queue.asyncAfter(deadline: .now() + 3, execute: timeout)
  }
  // AVFoundation conversion can produce gains outside the device range. Never
  // pass those directly to the hardware setter, which may raise an exception.
  static func validatedGains(_ gains: AVCaptureDevice.WhiteBalanceGains, maximum: Float) throws -> AVCaptureDevice.WhiteBalanceGains {
    let result = try StudioCameraProValues.validatedGains(red: gains.redGain, green: gains.greenGain, blue: gains.blueGain, maximum: maximum)
    return AVCaptureDevice.WhiteBalanceGains(redGain: result.red, greenGain: result.green, blueGain: result.blue)
  }
}
#endif

// The numeric boundary is platform independent; it can be exercised offline
// without instantiating AVCaptureDevice or requesting camera permission.
enum StudioCameraProValues {
  static func validatedGains(red: Float, green: Float, blue: Float, maximum: Float) throws -> (red: Float, green: Float, blue: Float) {
    guard maximum.isFinite, maximum >= 1, red.isFinite, green.isFinite, blue.isFinite else { throw StudioCameraProError.invalid }
    func bounded(_ value: Float) -> Float { min(maximum, max(1, value)) }
    return (bounded(red), bounded(green), bounded(blue))
  }
}

enum StudioCameraProError: LocalizedError {
  case invalid, unsupported, interrupted
  var errorDescription: String? {
    switch self {
    case .invalid: return "Escolha um ajuste de câmera válido."
    case .unsupported: return "Este ajuste não é compatível com a câmera e o formato atuais."
    case .interrupted: return "A câmera interrompeu a confirmação do ajuste. Tente novamente."
    }
  }
}
