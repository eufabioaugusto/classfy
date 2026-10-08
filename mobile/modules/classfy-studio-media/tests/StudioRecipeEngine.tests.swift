import AVFoundation
import CoreImage
import Foundation

@main
struct StudioRecipeEngineTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioRecipeError.invalid("Teste: \(message)") }
  }
  static func pixel(_ image: CGImage, x: Int, y: Int) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: 4)
    bytes.withUnsafeMutableBytes { raw in
      let context = CGContext(data: raw.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
        space: image.colorSpace ?? StudioEffectRenderer.outputColorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      context.draw(image, in: CGRect(x: -x, y: -y, width: image.width, height: image.height))
    }
    return bytes
  }
  static func audioRMS(_ url: URL, at seconds: Double) async throws -> Double {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
      throw StudioRecipeError.invalid("Fixture sem voz para medir.")
    }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: seconds, preferredTimescale: 48_000),
      duration: CMTime(seconds: 0.08, preferredTimescale: 48_000))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMIsFloatKey: true,
      AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false,
      AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1
    ])
    reader.add(output); try require(reader.startReading(), "voz final pode ser decodificada")
    defer { reader.cancelReading() }
    var square = 0.0, count = 0
    while let sample = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
      var length = 0; var pointer: UnsafeMutablePointer<Int8>?
      guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil,
        totalLengthOut: &length, dataPointerOut: &pointer) == noErr, let pointer else { continue }
      let values = UnsafeRawPointer(pointer).assumingMemoryBound(to: Float.self)
      for index in 0..<(length / MemoryLayout<Float>.size) {
        let value = Double(values[index]); square += value * value; count += 1
      }
    }
    try require(count > 0, "intervalo medido tem amostras de voz")
    return sqrt(square / Double(count))
  }
  static func main() async throws {
    guard [6, 7].contains(CommandLine.arguments.count) else { throw StudioRecipeError.invalid("Informe red, blue, image, audio, saída e opcionalmente uma foto com rosto.") }
    let root = URL(fileURLWithPath: CommandLine.arguments[5])
    func uri(_ index: Int) -> String { URL(fileURLWithPath: CommandLine.arguments[index]).absoluteString }
    func asset(_ id: String, _ kind: String, _ index: Int) -> [String: Any] {
      ["id": id, "kind": kind, "uri": uri(index), "durationTicks": 240_000, "sourceStage": "standard"]
    }
    func clip(_ id: String, _ kind: String, _ asset: String?, _ z: Int, _ rect: [Double], _ text: String? = nil) -> [String: Any] {
      var result: [String: Any] = ["id": id, "kind": kind, "startTicks": 0, "durationTicks": 240_000,
        "sourceStartTicks": 0, "sourceEndTicks": ["video", "audio"].contains(kind) ? 240_000 : 0,
        "zIndex": z, "rect": ["x": rect[0], "y": rect[1], "width": rect[2], "height": rect[3]],
        "rotationDegrees": 0, "fit": "contain", "opacity": 1, "gain": kind == "video" ? 0 : 0.5,
        "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]
      if let asset { result["assetId"] = asset }
      if let text { result["text"] = ["content": text, "fontFamily": "system", "fontSize": 0.06,
        "color": "#FFFFFF", "backgroundColor": "#00000000", "alignment": "center"] }
      return result
    }
    let base = clip("base", "video", "red", 0, [0, 0, 1, 1])
    let pip = clip("pip", "video", "blue", 1, [0.75, 0.1, 0.2, 0.4])
    let image = clip("image", "image", "green", 2, [0.05, 0.1, 0.15, 0.2])
    let title = clip("title", "text", nil, 3, [0.15, 0.65, 0.7, 0.25], "AULA CLASSFY")
    var voice = clip("voice", "audio", "audio", 0, [0, 0, 1, 1])
    voice["durationTicks"] = 216_000; voice["sourceEndTicks"] = 216_000
    voice["fadeInTicks"] = 60_000; voice["fadeOutTicks"] = 60_000
    var recipe: [String: Any] = ["version": 2, "timebase": 120_000, "durationTicks": 240_000, "mediaType": "video",
      "canvas": ["aspectRatio": "landscape", "backgroundColor": "#000000"],
      "output": ["profile": "standard", "width": 1920, "height": 1080,
        "frameRateNumerator": 30, "frameRateDenominator": 1, "colorSpace": "rec709"],
      "assets": [asset("red", "video", 1), asset("blue", "video", 2), asset("green", "image", 3), asset("audio", "audio", 4)],
      "clips": [base, pip, image, title, voice]]
    func json(_ value: [String: Any]) throws -> String { String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)! }
    let engine = StudioRecipeEngine()
    let rotation = StudioRecipeEngine.coreImageTransform(size: CGSize(width: 320, height: 180),
      preferred: CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 180, ty: 0))
    try require(CGPoint(x: 0, y: 180).applying(rotation) == CGPoint(x: 180, y: 320), "rotação mantém canto superior no referencial CoreImage")
    try require(StudioRecipeEngine.coreImageTransform(size: CGSize(width: 320, height: 180), preferred: .identity) == .identity,
      "fonte sem rotação mantém identidade")
    let original = try Data(contentsOf: URL(string: uri(1))!)
    let prepared = try await engine.prepare(recipeJSON: json(recipe))
    try require(prepared.composition.tracks(withMediaType: .video).count == 2, "duas pistas de decodificação reais")
    try require(prepared.audioMix.inputParameters.count == 1, "áudio independente mixado")
    let direct = try await engine.frame(prepared, at: 0.8)
    // A trim handle may inspect the final .01 s of a 30 fps source. The reader
    // must still return its last complete frame for this non-aligned timestamp.
    let endFrame = try await engine.frame(prepared, at: 1.99, sourceOverride: ("base", 1.99))
    try require(pixel(endFrame, x: 960, y: 540)[0] > 190, "inspeção end−.01 entrega o último quadro")
    let out = root.appendingPathComponent("recipe-layers.mp4")
    let result = try await engine.export(requestId: "layers", recipeJSON: json(recipe), outputUri: out.absoluteString, progress: { _ in })
    try require(result["width"] as? Double == 1920 && result["height"] as? Double == 1080, "1080p explícito")
    try require(abs((result["frameRate"] as? Double ?? 0) - 30) < 0.02, "30 fps explícito")
    try require(result["hasAudio"] as? Bool == true && abs((result["duration"] as? Double ?? 0) - 2) < 0.04, "voz e duração da receita")
    let originalVoice = try await audioRMS(URL(string: uri(4))!, at: 0.8)
    let steadyVoice = try await audioRMS(out, at: 0.8)
    let fadedIn = try await audioRMS(out, at: 0.06)
    let fadedOut = try await audioRMS(out, at: 1.68)
    try require(abs(steadyVoice / originalVoice - 0.5) < 0.08, "gain0.5 altera as amostras no arquivo final")
    try require(fadedIn < steadyVoice * 0.4 && fadedOut < steadyVoice * 0.4, "fades reais reduzem a voz no início e fim")
    print("Áudio RMS: origem \(originalVoice), gain0.5 \(steadyVoice), fadeIn \(fadedIn), fadeOut \(fadedOut).")
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: out))
    generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
    let exported = try generator.copyCGImage(at: CMTime(seconds: 0.8, preferredTimescale: 120_000), actualTime: nil)
    for point in [(960, 540), (1630, 760), (240, 890)] {
      let a = pixel(direct, x: point.0, y: point.1), b = pixel(exported, x: point.0, y: point.1)
      print("Pixel \(point): preview \(a), export \(b)")
      try require(zip(a.prefix(3), b.prefix(3)).allSatisfy { abs(Int($0.0) - Int($0.1)) < 14 }, "paridade de pixels preview/export \(point): \(a) / \(b)")
    }
    let red = pixel(exported, x: 960, y: 540), blue = pixel(exported, x: 1630, y: 760), green = pixel(exported, x: 240, y: 890)
    try require(red[0] > 190 && red[2] < 40, "base vermelha sem recorte")
    try require(blue[2] > 190 && blue[0] < 40, "PIP azul transformado")
    try require(green[1] > 90 && green[0] < 40, "imagem verde sobreposta")
    // Visible text is checked independently of solid fixture pixels.
    var white = 0
    for x in stride(from: 400, to: 1500, by: 4) {
      for y in stride(from: 270, to: 380, by: 4) {
        let p = pixel(exported, x: x, y: y)
        if p[0] > 210 && p[1] > 210 && p[2] > 210 { white += 1 }
      }
    }
    try require(white > 50, "texto CoreText aparece no arquivo final")
    try require(try Data(contentsOf: URL(string: uri(1))!) == original, "original intacto")
    // A grading operation must visibly affect the file, not only preview.
    var gradedBase = base
    gradedBase["grade"] = ["preset": "studio", "intensity": 1, "exposure": -1,
      "contrast": 0.2, "saturation": -0.2, "temperature": 0]
    recipe["clips"] = [gradedBase, pip, image, title, voice]
    let gradedPrepared = try await engine.prepare(recipeJSON: json(recipe))
    let gradedFrame = try await engine.frame(gradedPrepared, at: 0.8)
    try require(pixel(gradedFrame, x: 960, y: 540)[0] < pixel(direct, x: 960, y: 540)[0] - 20, "grade real reduz exposição")
    let gradedURL = root.appendingPathComponent("recipe-graded.mp4")
    _ = try await engine.export(requestId: "graded", recipeJSON: json(recipe), outputUri: gradedURL.absoluteString, progress: { _ in })
    let gradedGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: gradedURL))
    gradedGenerator.requestedTimeToleranceBefore = .zero; gradedGenerator.requestedTimeToleranceAfter = .zero
    let gradedExport = try gradedGenerator.copyCGImage(at: CMTime(seconds: 0.8, preferredTimescale: 120_000), actualTime: nil)
    let gradedA = pixel(gradedFrame, x: 960, y: 540), gradedB = pixel(gradedExport, x: 960, y: 540)
    try require(zip(gradedA.prefix(3), gradedB.prefix(3)).allSatisfy { abs(Int($0.0) - Int($0.1)) < 14 }, "grade tem paridade no arquivo exportado")
    if CommandLine.arguments.count == 7 {
      let faceURL = URL(fileURLWithPath: CommandLine.arguments[6])
      guard var faceImage = CIImage(contentsOf: faceURL, options: [.applyOrientationProperty: true]) else {
        throw StudioRecipeError.invalid("Não foi possível ler a fixture de rosto.")
      }
      if let roi = ProcessInfo.processInfo.environment["STUDIO_FACE_ROI"] {
        let values = roi.split(separator: ",").compactMap { Double($0) }
        try require(values.count == 4 && values.allSatisfy(\.isFinite), "ROI de rosto x,y,width,height válido")
        let region = CGRect(x: values[0], y: values[1], width: values[2], height: values[3]).intersection(faceImage.extent)
        try require(region.width > 0 && region.height > 0, "ROI existe na foto, sem alterar o arquivo original")
        faceImage = faceImage.cropped(to: region).transformed(by: CGAffineTransform(translationX: -region.minX, y: -region.minY))
      }
      let renderer = StudioEffectRenderer()
      let faces = renderer.faceRegions(in: faceImage)
      try require(!faces.isEmpty, "Vision detecta um rosto real na fixture")
      let face = faces[0]
      let lit = renderer.faceIllumination(faceImage)
      let original = renderer.context.createCGImage(faceImage, from: faceImage.extent, format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace)!
      let changed = renderer.context.createCGImage(lit, from: lit.extent, format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace)!
      let before = pixel(original, x: Int(face.midX), y: Int(face.midY))
      let after = pixel(changed, x: Int(face.midX), y: Int(face.midY))
      try require(zip(before.prefix(3), after.prefix(3)).contains { $0.1 > $0.0 }, "luz localizada aumenta canais no rosto")
      let backgroundBefore = pixel(original, x: 0, y: 0), backgroundAfter = pixel(changed, x: 0, y: 0)
      try require(backgroundBefore == backgroundAfter, "luz do rosto não altera o fundo fora da máscara")
      let begin = Date()
      for _ in 0..<10 { _ = renderer.faceRegions(in: faceImage) }
      print("Vision 256px: \(faces.count) rosto(s); média local \(Date().timeIntervalSince(begin) * 100) ms/detecção; \(before) → \(after)")
    }
    // Selecting the first clip while the cursor is in the second must inspect
    // that selected original, without another z0 base covering it.
    var first = base; first["durationTicks"] = 120_000; first["sourceEndTicks"] = 120_000
    var second = clip("second", "video", "blue", 0, [0, 0, 1, 1])
    second["startTicks"] = 120_000; second["durationTicks"] = 120_000; second["sourceEndTicks"] = 120_000
    var sequential = recipe; sequential["clips"] = [first, second]
    let sequentialPrepared = try await engine.prepare(recipeJSON: json(sequential))
    let inspectedFirst = try await engine.frame(sequentialPrepared, at: 1.4, sourceOverride: ("base", 0.2))
    try require(pixel(inspectedFirst, x: 960, y: 540)[0] > 190, "take inspecionado não é coberto pelo take sob o cursor")
    for name in ["rotated-quadrants.mov", "rotated-real.mov"] {
      let sourceURL = root.appendingPathComponent(name)
      guard FileManager.default.fileExists(atPath: sourceURL.path) else { continue }
      let originalBytes = try Data(contentsOf: sourceURL)
      let asset = AVURLAsset(url: sourceURL)
      let track = try await asset.loadTracks(withMediaType: .video)[0]
      let transform = try await track.load(.preferredTransform)
      try require(abs(transform.b) > 0.5 && abs(transform.c) > 0.5, "fixture tem rotação 90° real na track")
      var rotatedAsset = selfAsset(uri: sourceURL.absoluteString)
      rotatedAsset["durationTicks"] = Int64((try await asset.load(.duration).seconds * 120_000).rounded(.down))
      var rotatedClip = base; rotatedClip["durationTicks"] = 120_000; rotatedClip["sourceEndTicks"] = 120_000
      var rotatedRecipe = recipe; rotatedRecipe["assets"] = [rotatedAsset]; rotatedRecipe["clips"] = [rotatedClip]
      rotatedRecipe["durationTicks"] = 120_000
      let rotatedPrepared = try await engine.prepare(recipeJSON: json(rotatedRecipe))
      let rotatedPreview = try await engine.frame(rotatedPrepared, at: 0)
      let rotatedOut = root.appendingPathComponent(name + ".export.mp4")
      _ = try await engine.export(requestId: name, recipeJSON: json(rotatedRecipe), outputUri: rotatedOut.absoluteString, progress: { _ in })
      let expectedGenerator = AVAssetImageGenerator(asset: asset); expectedGenerator.appliesPreferredTrackTransform = true
      expectedGenerator.requestedTimeToleranceBefore = .zero; expectedGenerator.requestedTimeToleranceAfter = .zero
      let expected = try expectedGenerator.copyCGImage(at: .zero, actualTime: nil)
      let actualGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: rotatedOut))
      actualGenerator.requestedTimeToleranceBefore = .zero; actualGenerator.requestedTimeToleranceAfter = .zero
      let actual = try actualGenerator.copyCGImage(at: .zero, actualTime: nil)
      let fit = min(1920.0 / Double(expected.width), 1080.0 / Double(expected.height))
      let originX = (1920 - Double(expected.width) * fit) / 2
      let originY = (1080 - Double(expected.height) * fit) / 2
      var maximumDifference = 0
      for fraction in [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)] {
        let x = Int(Double(expected.width) * fraction.0), y = Int(Double(expected.height) * fraction.1)
        let outputX = Int(originX + Double(x) * fit), outputY = Int(originY + Double(y) * fit)
        let a = pixel(expected, x: x, y: y), b = pixel(actual, x: outputX, y: outputY)
        let p = pixel(rotatedPreview, x: outputX, y: outputY)
        let difference = zip(a.prefix(3), b.prefix(3)).map { abs(Int($0.0) - Int($0.1)) }.max() ?? 0
        maximumDifference = max(maximumDifference, difference)
        try require(difference < 24, "rotação 90° preserva quadrante da origem \(name): \(a) / \(b)")
        try require(zip(p.prefix(3), b.prefix(3)).allSatisfy { abs(Int($0.0) - Int($0.1)) < 14 }, "rotação mantém preview/export iguais")
      }
      try require(try Data(contentsOf: sourceURL) == originalBytes, "rotação não altera o arquivo importado")
      print("Rotação 90° \(name): dimensões exibidas \(expected.width)x\(expected.height), erro máximo \(maximumDifference) canais RGB.")
    }
    var refusedThreeVideos = false
    recipe["clips"] = [base, pip, clip("third", "video", "red", 3, [0, 0, 0.1, 0.1])]
    do { _ = try StudioRecipeEngine.decode(json(recipe)) } catch { refusedThreeVideos = true }
    try require(refusedThreeVideos, "três vídeos simultâneos recusados")
    var refusedRaw = false
    var rawAsset = asset("red", "video", 1); rawAsset["sourceStage"] = "cinematicRaw"
    recipe["assets"] = [rawAsset]; recipe["clips"] = [base]
    do { _ = try StudioRecipeEngine.decode(json(recipe)) } catch { refusedRaw = true }
    try require(refusedRaw, "Cinematic cru não recebe bokeh falso")
    recipe["assets"] = [asset("red", "video", 1)]
    let cancelledOutput = root.appendingPathComponent("recipe-cancelled.mp4")
    var cancelled = false
    do {
      _ = try await engine.export(requestId: "cancel", recipeJSON: json(recipe), outputUri: cancelledOutput.absoluteString,
        progress: { _ in engine.cancel("cancel") })
    } catch { cancelled = true }
    try require(cancelled && !FileManager.default.fileExists(atPath: cancelledOutput.path), "cancelamento inicial limpa somente destino")
    print("OK: receita real 2 vídeos + imagem + CoreText + voz/fades, grade, paridade preview/export, limites e cancelamento. \(out.path)")
  }

  static func selfAsset(uri: String) -> [String: Any] {
    ["id": "red", "kind": "video", "uri": uri, "durationTicks": 240_000, "sourceStage": "standard"]
  }
}
