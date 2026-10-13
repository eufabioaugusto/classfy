import AVFoundation
import CoreImage
import CoreVideo
import Foundation

@main struct StudioRemoteCameraGradeTests {
  static func sample(_ image: CIImage, renderer: StudioEffectRenderer, x: CGFloat, y: CGFloat) -> [UInt8] {
    var pixel = [UInt8](repeating: 0, count: 4)
    renderer.context.render(image, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: x, y: y, width: 1, height: 1), format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace)
    return pixel
  }
  static func frame(_ url: URL, seconds: Double = 0.15) async throws -> CGImage {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
    generator.appliesPreferredTrackTransform = true
    return try await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 120000)).image
  }
  static func buffer(_ image: CIImage, width: Int, height: Int, renderer: StudioEffectRenderer) -> CVPixelBuffer {
    var output: CVPixelBuffer?
    assert(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
      [kCVPixelBufferIOSurfacePropertiesKey: [:], kCVPixelBufferMetalCompatibilityKey: true] as CFDictionary, &output) == kCVReturnSuccess)
    renderer.render(image, to: output!, bounds: CGRect(x: 0, y: 0, width: width, height: height))
    CVBufferSetAttachment(output!, kCVImageBufferCGColorSpaceKey, StudioEffectRenderer.outputColorSpace, .shouldPropagate)
    CVBufferSetAttachment(output!, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(output!, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
    return output!
  }
  static func main() async throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1]), engine = StudioRecipeEngine(), renderer = StudioEffectRenderer()
    let source = root.appendingPathComponent("source.mov"), sourceBytes = try Data(contentsOf: source)
    var outputs: [String: URL] = [:]
    for name in ["natural", "warm"] {
      let uri = root.appendingPathComponent("\(name)-4k.mp4")
      let json = try String(contentsOf: root.appendingPathComponent("\(name).json"), encoding: .utf8)
      let result = try await engine.export(requestId: "remote-grade-\(name)", recipeJSON: json, outputUri: uri.absoluteString, progress: { _ in })
      assert(result["mimeType"] as? String == "video/mp4")
      let encoded = AVURLAsset(url: uri), video = try await encoded.loadTracks(withMediaType: .video).first!
      let natural = try await video.load(.naturalSize), transform = try await video.load(.preferredTransform)
      let display = CGRect(origin: .zero, size: natural).applying(transform)
      assert(Int(abs(display.width)) == 3840 && Int(abs(display.height)) == 2160)
      let rate = try await video.load(.nominalFrameRate), duration = try await encoded.load(.duration)
      assert(abs(Double(rate) - 30) < 0.02 && abs(duration.seconds - 0.4) < 0.1)
      let audio = try await encoded.loadTracks(withMediaType: .audio)
      assert(!audio.isEmpty)
      outputs[name] = uri
    }
    let preserved = try Data(contentsOf: source)
    assert(preserved == sourceBytes)
    let raw = CIImage(cgImage: try await frame(outputs["natural"]!)), warm = CIImage(cgImage: try await frame(outputs["warm"]!))
    let rawPixel = sample(raw, renderer: renderer, x: 1000, y: 1000), warmPixel = sample(warm, renderer: renderer, x: 1000, y: 1000)
    assert(zip(rawPixel.prefix(3), warmPixel.prefix(3)).map { abs(Int($0) - Int($1)) }.max()! > 4)
    // The top-left marker remains in the same quadrant; no crop/rotation/flip.
    let marker = sample(warm, renderer: renderer, x: 150, y: 2000), background = sample(warm, renderer: renderer, x: 1000, y: 2000)
    assert(marker[2] > background[2] + 20)
    let inputImage = CIImage(cgImage: try await frame(source)), input = buffer(inputImage, width: 3840, height: 2160, renderer: renderer)
    let grade = StudioImageGrade(intensity: 0.7, exposure: 0.25, contrast: 0.1, saturation: 0.15, temperature: 0.4)
    let processor = StudioRemoteFrameRenderer(renderer: renderer)
    let preview = try processor.render(input, grade: grade, width: 1920, height: 1080)
    assert(CVPixelBufferGetWidth(preview) == 1920 && CVPixelBufferGetHeight(preview) == 1080)
    let previewPixel = sample(CIImage(cvPixelBuffer: preview), renderer: renderer, x: 500, y: 500)
    print("Fixture RGB clean/treated/remote: \(rawPixel)/\(warmPixel)/\(previewPixel)")
    assert(zip(previewPixel.prefix(3), warmPixel.prefix(3)).map { abs(Int($0) - Int($1)) }.max()! <= 8)
    let previewMarker = sample(CIImage(cvPixelBuffer: preview), renderer: renderer, x: 75, y: 1000)
    assert(previewMarker[2] > previewPixel[2] + 20)
    let portrait = buffer(inputImage.transformed(by: CGAffineTransform(rotationAngle: .pi / 2)).transformed(by: CGAffineTransform(translationX: 2160, y: 0)), width: 2160, height: 3840, renderer: renderer)
    let portraitPreview = try processor.render(portrait, grade: grade, width: 1080, height: 1920)
    assert(CVPixelBufferGetWidth(portraitPreview) == 1080 && CVPixelBufferGetHeight(portraitPreview) == 1920)
    let bounded = StudioRemoteFrameRenderer(renderer: renderer)
    var held: [CVPixelBuffer] = []
    for _ in 0..<3 { held.append(try bounded.render(input, grade: grade, width: 1920, height: 1080)) }
    do { _ = try bounded.render(input, grade: grade, width: 1920, height: 1080); assertionFailure("pool must remain bounded") }
    catch StudioRemoteFrameRenderError.busy {}
    held.removeAll()
    print("PASS actual 4K30 MP4 + audio, changed grade, marker geometry, clean source unchanged")
    print("PASS processed RTC buffer 1080p matches encoded grade within8/255; portrait1080×1920; pool≤3")
  }
}
