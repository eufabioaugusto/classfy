import AVFoundation
import CoreImage
import CoreVideo
import Foundation

// AVAssetReader rejects renderScale != 1. The regression must go through a
// real AVPlayer render context, without a window, UI automation or screenshots.
@main @MainActor
struct StudioVideoCompositorTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioRecipeError.invalid("Teste de renderização: \(message)") }
  }

  static func close(_ a: CGFloat, _ b: CGFloat, tolerance: CGFloat = 0.00001) -> Bool {
    abs(a - b) < tolerance
  }

  static func geometry() throws {
    let canvas = CGSize(width: 1920, height: 1080)
    let identity = try StudioVideoRenderGeometry.coreImageTransform(canvasSize: canvas,
      destinationSize: canvas, renderTransform: .identity)
    try require(identity == .identity, "exportação 1x preserva a transformação identidade")
    for scale: CGFloat in [0.8, 0.5] {
      let transform = try StudioVideoRenderGeometry.coreImageTransform(canvasSize: canvas,
        destinationSize: CGSize(width: 1920 * scale, height: 1080 * scale),
        renderTransform: CGAffineTransform(scaleX: scale, y: scale))
      try require(close(transform.a, scale) && close(transform.d, scale)
        && close(transform.tx, 0) && close(transform.ty, 0), "escala mantém origem CoreImage")
    }
    // A context may additionally encode non-square pixels and edge padding.
    // This transform represents scale .8, pixel-aspect ratio 1.5, and padding
    // of 10 px horizontally / 6 px vertically. AVFoundation's origin is top-left.
    let padded = try StudioVideoRenderGeometry.coreImageTransform(canvasSize: canvas,
      destinationSize: CGSize(width: 2324, height: 876),
      renderTransform: CGAffineTransform(a: 1.2, b: 0, c: 0, d: 0.8, tx: 10, ty: 6))
    let lowerLeft = CGPoint.zero.applying(padded)
    let upperRight = CGPoint(x: 1920, y: 1080).applying(padded)
    try require(close(lowerLeft.x, 10) && close(lowerLeft.y, 6)
      && close(upperRight.x, 2314) && close(upperRight.y, 870),
      "pixel aspect e bordas são aplicados no referencial bottom-left correto")
    // Asymmetric vertical padding catches using the logical canvas height
    // instead of the actual destination-buffer height during the second flip.
    let asymmetric = try StudioVideoRenderGeometry.coreImageTransform(canvasSize: canvas,
      destinationSize: CGSize(width: 960, height: 600),
      renderTransform: CGAffineTransform(a: 0.5, b: 0, c: 0, d: 0.5, tx: 0, ty: 20))
    try require(close(CGPoint.zero.applying(asymmetric).y, 40)
      && close(CGPoint(x: 0, y: 1080).applying(asymmetric).y, 580),
      "padding superior/inferior assimétrico mantém orientação")
    for size in [CGSize.zero, CGSize(width: CGFloat.infinity, height: 1080)] {
      do {
        _ = try StudioVideoRenderGeometry.coreImageTransform(canvasSize: size,
          destinationSize: canvas, renderTransform: .identity)
        throw StudioRecipeError.invalid("Teste: tamanho inválido aceito")
      } catch let error as StudioRecipeError {
        if error.localizedDescription.contains("Teste:") { throw error }
      }
    }
    print("Geometria: identidade, escalas .8/.5, pixel aspect, padding assimétrico e tamanho inválido aprovados.")
  }

  struct Sample {
    var width: Int
    var height: Int
    var pixels: [[UInt8]]
    var blueLeft: Double
    var blueRight: Double
    var blueTop: Double
    var blueBottom: Double
    var textPixels: Int
  }

  static func sample(_ buffer: CVPixelBuffer) throws -> Sample {
    try require(CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA,
      "saída do player é BGRA para inspeção determinística")
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let address = CVPixelBufferGetBaseAddress(buffer) else {
      throw StudioRecipeError.invalid("Frame sem pixels.")
    }
    let bytes = address.assumingMemoryBound(to: UInt8.self)
    let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    func pixel(_ x: Int, _ y: Int) -> [UInt8] {
      let index = y * stride + x * 4
      return [bytes[index + 2], bytes[index + 1], bytes[index], bytes[index + 3]]
    }
    func isBlue(_ x: Int, _ y: Int) -> Bool {
      let p = pixel(x, y)
      return p[2] > 180 && p[0] < 40 && p[1] < 40
    }
    let blueColumns = (0..<width).filter { isBlue($0, Int(Double(height) * 0.5)) }
    let blueRows = (0..<height).filter { isBlue(Int(Double(width) * 0.79), $0) }
    guard let left = blueColumns.first, let right = blueColumns.last,
      let top = blueRows.first, let bottom = blueRows.last else {
      throw StudioRecipeError.invalid("PIP desapareceu na escala da prévia.")
    }
    // Sample well inside solid regions, so codec chroma subsampling and
    // resampling at glyph boundaries cannot disguise a geometry regression.
    let points: [(Double, Double)] = [(0.5, 0.5), (0.79, 0.4), (0.12, 0.2)]
    let pixels = points.map { pixel(Int($0.0 * Double(width)), Int($0.1 * Double(height))) }
    var white = 0
    for row in 0..<30 {
      for column in 0..<120 {
        let p = pixel(Int((0.15 + Double(column) / 120 * 0.7) * Double(width)),
          Int((0.65 + Double(row) / 30 * 0.25) * Double(height)))
        if p[0] > 210 && p[1] > 210 && p[2] > 210 { white += 1 }
      }
    }
    return Sample(width: width, height: height, pixels: pixels,
      blueLeft: Double(left) / Double(width), blueRight: Double(right) / Double(width),
      blueTop: Double(top) / Double(height), blueBottom: Double(bottom) / Double(height), textPixels: white)
  }

  static func playerFrame(_ prepared: StudioPreparedRecipe, scale: Float) async throws -> Sample {
    prepared.videoComposition!.renderScale = scale
    let item = prepared.playerItem()
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ])
    output.suppressesPlayerRendering = true
    item.add(output)
    let player = AVPlayer(playerItem: item)
    player.isMuted = true
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    for _ in 0..<100 {
      if item.status != .unknown { break }
      try await Task.sleep(nanoseconds: 50_000_000)
    }
    guard item.status == .readyToPlay else {
      throw item.error ?? StudioRecipeError.invalid("AVPlayer não preparou a composição.")
    }
    let time = CMTime(seconds: 0.5, preferredTimescale: 120_000)
    let seekCompleted = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
      player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
        continuation.resume(returning: finished)
      }
    }
    try require(seekCompleted, "seek do player concluiu")
    for _ in 0..<100 {
      if let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) {
        return try sample(buffer)
      }
      try await Task.sleep(nanoseconds: 50_000_000)
    }
    throw StudioRecipeError.invalid("AVPlayer não entregou o quadro composto.")
  }

  static func recipe() throws -> String {
    func asset(_ id: String, _ kind: String, _ index: Int) -> [String: Any] {
      ["id": id, "kind": kind, "uri": URL(fileURLWithPath: CommandLine.arguments[index]).absoluteString,
       "durationTicks": 240_000, "sourceStage": "standard"]
    }
    func clip(_ id: String, _ kind: String, _ asset: String?, _ z: Int, _ rect: [Double]) -> [String: Any] {
      var result: [String: Any] = ["id": id, "kind": kind, "startTicks": 0, "durationTicks": 120_000,
        "sourceStartTicks": 0, "sourceEndTicks": kind == "video" ? 120_000 : 0,
        "zIndex": z, "rect": ["x": rect[0], "y": rect[1], "width": rect[2], "height": rect[3]],
        "rotationDegrees": 0, "fit": "contain", "opacity": 1, "gain": 0,
        "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]
      if let asset { result["assetId"] = asset }
      return result
    }
    var base = clip("base", "video", "red", 0, [0, 0, 1, 1])
    base["grade"] = ["preset": "studio", "intensity": 1, "exposure": -0.7,
      "contrast": 0.2, "saturation": -0.2, "temperature": 0]
    let pip = clip("pip", "video", "blue", 1, [0.65, 0.08, 0.28, 0.72])
    let overlay = clip("image", "image", "green", 2, [0.05, 0.1, 0.15, 0.2])
    var title = clip("title", "text", nil, 3, [0.15, 0.65, 0.7, 0.25])
    title["text"] = ["content": "AULA CLASSFY", "fontFamily": "System", "fontSize": 0.06,
      "color": "#FFFFFF", "backgroundColor": "#00000000", "alignment": "center"]
    let value: [String: Any] = ["version": 2, "timebase": 120_000, "durationTicks": 120_000,
      "mediaType": "video", "canvas": ["aspectRatio": "landscape", "backgroundColor": "#000000"],
      "output": ["profile": "standard", "width": 1920, "height": 1080,
        "frameRateNumerator": 30, "frameRateDenominator": 1, "colorSpace": "rec709"],
      "assets": [asset("red", "video", 1), asset("blue", "video", 2), asset("green", "image", 3)],
      "clips": [base, pip, overlay, title]]
    return String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
  }

  static func main() async throws {
    try require(CommandLine.arguments.count == 4, "informe fixtures vermelha, azul e imagem verde")
    try geometry()
    let json = try recipe(), engine = StudioRecipeEngine()
    var reference: Sample?
    for scale: Float in [1, 0.8, 0.5] {
      let sample = try await playerFrame(engine.prepare(recipeJSON: json), scale: scale)
      try require(sample.width == Int((1920 * scale).rounded())
        && sample.height == Int((1080 * scale).rounded()), "player realmente produz buffer na escala \(scale)")
      try require(abs(sample.blueLeft - 0.67609375) < 0.003 && abs(sample.blueRight - 0.90390625) < 0.003
        && abs(sample.blueTop - 0.08) < 0.004 && abs(sample.blueBottom - 0.8) < 0.004,
        "PIP inteiro ocupa a mesma posição horizontal/vertical na escala \(scale)")
      try require(sample.pixels[0][0] > 100 && sample.pixels[0][0] < 225,
        "tratamento da base é real e permanece visível")
      try require(sample.pixels[1][2] > 180 && sample.pixels[1][0] < 40, "segunda fonte azul aparece")
      try require(sample.pixels[2][1] > 90 && sample.pixels[2][0] < 40, "imagem verde aparece")
      try require(sample.textPixels > 60, "texto CoreText aparece na posição normalizada")
      if let reference {
        for (full, reduced) in zip(reference.pixels, sample.pixels) {
          try require(zip(full.prefix(3), reduced.prefix(3)).allSatisfy { abs(Int($0.0) - Int($0.1)) <= 3 },
            "pixels de grade e camadas preservados ao reduzir preview")
        }
      } else { reference = sample }
      print("AVPlayer scale=\(scale): \(sample.width)x\(sample.height), PIP x=\(sample.blueLeft)..\(sample.blueRight), y=\(sample.blueTop)..\(sample.blueBottom), texto=\(sample.textPixels), pixels=\(sample.pixels)")
    }
    print("Compositor aprovado: três escalas reais do AVPlayer, duas fontes, imagem, texto e grade preservados; sem janela ou captura de UI.")
  }
}
