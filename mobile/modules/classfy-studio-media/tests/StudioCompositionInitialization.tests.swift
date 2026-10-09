import AVFoundation
import CoreVideo
import Foundation

@main @MainActor
struct StudioCompositionInitializationTests {
  static func require(_ value: Bool, _ message: String) throws {
    if !value { throw StudioRecipeError.invalid("Teste do primeiro quadro: \(message)") }
  }
  static func recipe(image: Bool) throws -> String {
    let timebase = 120_000, duration = 240_000
    var video: [String: Any] = ["id": "main", "kind": "video", "assetId": "video", "startTicks": 0,
      "durationTicks": duration, "sourceStartTicks": 0, "sourceEndTicks": duration, "zIndex": 0,
      "rect": ["x": 0, "y": 0, "width": 1, "height": 1], "rotationDegrees": 0, "fit": "contain",
      "opacity": 1, "gain": 0, "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]
    var assets: [[String: Any]] = [["id": "video", "kind": "video", "uri": URL(fileURLWithPath: CommandLine.arguments[1]).absoluteString,
      "name": "Video", "durationTicks": duration, "sourceStage": "standard"]]
    var clips = [video]
    if image {
      assets.append(["id": "photo", "kind": "image", "uri": URL(fileURLWithPath: CommandLine.arguments[2]).absoluteString,
        "name": "Photo", "durationTicks": 0])
      video["id"] = "photo"; video["kind"] = "image"; video["assetId"] = "photo"; video["sourceEndTicks"] = 0
      video["zIndex"] = 1; video["rect"] = ["x": 0.1, "y": 0.1, "width": 0.25, "height": 0.25]
      clips.append(video)
    }
    let value: [String: Any] = ["version": 2, "timebase": timebase, "durationTicks": duration, "mediaType": "video",
      "canvas": ["aspectRatio": "landscape", "backgroundColor": "#000000"],
      "output": ["profile": "standard", "width": 1920, "height": 1080, "frameRateNumerator": 30,
        "frameRateDenominator": 1, "colorSpace": "rec709"], "assets": assets, "clips": clips]
    return String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
  }
  static func output(_ item: AVPlayerItem) -> AVPlayerItemVideoOutput {
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.suppressesPlayerRendering = true; item.add(output); return output
  }
  static func pixels(_ output: AVPlayerItemVideoOutput, photo: Bool) async throws {
    for _ in 0..<200 {
      if let buffer = output.copyPixelBuffer(forItemTime: .zero, itemTimeForDisplay: nil) {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        if let pointer = CVPixelBufferGetBaseAddress(buffer)?.assumingMemoryBound(to: UInt8.self) {
          let base = Int(Double(height) * 0.6) * stride + Int(Double(width) * 0.6) * 4
          let layer = Int(Double(height) * 0.22) * stride + Int(Double(width) * 0.22) * 4
          let red = pointer[base + 2] > 180 && pointer[base] < 40 && pointer[base + 1] < 40
          let selected = photo ? pointer[layer + 1] > 80 && pointer[layer + 2] < 40 && pointer[layer] < 40
            : pointer[layer + 2] > 180 && pointer[layer + 1] < 40 && pointer[layer] < 40
          CVPixelBufferUnlockBaseAddress(buffer, .readOnly)
          if red && selected { return }
        } else { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
      }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    throw StudioRecipeError.invalid("Composição pausada em zero não apresentou vídeo e imagem esperados.")
  }
  static func main() async throws {
    let engine = StudioRecipeEngine(), player = AVPlayer(); player.isMuted = true
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    for scale: Float in [1, 0.8, 0.5] {
      for hasPhoto in [false, true] {
        let prepared = try await engine.prepare(recipeJSON: recipe(image: hasPhoto))
        prepared.videoComposition!.renderScale = scale
        let item = prepared.playerItem(), output = output(item)
        player.replaceCurrentItem(with: item)
        let startedUnknown = item.status == .unknown
        // This is the View's exact initialization function: no readiness wait
        // in the harness, positive seek, preroll, or playback before the pixels.
        try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: 0) { true }
        try await pixels(output, photo: hasPhoto)
        try require(player.rate == 0 && abs(player.currentTime().seconds) < 0.00001, "quadro veio sem reprodução ou deslocamento")
        print("Primeiro quadro scale=\(scale), imagem=\(hasPhoto), começou unknown=\(startedUnknown): pixels confirmados em zero, rate=0.")
      }
    }
    let cancelled = try await engine.prepare(recipeJSON: recipe(image: false)).playerItem()
    player.replaceCurrentItem(with: cancelled)
    let stale = Task { try await StudioCompositionInitialFrame.prime(player: player, item: cancelled, seconds: 0) { true } }
    stale.cancel()
    do { try await stale.value; throw StudioRecipeError.invalid("Inicialização cancelada anunciou quadro pronto") }
    catch is CancellationError {}
    let final = try await engine.prepare(recipeJSON: recipe(image: true)).playerItem(), finalOutput = output(final)
    player.replaceCurrentItem(with: final)
    try await StudioCompositionInitialFrame.prime(player: player, item: final, seconds: 0) { true }
    try await pixels(finalOutput, photo: true)
    try require(player.rate == 0 && player.currentItem === final, "cancelamento antigo não substitui composição atual")
    do {
      try await StudioCompositionInitialFrame.prime(player: player, item: final, seconds: 1) { false }
      throw StudioRecipeError.invalid("Geração antiga conseguiu alterar cursor")
    } catch StudioRecipeError.cancelled {}
    try require(abs(player.currentTime().seconds) < 0.00001, "geração antiga preserva cursor")
    print("OK: substituição após imagem, cancelamento e geração antiga preservam primeiro quadro pausado e cursor.")
  }
}
