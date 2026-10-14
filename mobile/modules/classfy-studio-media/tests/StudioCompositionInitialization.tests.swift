import AVFoundation
import CoreVideo
import Foundation
import IOSurface

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
  static func receiptChecks() throws {
    func buffer() throws -> CVPixelBuffer {
      var value: CVPixelBuffer?
      let status = CVPixelBufferCreate(kCFAllocatorDefault, 32, 24, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &value)
      try require(status == kCVReturnSuccess && value != nil, "buffer IOSurface real disponível")
      return value!
    }
    let produced = try buffer(), other = try buffer()
    let surface = CVPixelBufferGetIOSurface(produced)!.takeUnretainedValue()
    var wrapped: Unmanaged<CVPixelBuffer>?
    try require(CVPixelBufferCreateWithIOSurface(kCFAllocatorDefault, surface, nil, &wrapped) == kCVReturnSuccess,
      "wrapper novo sobre a mesma superfície")
    let output = wrapped!.takeRetainedValue(), key = StudioRecipeCompositor.visualRevisionKey
    let unrelated = "classfy.studio.receipt-test-unrelated" as CFString
    CVBufferSetAttachment(produced, unrelated, "preserve" as CFString, .shouldPropagate)
    IOSurfaceSetValue(surface, unrelated, "preserve" as CFString)
    StudioRecipeCompositor.stampVisualReceipt(produced, revision: "revision-A")
    try require(CVBufferGetAttachment(output, key, nil) == nil, "wrapper não herdou attachment CV")
    try require(StudioCompositionFrameReceipt.read(output).source == "surface"
      && StudioCompositionFrameReceipt.read(output).revision == "revision-A", "mesma superfície conserva recibo sem attachment")
    try require(StudioCompositionFrameReceipt.read(other).revision == nil, "outra superfície não confirma revisão")
    CVBufferSetAttachment(output, key, "wrong" as CFString, .shouldPropagate)
    try require(StudioCompositionFrameReceipt.read(output).source == "attachment"
      && StudioCompositionFrameReceipt.read(output).revision == "wrong", "attachment errado prevalece sobre surface correta")
    CVBufferSetAttachment(output, key, NSNumber(value: 7), .shouldPropagate)
    try require(StudioCompositionFrameReceipt.read(output).revision == nil
      && StudioCompositionFrameReceipt.read(output).source == "attachment", "attachment não string não faz fallback")
    CVBufferRemoveAttachment(output, key)
    IOSurfaceSetValue(surface, key, NSNumber(value: 7))
    try require(StudioCompositionFrameReceipt.read(output).revision == nil, "surface não string não confirma")
    IOSurfaceSetValue(surface, key, "wrong" as CFString)
    try require(StudioCompositionFrameReceipt.read(output).revision != "revision-A", "surface de revisão errada rejeitada")
    StudioRecipeCompositor.clearVisualReceipt(produced)
    try require(StudioCompositionFrameReceipt.read(produced).revision == nil
      && StudioCompositionFrameReceipt.read(output).revision == nil, "pool limpo antes de render/cancelar não herda recibo")
    try require(CVBufferGetAttachment(produced, unrelated, nil)?.takeUnretainedValue() as? String == "preserve"
      && IOSurfaceCopyValue(surface, unrelated) as? String == "preserve", "limpeza preserva metadata alheia")
    StudioRecipeCompositor.stampVisualReceipt(produced, revision: "revision-B")
    try require(StudioCompositionFrameReceipt.read(output).revision != "revision-A"
      && StudioCompositionFrameReceipt.read(output).revision == "revision-B", "restamp A→B invalida A no wrapper existente")
    StudioRecipeCompositor.clearVisualReceipt(produced)
    try require(StudioCompositionFrameReceipt.read(output).source == "missing", "surface sem marker falha fechada")
    print("IOSurface real: wrapper sem CVattachment, outra superfície, tipos/revisões erradas, pool A→B e limpeza seletiva confirmados.")
  }
  static func pixels(_ output: StudioCompositionFrameOutput, revision: String, photo: Bool) async throws {
    for _ in 0..<200 {
      if let buffer = output.frame(at: 0, revision: revision) {
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
    try receiptChecks()
    let engine = StudioRecipeEngine(), player = AVPlayer(); player.isMuted = true
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    for scale: Float in [1, 0.8, 0.5] {
      for hasPhoto in [false, true] {
        let prepared = try await engine.prepare(recipeJSON: recipe(image: hasPhoto))
        let revision = prepared.visualRevision!
        prepared.videoComposition!.renderScale = scale
        let item = prepared.playerItem(), output = StudioCompositionFrameOutput(item: item)
        output.output.suppressesPlayerRendering = true
        player.replaceCurrentItem(with: item)
        let startedUnknown = item.status == .unknown
        // This is the View's exact initialization function: no readiness wait
        // in the harness, positive seek, preroll, or playback before the pixels.
        try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: 0,
          visualRevision: revision, frameOutput: output) { true }
        try await pixels(output, revision: revision, photo: hasPhoto)
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
    let finalPrepared = try await engine.prepare(recipeJSON: recipe(image: true))
    let final = finalPrepared.playerItem(), finalOutput = StudioCompositionFrameOutput(item: final)
    finalOutput.output.suppressesPlayerRendering = true
    player.replaceCurrentItem(with: final)
    try await StudioCompositionInitialFrame.prime(player: player, item: final, seconds: 0,
      visualRevision: finalPrepared.visualRevision, frameOutput: finalOutput) { true }
    try await pixels(finalOutput, revision: finalPrepared.visualRevision!, photo: true)
    try require(player.rate == 0 && player.currentItem === final, "cancelamento antigo não substitui composição atual")
    do {
      try await StudioCompositionInitialFrame.prime(player: player, item: final, seconds: 1) { false }
      throw StudioRecipeError.invalid("Geração antiga conseguiu alterar cursor")
    } catch StudioRecipeError.cancelled {}
    try require(abs(player.currentTime().seconds) < 0.00001, "geração antiga preserva cursor")
    print("OK: substituição após imagem, cancelamento e geração antiga preservam primeiro quadro pausado e cursor.")
  }
}
