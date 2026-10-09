import AVFoundation
import CoreImage
import CoreVideo
import Foundation

@main struct StudioCompositionInteractionTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioRecipeError.invalid("Teste interativo: \(message)") }
  }
  static func json(_ object: Any) throws -> String { String(data: try JSONSerialization.data(withJSONObject: object), encoding: .utf8)! }
  static func recipe() -> [String: Any] {
    func asset(_ id: String, _ kind: String, _ arg: Int) -> [String: Any] {
      ["id": id, "kind": kind, "uri": URL(fileURLWithPath: CommandLine.arguments[arg]).absoluteString, "durationTicks": 240_000, "sourceStage": "standard"]
    }
    func clip(_ id: String, _ kind: String, _ asset: String?, _ z: Int, _ rect: [Double], _ opacity: Double = 1) -> [String: Any] {
      var value: [String: Any] = ["id": id, "kind": kind, "startTicks": 0, "durationTicks": 120_000,
        "sourceStartTicks": 0, "sourceEndTicks": kind == "video" ? 120_000 : 0, "zIndex": z,
        "rect": ["x": rect[0], "y": rect[1], "width": rect[2], "height": rect[3]], "rotationDegrees": 0,
        "fit": "cover", "opacity": opacity, "gain": 0.8, "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]
      if let asset { value["assetId"] = asset }; return value
    }
    var main = clip("main", "video", "red", 0, [0, 0, 1, 1])
    main["grade"] = ["preset": "studio", "intensity": 0.65, "exposure": -0.6, "contrast": 0.1, "saturation": -0.1, "temperature": 0.1]
    var text = clip("title", "text", nil, 3, [0.13, 0.5, 0.48, 0.25])
    text["text"] = ["content": "AULA COM QUALIDADE\nTexto de verdade", "fontFamily": "System", "fontSize": 0.045,
      "color": "#FFFFFF", "backgroundColor": "#00000090", "alignment": "left"]
    return ["version": 2, "timebase": 120_000, "durationTicks": 120_000, "mediaType": "video",
      "canvas": ["aspectRatio": "landscape", "backgroundColor": "#162029"],
      "output": ["profile": "standard", "width": 1920, "height": 1080, "frameRateNumerator": 30, "frameRateDenominator": 1, "colorSpace": "rec709"],
      "assets": [asset("red", "video", 1), asset("blue", "video", 2), asset("green", "image", 3)],
      "clips": [main, clip("pip", "video", "blue", 1, [0.67, 0.15, 0.22, 0.5], 0.7),
        clip("image", "image", "green", 2, [0.07, 0.06, 0.2, 0.2], 0.5), text]]
  }
  static func pixels(_ image: CIImage, _ prepared: StudioPreparedRecipe) throws -> [UInt8] {
    let width = 1920, height = 1080
    var data = [UInt8](repeating: 0, count: width * height * 4)
    data.withUnsafeMutableBytes { prepared.renderer.context.render(image, toBitmap: $0.baseAddress!, rowBytes: width * 4,
      bounds: CGRect(x: 0, y: 0, width: width, height: height), format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace) }
    return data
  }
  static func parity(_ original: [String: Any], _ id: String, _ rect: [Double], _ font: Double? = nil) async throws {
    let engine = StudioRecipeEngine(), prepared = try await engine.prepare(recipeJSON: json(original))
    let frozen = try await engine.frozenFrame(prepared, at: 0.5).processed()
    var final = original, clips = final["clips"] as! [[String: Any]]
    let index = clips.firstIndex { $0["id"] as? String == id }!
    clips[index]["rect"] = ["x": rect[0], "y": rect[1], "width": rect[2], "height": rect[3]]
    if let font { var text = clips[index]["text"] as! [String: Any]; text["fontSize"] = font; clips[index]["text"] = text }
    final["clips"] = clips
    let saved = try engine.updateVisuals(prepared, recipeJSON: json(final))!
    let expected = try await engine.frozenFrame(saved, at: 0.5)
    let live = try frozen.image(override: StudioRecipeVisualOverride(clipId: id,
      rect: StudioRecipe.Rect(x: rect[0], y: rect[1], width: rect[2], height: rect[3]), textFontSize: font))
    let a = try pixels(live, prepared), b = try pixels(expected.image(), saved)
    let worst = zip(a, b).map { abs(Int($0.0) - Int($0.1)) }.max()!
    try require(worst <= 2, "\(id): pixels interativos e receita final divergem \(worst)")
    try require(frozen.prepared === prepared && frozen.seconds == 0.5 && prepared.recipe.clips[index].rect.width != rect[2], "snapshot/original preservados")
    print("Paridade \(id): grade, ordem, alpha e fonte intactos; diferença máxima \(worst)/255.")
  }
  static func protocolChecks() throws {
    let base: [String: Any] = ["version": 1, "revision": "project:1", "active": true, "sequence": 5,
      "operationId": "main:2:5", "epoch": 2, "clipId": "main", "phase": "committing",
      "transform": ["rect": ["x": 0.1, "y": 0.2, "width": 0.8, "height": 0.8]]]
    let patch = try StudioCompositionInteractionPatch.decode(json(base))
    try require(patch.finish == nil && patch.phase == "committing", "pré-commit não fabrica recibo durável")
    for property in ["version", "phase", "transform"] {
      var invalid = base
      if property == "version" { invalid[property] = 2 }
      if property == "phase" { invalid[property] = "idle" }
      if property == "transform" { invalid[property] = ["rect": ["x": 0, "y": 0, "width": -1, "height": 1]] }
      do { _ = try StudioCompositionInteractionPatch.decode(json(invalid)); throw StudioRecipeError.invalid("Teste: payload inválido aceito") }
      catch { if error.localizedDescription.contains("Teste:") { throw error } }
    }
    print("Protocolo: versão, fase/active e geometria rejeitam payload incompatível.")
  }
  static func handoffChecks() throws {
    let original = recipe(), previous = try StudioRecipeEngine.decode(json(original))
    var value = original, clips = value["clips"] as! [[String: Any]]
    clips[0]["rect"] = ["x": 0.15, "y": 0.14, "width": 0.72, "height": 0.72]
    value["clips"] = clips
    let canonical = try StudioRecipeEngine.decode(json(value))
    let patch = try StudioCompositionInteractionPatch.decode(json(["version": 1, "revision": "old", "active": true,
      "sequence": 4, "operationId": "main:3", "epoch": 3, "clipId": "main", "phase": "gesture",
      "transform": ["rect": ["x": 0.15, "y": 0.14, "width": 0.72, "height": 0.72]]]))
    try require(patch.preservesComposition(previous, canonical), "recipe antes de committing mantém handoff da mesma mídia")
    for key in ["gain", "sourceStartTicks", "zIndex", "grade"] {
      var changed = value, modified = clips
      if key == "grade" { modified[0][key] = ["preset": "natural", "intensity": 1, "exposure": 0, "contrast": 0, "saturation": 0, "temperature": 0] }
      else { modified[0][key] = key == "gain" ? 0 : 1 }
      if key == "sourceStartTicks" { modified[0]["sourceEndTicks"] = 120_001 }
      changed["clips"] = modified
      let next = try StudioRecipeEngine.decode(json(changed))
      try require(!patch.preservesComposition(previous, next), "mudança \(key) não preserva snapshot antigo")
    }
    for receiptFirst in [false, true] {
      var gate = StudioCompositionHandoffGate()
      gate.begin(operationId: patch.operationId, committed: receiptFirst)
      try require(!gate.canRevealCanonical, "recibo antes do prime não remove superfície")
      gate.acknowledgeCommit(operationId: "old")
      gate.prime(operationId: "old")
      try require(!gate.canRevealCanonical, "operação anterior não confirma handoff atual")
      gate.prime(operationId: patch.operationId)
      try require(gate.canRevealCanonical == receiptFirst, "prime aguarda recibo real se ainda pendente")
      gate.acknowledgeCommit(operationId: patch.operationId)
      try require(gate.canRevealCanonical, "prime e recibo da mesma operação liberam superfície")
      gate.begin(operationId: patch.operationId, committed: false)
      try require(!gate.canRevealCanonical && gate.durableCommit, "receita nova exige prime novo, mantendo recibo já confirmado")
      gate.reset()
      try require(!gate.canRevealCanonical, "cancelamento elimina todos os acknowledgments")
    }
    var gate = StudioCompositionHandoffGate()
    gate.begin(operationId: patch.operationId, committed: false)
    gate.acknowledgeCommit(operationId: patch.operationId)
    try require(!gate.canRevealCanonical, "receipt durante prime não revela quadro antigo")
    gate.prime(operationId: patch.operationId)
    try require(gate.canRevealCanonical, "receipt durante prime conclui só após quadro canônico")
    print("Handoff: recipe/committing/recibo em ordens distintas aguardam prime e save da mesma operação.")
  }
  static func rms(_ url: URL) async throws -> Double {
    let asset = AVURLAsset(url: url), track = try await asset.loadTracks(withMediaType: .audio).first!
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM,
      AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false])
    reader.add(output); try require(reader.startReading(), "leitor PCM inicia")
    var square = 0.0, count = 0
    while let sample = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
      let byteCount = CMBlockBufferGetDataLength(block)
      var data = Data(count: byteCount)
      data.withUnsafeMutableBytes { storage in _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: byteCount, destination: storage.baseAddress!) }
      data.withUnsafeBytes { storage in for value in storage.bindMemory(to: Float.self) { square += Double(value) * Double(value); count += 1 } }
    }
    try require(count > 0, "stream silencioso continua contendo amostras")
    return sqrt(square / Double(count))
  }
  static func audioChecks() async throws {
    var value = recipe()
    value["mediaType"] = "audio"
    var asset = (value["assets"] as! [[String: Any]])[0]; asset["kind"] = "audio"
    value["assets"] = [asset]
    var clip = (value["clips"] as! [[String: Any]])[0]; clip["kind"] = "audio"; clip["gain"] = 0
    clip.removeValue(forKey: "grade"); value["clips"] = [clip]
    let engine = StudioRecipeEngine(), directory = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent()
    let silent = directory.appendingPathComponent("silent.m4a"), audible = directory.appendingPathComponent("audible.m4a")
    let result = try await engine.export(requestId: "mute", recipeJSON: json(value), outputUri: silent.absoluteString, progress: { _ in })
    try require(result["hasAudio"] as? Bool == true && abs((result["duration"] as! Double) - 1) < 0.04, "mute export preserva stream/duração")
    let muted = try await rms(silent)
    try require(muted < 0.00001, "mute RMS \(muted) deveria ser silêncio")
    clip["gain"] = 1; value["clips"] = [clip]
    _ = try await engine.export(requestId: "unmute", recipeJSON: json(value), outputUri: audible.absoluteString, progress: { _ in })
    let original = try await rms(audible)
    try require(original > 0.03, "unmute volta áudio original \(original)")
    print("Áudio real: mute1s tem stream PCM/RMS \(muted); unmute RMS \(original), original preservado.")
  }
  @MainActor static func replacementChecks() async throws {
    let engine = StudioRecipeEngine(), player = AVPlayer()
    player.isMuted = true
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    var value = recipe()
    for stage in ["initial", "mute", "unmute"] {
      var clips = value["clips"] as! [[String: Any]]
      clips[0]["gain"] = stage == "mute" ? 0 : 0.8; value["clips"] = clips
      let prepared = try await engine.prepare(recipeJSON: json(value)), item = prepared.playerItem()
      let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
      output.suppressesPlayerRendering = true; item.add(output); player.replaceCurrentItem(with: item)
      try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: 0, isCurrent: { player.currentItem === item })
      var frame: CVPixelBuffer?
      for _ in 0..<100 {
        frame = output.copyPixelBuffer(forItemTime: .zero, itemTimeForDisplay: nil)
        if frame != nil { break }; try await Task.sleep(nanoseconds: 20_000_000)
      }
      guard let frame else { throw StudioRecipeError.invalid("Teste: troca \(stage) não produziu o primeiro quadro") }
      let image = CIImage(cvPixelBuffer: frame, options: [.colorSpace: StudioEffectRenderer.outputColorSpace])
      let data = try pixels(image, prepared)
      let offset = (750 * 1920 + 900) * 4
      try require(data[offset] > 100 && data[offset] > data[offset + 2] + 40, "troca \(stage) entrega vídeo tratado no zero, sem quadro preto")
      try require(player.currentTime().seconds == 0 && player.rate == 0, "troca preserva cursor e pausa")
      print("AVPlayer reprepare \(stage): frame0 real não preto, cursor0 e pausa preservados.")
    }
  }
  static func main() async throws {
    try protocolChecks()
    try handoffChecks()
    let base = recipe()
    try await parity(base, "main", [0.15, 0.14, 0.72, 0.72])
    try await parity(base, "pip", [0.35, 0.2, 0.3, 0.68])
    try await parity(base, "image", [0.42, 0.15, 0.32, 0.32])
    try await parity(base, "title", [0.05, 0.1, 0.72, 0.375], 0.0675)
    try await audioChecks()
    try await replacementChecks()
    print("Edição interativa aprovada sem UI, seek por movimento ou troca de receita por frame.")
  }
}
