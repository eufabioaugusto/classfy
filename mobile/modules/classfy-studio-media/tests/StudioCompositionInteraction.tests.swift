import AVFoundation
import CoreImage
import CoreVideo
import Foundation
import IOSurface

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
  static func mixedRMS(_ prepared: StudioPreparedRecipe) throws -> Double {
    let tracks = prepared.composition.tracks(withMediaType: .audio)
    let reader = try AVAssetReader(asset: prepared.composition)
    let output = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM,
      AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false])
    output.audioMix = prepared.audioMix; reader.add(output)
    try require(reader.startReading(), "mix atualizado inicia leitor real")
    var square = 0.0, count = 0
    while let sample = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
      let byteCount = CMBlockBufferGetDataLength(block)
      var data = Data(count: byteCount)
      data.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: byteCount, destination: $0.baseAddress!) }
      data.withUnsafeBytes { for value in $0.bindMemory(to: Float.self) { square += Double(value) * Double(value); count += 1 } }
    }
    try require(count > 0 && reader.status == .completed, "mix atualizado contém PCM completo")
    return sqrt(square / Double(count))
  }
  @MainActor static func fastControlChecks() async throws {
    let engine = StudioRecipeEngine(), originalJSON = recipe()
    let original = try await engine.prepare(recipeJSON: json(originalJSON))
    let item = original.playerItem()
    let frameOutput = StudioCompositionFrameOutput(item: item)
    let player = AVPlayer(playerItem: item)
    player.isMuted = true
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: 0.5,
      visualRevision: original.visualRevision, frameOutput: frameOutput, isCurrent: { player.currentItem === item })
    let nativeTime = player.currentTime()
    let displayedComposition = item.videoComposition
    let nativeBeforeBuffer = frameOutput.frame(at: 0.5, revision: original.visualRevision!)!
    let nativeBefore = try pixels(CIImage(cvPixelBuffer: nativeBeforeBuffer, options: [.colorSpace: StudioEffectRenderer.outputColorSpace]), original)
    var value = originalJSON, clips = value["clips"] as! [[String: Any]]
    clips[0]["gain"] = 0; value["clips"] = clips
    guard let muted = try engine.updateVisuals(original, recipeJSON: json(value)) else { throw StudioRecipeError.invalid("Teste: mute provocou rebuild") }
    try require(muted.composition === original.composition && muted.videoComposition === original.videoComposition,
      "mute mantém exatamente decoder/tracks/composição visual")
    try require(muted.audioTrackIDs == original.audioTrackIDs && muted.audioMix !== original.audioMix, "mute troca só o mix das mesmas tracks")
    item.audioMix = muted.audioMix
    try require(player.currentItem === item && item.videoComposition === displayedComposition && player.currentTime() == nativeTime && player.rate == 0,
      "mute não troca item, quadro, cursor ou pausa do AVPlayer")
    let silence = try mixedRMS(muted), audible = try mixedRMS(original)
    try require(silence < 0.00001 && audible > 0.03, "mix verdadeiro mute/unmute: \(silence)/\(audible)")
    guard let unmuted = try engine.updateVisuals(muted, recipeJSON: json(originalJSON)) else { throw StudioRecipeError.invalid("Teste: unmute provocou rebuild") }
    item.audioMix = unmuted.audioMix
    let unmuteRMS = try mixedRMS(unmuted)
    try require(unmuted.videoComposition === original.videoComposition && unmuteRMS > 0.03,
      "unmute retorna áudio sem invalidar quadro")
    var hiddenJSON = originalJSON, hiddenClips = hiddenJSON["clips"] as! [[String: Any]]
    hiddenClips[2]["opacity"] = 0; hiddenJSON["clips"] = hiddenClips
    guard let hidden = try engine.updateVisuals(unmuted, recipeJSON: json(hiddenJSON)) else { throw StudioRecipeError.invalid("Teste: ocultar imagem provocou rebuild") }
    try require(hidden.composition === original.composition && hidden.audioMix === unmuted.audioMix && hidden.videoComposition !== original.videoComposition,
      "hide mantém decoder/áudio e atualiza só instruções de pintura")
    let beforeFrame = try await engine.frozenFrame(original, at: 0.5), afterFrame = try await engine.frozenFrame(hidden, at: 0.5)
    let before = try pixels(beforeFrame.image(), original), after = try pixels(afterFrame.image(), hidden)
    let stable = (500 * 1920 + 900) * 4
    try require(Array(before[stable..<stable+4]) == Array(after[stable..<stable+4]), "hide preserva vídeo principal e demais camadas")
    try require(zip(before, after).filter { $0 != $1 }.count > 100, "hide altera realmente pixels da imagem alvo")
    frameOutput.prepareForChange(at: 0.5)
    item.videoComposition = hidden.videoComposition
    try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: 0.5,
      visualRevision: hidden.visualRevision, frameOutput: frameOutput, isCurrent: { player.currentItem === item })
    try require(player.currentItem === item && player.currentTime() == nativeTime && player.rate == 0, "hide confirma novo quadro no mesmo item/tempo")
    var frame: CVPixelBuffer?
    for _ in 0..<100 {
      frame = frameOutput.frame(at: 0.5, revision: hidden.visualRevision!)
      if frame != nil { break }; try await Task.sleep(nanoseconds: 20_000_000)
    }
    guard let frame else { throw StudioRecipeError.invalid("Teste: prime de hide não produziu pixels reais") }
    let rendered = try pixels(CIImage(cvPixelBuffer: frame, options: [.colorSpace: StudioEffectRenderer.outputColorSpace]), hidden)
    var changedPixels = 0, outsideDifference = 0
    for pixel in 0..<(1920 * 1080) {
      let x = pixel % 1920, y = pixel / 1920, offset = pixel * 4
      let difference = zip(rendered[offset..<offset+4], nativeBefore[offset..<offset+4]).map { abs(Int($0) - Int($1)) }.max()!
      if x >= 133 && x <= 520 && y >= 63 && y <= 282 { if difference > 3 { changedPixels += 1 } }
      else { outsideDifference = max(outsideDifference, difference) }
    }
    try require(changedPixels > 100 && outsideDifference <= 3,
      "receipt hide muda ROI da imagem e preserva demais pixels: \(changedPixels) / \(outsideDifference)")
    print("Controles fast path: mute/unmute PCM real, mesmo AVPlayerItem/videoComposition; hide atualiza só alvo, cursor0.5 intacto.")
  }
  @MainActor static func delayedHoldChecks() async throws {
    let engine = StudioRecipeEngine(), prepared = try await engine.prepare(recipeJSON: json(recipe()))
    for reason in ["same", "seek", "background", "recipe", "dispose"] {
      var gate = StudioCompositionReplacementGate(), generation = 7
      let lease = gate.lease(generation: generation)
      let worker = Task.detached { try await engine.frame(prepared, at: 0.5) }
      if reason == "recipe" { generation += 1 }
      else if reason != "same" { gate.invalidate() }
      let image = try await worker.value
      try require(image.width == 1920 && gate.owns(lease, generation: generation) == (reason == "same"),
        "snapshot real atrasado após \(reason) não pode reinstalar pose antiga")
    }
    print("Hold atrasado: worker real descartado após seek/background/nova receita/dispose; mesma operação mantém o quadro.")
  }
  static func surfaceFrameReceiptCheck(_ frame: CVPixelBuffer, revision: String,
                                       prepared: StudioPreparedRecipe, expectedPixels: [UInt8]) throws {
    guard let surface = CVPixelBufferGetIOSurface(frame)?.takeUnretainedValue() else {
      throw StudioRecipeError.invalid("Teste: quadro real do AVPlayer não contém IOSurface")
    }
    var transported: Unmanaged<CVPixelBuffer>?
    let status = CVPixelBufferCreateWithIOSurface(kCFAllocatorDefault, surface, nil, &transported)
    guard status == kCVReturnSuccess, let wrapped = transported?.takeRetainedValue() else {
      throw StudioRecipeError.invalid("Teste: não foi possível reempacotar o IOSurface real")
    }
    let receipt = StudioCompositionFrameReceipt.read(wrapped)
    try require(!receipt.attachmentPresent && receipt.surfacePresent && receipt.source == "surface"
      && receipt.revision == revision, "wrapper sem CVattachment conserva somente o recibo do IOSurface real")
    let actual = try pixels(CIImage(cvPixelBuffer: wrapped, options: [.colorSpace: StudioEffectRenderer.outputColorSpace]), prepared)
    try require(actual == expectedPixels, "fallback IOSurface identifica os mesmos pixels do AVPlayer")
  }
  @MainActor static func frameCadenceChecks() async throws {
    let engine = StudioRecipeEngine()
    for fps in [Int32(24), Int32(30), Int32(60)] {
      var value = recipe(), assets = value["assets"] as! [[String: Any]]
      // The fixtures contain genuine 24fps and 30fps sources. A 60fps
      // composition exercises output cadence while retaining the 30fps source.
      assets[0]["uri"] = URL(fileURLWithPath: CommandLine.arguments[fps == 24 ? 4 : 1]).absoluteString
      value["assets"] = assets
      var prepared = try await engine.prepare(recipeJSON: json(value))
      let cadence = CMTime(value: 1, timescale: fps)
      prepared.videoComposition?.frameDuration = cadence
      let item = prepared.playerItem(), output = StudioCompositionFrameOutput(item: item)
      let player = AVPlayer(playerItem: item)
      player.isMuted = true
      defer { player.pause(); player.replaceCurrentItem(with: nil) }
      try require(item.videoComposition?.frameDuration == cadence, "fixture usa composição real\(fps)fps")
      try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: 0,
        visualRevision: prepared.visualRevision, frameOutput: output, isCurrent: { player.currentItem === item })
      guard let revision = prepared.visualRevision, let first = output.frame(at: 0, revision: revision) else {
        throw StudioRecipeError.invalid("Teste: primeiro quadro\(fps)fps não confirmou recibo em zero")
      }
      let initialPixels = try pixels(CIImage(cvPixelBuffer: first, options: [.colorSpace: StudioEffectRenderer.outputColorSpace]), prepared)
      let sample = (750 * 1920 + 900) * 4
      try require(initialPixels[sample] > 100 && initialPixels[sample] > initialPixels[sample + 2] + 40,
        "prime\(fps)fps confirma vídeo tratado, sem quadro preto em zero")
      try surfaceFrameReceiptCheck(first, revision: revision, prepared: prepared, expectedPixels: initialPixels)
      let nativeTime = player.currentTime()
      try require(nativeTime.seconds == 0 && player.rate == 0, "prime\(fps)fps mantém cursor zero e pausa")
      var previousPixels = initialPixels
      for hidden in [true, false] {
        var updatedJSON = value, clips = value["clips"] as! [[String: Any]]
        clips[2]["opacity"] = hidden ? 0 : 0.5; updatedJSON["clips"] = clips
        guard let updated = try engine.updateVisuals(prepared, recipeJSON: json(updatedJSON)),
              let nextRevision = updated.visualRevision else {
          throw StudioRecipeError.invalid("Teste: troca visual\(fps)fps saiu do fast path")
        }
        try require(nextRevision != prepared.visualRevision
          && updated.composition === prepared.composition && updated.videoComposition !== prepared.videoComposition,
          "mostrar/ocultar no mesmo PTS cria revisão visual nova e conserva composição")
        updated.videoComposition?.frameDuration = cadence
        output.prepareForChange(at: 0); item.videoComposition = updated.videoComposition
        try await StudioCompositionInitialFrame.prime(player: player, item: item, seconds: 0,
          visualRevision: nextRevision, frameOutput: output, isCurrent: { player.currentItem === item })
        guard let actual = output.frame(at: 0, revision: nextRevision) else {
          throw StudioRecipeError.invalid("Teste: troca visual\(fps)fps não confirmou pixels novos em zero")
        }
        try require(StudioCompositionFrameReceipt.read(actual).revision == nextRevision,
          "mostrar/ocultar confirma recibo da revisão nova")
        let data = try pixels(CIImage(cvPixelBuffer: actual, options: [.colorSpace: StudioEffectRenderer.outputColorSpace]), updated)
        var changedPixels = 0, outsideDifference = 0
        for pixel in 0..<(1920 * 1080) {
          let x = pixel % 1920, y = pixel / 1920, offset = pixel * 4
          var difference = 0
          for channel in 0..<4 { difference = max(difference, abs(Int(data[offset + channel]) - Int(previousPixels[offset + channel]))) }
          if x >= 133 && x <= 520 && y >= 63 && y <= 282 { if difference > 3 { changedPixels += 1 } }
          else { outsideDifference = max(outsideDifference, difference) }
        }
        try require(changedPixels > 100 && outsideDifference <= 3,
          "troca\(fps)fps altera ROI da imagem e mantém exterior: \(changedPixels)/\(outsideDifference)")
        if !hidden {
          var restoredDifference = 0
          for index in data.indices { restoredDifference = max(restoredDifference, abs(Int(data[index]) - Int(initialPixels[index]))) }
          try require(restoredDifference <= 3, "A→B→A\(fps)fps restaura pixels sob uma revisão nova")
        }
        try require(player.currentItem === item && player.currentTime() == nativeTime && player.rate == 0,
          "troca\(fps)fps mantém item, PTS zero e pausa")
        previousPixels = data; prepared = updated
      }
      // Use a new item so the non-aligned cadence probe does not depend on a
      // previously acquired zero-time output sample.
      let seekItem = prepared.playerItem(), seekOutput = StudioCompositionFrameOutput(item: seekItem)
      player.replaceCurrentItem(with: seekItem)
      let seconds = fps == 24 ? 0.04 : fps == 30 ? 0.03 : 0.015
      try await StudioCompositionInitialFrame.prime(player: player, item: seekItem, seconds: seconds,
        visualRevision: prepared.visualRevision, frameOutput: seekOutput, isCurrent: { player.currentItem === seekItem })
      try require(seekOutput.frame(at: seconds, revision: prepared.visualRevision!) != nil,
        "receipt\(fps)fps aceita quadro precedente em seek não alinhado\(seconds)")
      try require(abs(player.currentTime().seconds - seconds) < 1 / 120_000 && player.rate == 0,
        "seek\(fps)fps conserva cursor arbitrário e pausa")
      print("Receipt\(fps)fps: frame0 real, wrapper IOSurface sem CVattachment, A→B→A no mesmo PTS e seek\(seconds) confirmados.")
    }
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
  @MainActor static func itemObserverChecks() async throws {
    func wait(_ message: String, _ condition: @MainActor () -> Bool) async throws {
      let deadline = Date().addingTimeInterval(8)
      while !condition() {
        try require(Date() < deadline, message)
        try await Task.sleep(nanoseconds: 10_000_000)
      }
    }
    func seek(_ player: AVPlayer, _ seconds: Double) async throws {
      let finished = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 120_000), toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
      }
      try require(finished, "seek da fixture de observers conclui")
    }
    let engine = StudioRecipeEngine(), originalJSON = recipe()
    var prepared = try await engine.prepare(recipeJSON: json(originalJSON))
    let player = AVPlayer(), item = prepared.playerItem(), observers = StudioCompositionItemObservers()
    player.isMuted = true
    defer { observers.invalidate(); player.pause(); player.replaceCurrentItem(with: nil) }
    var ready = 0, failures = 0, ends = 0, replayPending = false
    observers.observe(item: item, player: player, onStatus: { observed in
      if observed.status == .readyToPlay { ready += 1 }
      if observed.status == .failed { failures += 1; player.pause() }
    }, onEnd: { _ in
      if StudioCompositionItemObservers.isAtEnd(seconds: player.currentTime().seconds,
        duration: prepared.recipe.durationSeconds, replayPending: replayPending) {
        ends += 1; player.pause()
      }
    })
    player.replaceCurrentItem(with: item)
    try await wait("KVO ready real chega ao item observado") { ready > 0 }
    for (stage, expectedEnds) in [("mute", 1), ("hide", 2), ("resize", 3)] {
      var value = originalJSON, clips = value["clips"] as! [[String: Any]]
      if stage == "mute" { clips[0]["gain"] = 0 }
      if stage == "hide" { clips[2]["opacity"] = 0 }
      if stage == "resize" { clips[0]["rect"] = ["x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8] }
      value["clips"] = clips
      guard let updated = try engine.updateVisuals(prepared, recipeJSON: json(value)) else {
        throw StudioRecipeError.invalid("Teste: \(stage) abandonou fast path")
      }
      item.videoComposition = updated.videoComposition; item.audioMix = updated.audioMix; prepared = updated
      try require(player.currentItem === item, "\(stage) reutiliza item/registro dos observers")
      try await seek(player, 0.8)
      player.play()
      try await wait("EOF real após \(stage) continua aceito pelo registro original") { ends == expectedEnds }
    }
    // The notification was already enqueued, but a replay intent wins before
    // delivery. A stale EOF at the new non-EOF position must also be ignored.
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: item)
    replayPending = true
    try await Task.sleep(nanoseconds: 20_000_000)
    try require(ends == 3, "EOF enfileirado não cancela replay pendente")
    try await seek(player, 0.2); replayPending = false
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: item)
    try await Task.sleep(nanoseconds: 20_000_000)
    try require(ends == 3, "EOF antigo após replay não pausa posição fora do fim")

    var priorStatuses = 0, priorEnds = 0, reboundStatuses = 0, reboundEnds = 0
    observers.observe(item: item, player: player, onStatus: { _ in priorStatuses += 1 }, onEnd: { _ in priorEnds += 1 })
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: item)
    observers.observe(item: item, player: player, onStatus: { _ in reboundStatuses += 1 }, onEnd: { _ in reboundEnds += 1 })
    try await wait("rebind do mesmo item recebe seu status próprio") { reboundStatuses > 0 }
    try require(priorStatuses == 0 && priorEnds == 0 && reboundEnds == 0,
      "lease do registro invalida callbacks antigos mesmo quando a identidade do item não mudou")
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: item)
    try await wait("rebind continua aceitando eventos novos") { reboundEnds == 1 }

    // A genuine load failure exercises the same observer implementation. This
    // does not claim that macOS reproduced a decode failure after a ready item.
    let missing = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent()
      .appendingPathComponent("missing-\(UUID().uuidString).mp4")
    let failedItem = AVPlayerItem(url: missing)
    observers.observe(item: failedItem, player: player, onStatus: { observed in
      if observed.status == .failed { failures += 1 }
    }, onEnd: { _ in })
    player.replaceCurrentItem(with: failedItem)
    try await wait("falha real de leitura chega pelo KVO atual") { failures > 0 }
    try require(failedItem.status == .failed && failedItem.error != nil, "fixture tem erro real do AVPlayerItem")

    let replacement = prepared.playerItem()
    var oldStatuses = 0, oldEnds = 0, newReady = 0, newEnds = 0
    observers.observe(item: failedItem, player: player, onStatus: { _ in oldStatuses += 1 }, onEnd: { _ in oldEnds += 1 })
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: failedItem)
    // Invalidate callbacks before allowing the queued main-actor tasks to run.
    observers.observe(item: replacement, player: player, onStatus: { value in
      if value.status == .readyToPlay { newReady += 1 }
    }, onEnd: { _ in newEnds += 1 })
    player.replaceCurrentItem(with: replacement)
    try await wait("novo item recebe seu KVO próprio") { newReady > 0 }
    try require(oldStatuses == 0 && oldEnds == 0, "KVO/EOF enfileirados do item substituído não chegam")
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: failedItem)
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: replacement)
    try await wait("novo registro recebe apenas seu EOF") { newEnds == 1 }
    try require(oldEnds == 0, "notificação tardia do item anterior é rejeitada")
    var disposedStatuses = 0, disposedEnds = 0
    observers.observe(item: replacement, player: player, onStatus: { _ in disposedStatuses += 1 }, onEnd: { _ in disposedEnds += 1 })
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: replacement)
    observers.invalidate()
    try await Task.sleep(nanoseconds: 20_000_000)
    try require(disposedStatuses == 0 && disposedEnds == 0, "dispose rejeita KVO/EOF já enfileirados mesmo com item ainda vivo")
    print("Observers reais: EOF no mesmo item após mute/hide/resize; KVO failed de leitura real; replace/dispose/replay rejeitam entregas antigas.")
  }
  @MainActor static func pausePropChecks() async throws {
    func wait(_ message: String, _ condition: @MainActor () -> Bool) async throws {
      let deadline = Date().addingTimeInterval(8)
      while !condition() {
        try require(Date() < deadline, message)
        try await Task.sleep(nanoseconds: 10_000_000)
      }
    }
    let engine = StudioRecipeEngine(), original = recipe()
    let prepared = try await engine.prepare(recipeJSON: json(original))
    var mutedValue = original, clips = mutedValue["clips"] as! [[String: Any]]
    clips[0]["gain"] = 0; mutedValue["clips"] = clips
    guard let muted = try engine.updateVisuals(prepared, recipeJSON: json(mutedValue)) else {
      throw StudioRecipeError.invalid("Teste: mute abandonou fast path antes do EOF")
    }
    let player = AVPlayer(), item = prepared.playerItem(), observers = StudioCompositionItemObservers()
    item.audioMix = muted.audioMix
    player.isMuted = true; player.actionAtItemEnd = .pause
    var gate = StudioCompositionPausePropGate(), paused = true, replayPending = false
    var replayTask: Task<Void, Never>?, replayGeneration = 0
    var commands = 0, replays = 0, completedReplays = 0, ready = 0, ends = 0
    // Exercise the production prop gate with a real AVPlayer/EOF/exact seek.
    // This fixture does not instantiate Expo/UIKit or claim Fabric UI coverage.
    func setPaused(_ value: Bool) {
      commands += 1; replayGeneration += 1
      replayTask?.cancel(); replayTask = nil; replayPending = false
      paused = value
      if value { player.pause(); return }
      guard item.status == .readyToPlay else { return }
      if StudioCompositionItemObservers.isAtEnd(seconds: player.currentTime().seconds,
        duration: muted.recipe.durationSeconds, replayPending: false) {
        replays += 1; replayPending = true
        let generation = replayGeneration
        replayTask = Task { @MainActor in
          let finished = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) {
              continuation.resume(returning: $0)
            }
          }
          guard !Task.isCancelled, !paused, generation == replayGeneration, finished,
            player.currentItem === item else { return }
          completedReplays += 1; replayPending = false; replayTask = nil
          player.play()
        }
      } else { player.play() }
    }
    func setPausedProp(_ value: Bool) {
      guard gate.accept(value) else { return }
      setPaused(value)
    }
    defer { replayTask?.cancel(); observers.invalidate(); player.pause(); player.replaceCurrentItem(with: nil) }
    setPausedProp(true)
    setPausedProp(true)
    try require(commands == 1, "prop inicial true aceita uma vez")
    // A Play received before readiness must remain the intent when KVO fires;
    // no repeated false is necessary to activate the ready player.
    setPausedProp(false)
    try require(!paused && commands == 2, "prop inicial Play define intenção antes do status ready")
    observers.observe(item: item, player: player, onStatus: { observed in
      if observed.status == .readyToPlay {
        ready += 1
        if !paused && !replayPending { player.play() }
      }
    }, onEnd: { _ in
      if StudioCompositionItemObservers.isAtEnd(seconds: player.currentTime().seconds,
        duration: muted.recipe.durationSeconds, replayPending: replayPending) {
        ends += 1; setPaused(true)
      }
    })
    player.replaceCurrentItem(with: item)
    try await wait("KVO ready inicia a intenção Play inicial") { ready > 0 && player.rate > 0 }
    try await wait("EOF real após mute pausa nativamente") { ends == 1 && paused }
    let eof = player.currentTime(), commandsAtEnd = commands
    for _ in 0..<30 { setPausedProp(false) }
    try await Task.sleep(nanoseconds: 40_000_000)
    try require(commands == commandsAtEnd && replays == 0 && player.rate == 0 && player.currentTime() == eof,
      "false reaplicado após EOF não reinicia nem desloca o mesmo item")
    setPausedProp(true) // JS acknowledges the already stopped EOF.
    setPausedProp(false) // An explicit new Play owns one replay.
    try require(replays == 1 && replayPending, "transição true→false inicia um replay explícito")
    let replayCommands = commands, replayEpoch = replayGeneration
    for _ in 0..<30 { setPausedProp(false) }
    try require(commands == replayCommands && replayGeneration == replayEpoch && replayPending,
      "false repetido durante replay não cancela o exact seek pendente")
    try await wait("replay explícito conclui uma vez e volta a reproduzir") {
      completedReplays == 1 && player.rate > 0 && player.currentTime().seconds < 0.5
    }
    try require(player.currentItem === item && replays == 1, "replay conserva item e não duplica a operação")
    setPaused(true) // Imperative/background pause does not rewrite prop history.
    let stopped = player.currentTime(), afterCommand = commands
    setPausedProp(false)
    try require(commands == afterCommand && paused && player.rate == 0,
      "false antigo não desfaz comando de pausa")
    setPausedProp(true) // Normal JS state catches up to the imperative pause.
    setPausedProp(true)
    try require(commands == afterCommand + 1 && player.currentTime() == stopped,
      "ACK JS normal de pausa não busca nem cria replay")
    setPausedProp(false)
    try await wait("novo Play após ACK de pausa retoma normalmente") { player.rate > 0 }
    try require(replays == 1 && player.currentItem === item, "retomar fora do EOF não reinicia a montagem")
    setPaused(true)
    print("Props/EOF reais: mute no mesmo item; false reaplicado não reinicia o fim nem cancela replay; true→false confirma um replay; ready e pausa imperativa preservados.")
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
    try await fastControlChecks()
    try await frameCadenceChecks()
    try await delayedHoldChecks()
    try await replacementChecks()
    try await itemObserverChecks()
    try await pausePropChecks()
    print("Edição interativa aprovada sem UI, seek por movimento ou troca de receita por frame.")
  }
}
