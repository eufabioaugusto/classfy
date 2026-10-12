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
    let temperature = readableTemperatureAndTint(device, gains: gains, supported: wb)
    var result: [String: Any] = ["version": 1,
      "supportsExposure": exposure, "autoExposure": device.exposureMode != .custom && device.exposureMode != .locked,
      "minISO": Double(device.activeFormat.minISO), "maxISO": Double(device.activeFormat.maxISO), "iso": Double(device.iso),
      "minShutterSeconds": minimum.isFinite ? minimum : 0, "maxShutterSeconds": maximum.isFinite ? maximum : 0,
      "shutterSeconds": CMTimeGetSeconds(device.exposureDuration),
      "supportsWhiteBalance": wb, "autoWhiteBalance": device.whiteBalanceMode != .locked,
      "minWhiteBalanceGain": 1, "maxWhiteBalanceGain": device.maxWhiteBalanceGain.isFinite ? Double(device.maxWhiteBalanceGain) : 0,
      "redGain": gains.redGain.isFinite ? Double(gains.redGain) : 0,
      "greenGain": gains.greenGain.isFinite ? Double(gains.greenGain) : 0,
      "blueGain": gains.blueGain.isFinite ? Double(gains.blueGain) : 0,
      "supportsFocus": device.isLockingFocusWithCustomLensPositionSupported && device.isFocusModeSupported(.locked),
      "autoFocus": device.focusMode != .locked, "lensPosition": Double(device.lensPosition)]
    result["supportsTemperatureAndTint"] = temperature != nil
    if let temperature { result["temperatureKelvin"] = Double(temperature.temperature); result["whiteBalanceTint"] = Double(temperature.tint) }
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
    // Auto, exposure and focus must remain usable while the sensor's initial
    // white-balance reading is unavailable. Do not even prepare manual gains
    // unless this command requests manual white balance.
    let manualGains = try StudioCameraProValues.manualGains(required: balance, maximum: device.maxWhiteBalanceGain) {
      let previous = device.deviceWhiteBalanceGains
      if temperature {
        // 2000–10000 K is the product's adjustment window, not an advertised
        // sensor range. The applied gains and effective temperature are read back.
        let values = try StudioCameraProValues.requestedTemperatureAndTint(
          temperature: settings.temperatureKelvin.map { Float($0) }, tint: settings.whiteBalanceTint.map { Float($0) }) {
            readableTemperatureAndTint(device, gains: previous, supported: caps["supportsWhiteBalance"] as? Bool == true)
          }
        let requested = device.deviceWhiteBalanceGains(for: AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
          temperature: values.temperature, tint: values.tint))
        return (requested.redGain, requested.greenGain, requested.blueGain)
      }
      return (Float(settings.redGain ?? Double(previous.redGain)),
        Float(settings.greenGain ?? Double(previous.greenGain)), Float(settings.blueGain ?? Double(previous.blueGain)))
    }
    let gains = manualGains.map { AVCaptureDevice.WhiteBalanceGains(redGain: $0.red, greenGain: $0.green, blueGain: $0.blue) }
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
    if let gains { device.setWhiteBalanceModeLocked(with: gains) { _ in receipt() } }
    if focus { device.setFocusModeLocked(lensPosition: Float(bounded(settings.lensPosition ?? Double(device.lensPosition), 0, 1))) { _ in receipt() } }
    if pending == 0 { finish(.success(())); return }
    let timeout = DispatchWorkItem { finish(.failure(StudioCameraProError.interrupted)) }
    watchdog = timeout; queue.asyncAfter(deadline: .now() + 3, execute: timeout)
  }
  private static func readableTemperatureAndTint(_ device: AVCaptureDevice, gains: AVCaptureDevice.WhiteBalanceGains, supported: Bool) -> StudioCameraProValues.TemperatureAndTint? {
    StudioCameraProValues.temperatureAndTintIfReady(supported: supported, red: gains.redGain, green: gains.greenGain, blue: gains.blueGain, maximum: device.maxWhiteBalanceGain) {
      let values = device.temperatureAndTintValues(for: gains)
      return (values.temperature, values.tint)
    }
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
  typealias Gains = (red: Float, green: Float, blue: Float)
  typealias TemperatureAndTint = (temperature: Float, tint: Float)

  // Unlike requested setter gains, a sensor reading must never be clamped into
  // a fabricated temperature. Apple's conversion raises NSRangeException for
  // gains outside 1...maxWhiteBalanceGain, including the initial zero reading.
  static func temperatureAndTintIfReady(supported: Bool, red: Float, green: Float, blue: Float, maximum: Float,
                                       convert: () -> TemperatureAndTint) -> TemperatureAndTint? {
    guard supported, maximum.isFinite, maximum >= 1,
      [red, green, blue].allSatisfy({ $0.isFinite && $0 >= 1 && $0 <= maximum }) else { return nil }
    let values = convert()
    guard values.temperature.isFinite, values.temperature > 0, values.tint.isFinite else { return nil }
    return values
  }

  static func manualGains(required: Bool, maximum: Float, make: () throws -> Gains) throws -> Gains? {
    guard required else { return nil }
    let gains = try make()
    return try validatedGains(red: gains.red, green: gains.green, blue: gains.blue, maximum: maximum)
  }

  // A complete saved manual setting can be reapplied before readback settles.
  // A partial setting needs a real reading for the unspecified component.
  static func requestedTemperatureAndTint(temperature: Float?, tint: Float?, current: () -> TemperatureAndTint?) throws -> TemperatureAndTint {
    guard [temperature, tint].compactMap({ $0 }).allSatisfy(\.isFinite) else { throw StudioCameraProError.invalid }
    let previous: TemperatureAndTint?
    if temperature == nil || tint == nil {
      guard let reading = current(), reading.temperature.isFinite, reading.temperature > 0, reading.tint.isFinite else { throw StudioCameraProError.unsupported }
      previous = reading
    } else { previous = nil }
    guard let resolvedTemperature = temperature ?? previous?.temperature, let resolvedTint = tint ?? previous?.tint else { throw StudioCameraProError.invalid }
    return (min(10000, max(2000, resolvedTemperature)), min(150, max(-150, resolvedTint)))
  }

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
