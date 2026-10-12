import AVFoundation
import Foundation

@main struct StudioCaptureDownsampleTests {
  static func require(_ value: Bool, _ message: String) throws { if !value { throw NSError(domain: "capture-downsample", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) } }
  static func main() async throws {
    let inputs = CommandLine.arguments.dropFirst().map { URL(fileURLWithPath: $0) }
    for (index, source) in inputs.prefix(3).enumerated() {
      let fps = index == 1 ? 60 : 24
      if index == 2 {
        let original = AVURLAsset(url: source)
        let originalTrack = try await original.loadTracks(withMediaType: .video).first!
        let originalTransform = try await originalTrack.load(.preferredTransform)
        try require(abs(originalTransform.b) > 0.9 && abs(originalTransform.c) > 0.9, "fixture deve carregar rotação90° real no track")
      }
      let result = try await StudioCaptureDownsample.twoK(source, fps: fps)
      let asset = AVURLAsset(url: result)
      let video = try await asset.loadTracks(withMediaType: .video).first!
      let size = try await video.load(.naturalSize), transform = try await video.load(.preferredTransform)
      let display = CGRect(origin: .zero, size: size).applying(transform)
      try require(Int(max(abs(display.width), abs(display.height)).rounded()) == 2560 && Int(min(abs(display.width), abs(display.height)).rounded()) == 1440, "arquivo final deve ser 2K real")
      let actualRate = Double(try await video.load(.nominalFrameRate))
      try require(abs(actualRate - Double(fps)) < 0.1, "FPS não deve virar 30 silenciosamente")
      try require(!(try await asset.loadTracks(withMediaType: .audio)).isEmpty, "áudio deve sobreviver à redução")
      try require(FileManager.default.fileExists(atPath: source.path), "fonte deve ficar intacta até o chamador confirmar a entrega")
      let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true
      let frame = try await generator.image(at: .zero).image
      let row = frame.width * 4
      var pixels = [UInt8](repeating: 0, count: row * frame.height)
      let drawn = pixels.withUnsafeMutableBytes { bytes -> Bool in
        guard let context = CGContext(data: bytes.baseAddress, width: frame.width, height: frame.height, bitsPerComponent: 8, bytesPerRow: row,
          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(frame, in: CGRect(x: 0, y: 0, width: frame.width, height: frame.height)); return true
      }
      try require(drawn, "frame final deve ser decodificável")
      for fractionX in [0.02, 0.5, 0.98] { for fractionY in [0.02, 0.5, 0.98] {
        let offset = Int(Double(frame.height - 1) * fractionY) * row + Int(Double(frame.width - 1) * fractionX) * 4
        try require(Int(pixels[offset]) + Int(pixels[offset + 1]) + Int(pixels[offset + 2]) > 20, "transform não pode deslocar a imagem para fora do quadro")
      } }
      print("PASS native 4K→2K \(fps)FPS \(Int(abs(display.width)))×\(Int(abs(display.height))) com áudio e fonte preservada")
      try FileManager.default.removeItem(at: result)
    }
    if let low = inputs.last {
      do { _ = try await StudioCaptureDownsample.twoK(low, fps: 30); throw NSError(domain: "expected-rejection", code: 1) }
      catch StudioCaptureDownsample.Failure.invalid { print("PASS fonte 1080p não vira 2K falso") }
      try require(FileManager.default.fileExists(atPath: low.path), "rejeição preserva o original")
    }
  }
}
