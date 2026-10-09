import AVFoundation
import CoreImage
import CoreVideo
import Foundation

private final class StudioObservedRates {
  private let lock = NSLock()
  private var values: [Float] = []
  func append(_ value: Float) { lock.lock(); values.append(value); lock.unlock() }
  func snapshot() -> [Float] { lock.lock(); defer { lock.unlock() }; return values }
}

@main @MainActor
struct StudioVisualUpdateTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioRecipeError.invalid("Teste de gesto: \(message)") }
  }
  static func json(_ value: [String: Any]) throws -> String {
    String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
  }
  static func recipe(captions: Int = 0) -> [String: Any] {
    func asset(_ id: String, _ kind: String, _ index: Int) -> [String: Any] {
      ["id": id, "kind": kind, "uri": URL(fileURLWithPath: CommandLine.arguments[index]).absoluteString,
       "durationTicks": 240_000, "sourceStage": "standard"]
    }
    func clip(_ id: String, _ kind: String, _ asset: String?, _ z: Int, _ r: [Double]) -> [String: Any] {
      var result: [String: Any] = ["id": id, "kind": kind, "startTicks": 0, "durationTicks": 240_000,
        "sourceStartTicks": 0, "sourceEndTicks": kind == "video" ? 240_000 : 0,
        "zIndex": z, "rect": ["x": r[0], "y": r[1], "width": r[2], "height": r[3]],
        "rotationDegrees": 0, "fit": "contain", "opacity": 1, "gain": 0,
        "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]
      if let asset { result["assetId"] = asset }
      if kind == "text" || kind == "caption" {
        result["text"] = ["content": "AULA CLASSFY", "fontFamily": "System", "fontSize": 0.045,
          "color": "#FFFFFF", "backgroundColor": "#00000000", "alignment": "center"]
      }
      return result
    }
    var clips = [clip("main", "video", "red", 0, [0, 0, 1, 1]),
      clip("pip", "video", "blue", 1, [0.65, 0.08, 0.28, 0.72]),
      clip("image", "image", "green", 2, [0.05, 0.1, 0.15, 0.2]),
      clip("title", "text", nil, 3, [0.15, 0.82, 0.7, 0.15])]
    for index in 0..<captions {
      var caption = clip("caption:\(index)", "caption", nil, 4, [0.08, 0.78, 0.84, 0.12])
      caption["startTicks"] = index * 240_000 / captions
      caption["durationTicks"] = 240_000 / captions
      clips.append(caption)
    }
    return ["version": 2, "timebase": 120_000, "durationTicks": 240_000, "mediaType": "video",
      "canvas": ["aspectRatio": "landscape", "backgroundColor": "#000000"],
      "output": ["profile": "standard", "width": 1920, "height": 1080,
        "frameRateNumerator": 30, "frameRateDenominator": 1, "colorSpace": "rec709"],
      "assets": [asset("red", "video", 1), asset("blue", "video", 2), asset("green", "image", 3)], "clips": clips]
  }
  static func change(_ recipe: [String: Any], id: String, _ patch: ([String: Any]) -> [String: Any]) -> [String: Any] {
    var result = recipe
    result["clips"] = (result["clips"] as! [[String: Any]]).map { $0["id"] as? String == id ? patch($0) : $0 }
    return result
  }
  static func moved(_ recipe: [String: Any], x: Double) -> [String: Any] {
    change(recipe, id: "pip") { clip in
      var copy = clip; var rect = copy["rect"] as! [String: Any]; rect["x"] = x; copy["rect"] = rect; return copy
    }
  }
  static func raster(_ prepared: StudioPreparedRecipe, id: String) -> CIImage? {
    prepared.layers.first { $0.clip.id == id }?.raster
  }
  static func mixedRMS(_ item: AVPlayerItem) throws -> Double {
    let tracks = item.asset.tracks(withMediaType: .audio)
    try require(!tracks.isEmpty, "fixture de volume contém pista de áudio real")
    let reader = try AVAssetReader(asset: item.asset)
    let output = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMIsFloatKey: true,
      AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false
    ])
    output.audioMix = item.audioMix
    reader.add(output)
    try require(reader.startReading(), "mix do próprio item inicia decodificação PCM")
    var square = 0.0, count = 0
    while let sample = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
      let byteCount = CMBlockBufferGetDataLength(block)
      var bytes = Data(count: byteCount)
      let status = bytes.withUnsafeMutableBytes {
        CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: byteCount, destination: $0.baseAddress!)
      }
      try require(status == noErr, "amostras do mix podem ser lidas")
      bytes.withUnsafeBytes {
        for value in $0.bindMemory(to: Float.self) {
          square += Double(value) * Double(value); count += 1
        }
      }
    }
    try require(count > 0 && reader.status == .completed, "mix contém PCM completo, inclusive em silêncio")
    return sqrt(square / Double(count))
  }
  static func audioFastPath(engine: StudioRecipeEngine) async throws {
    let source = URL(fileURLWithPath: CommandLine.arguments[6])
    let originalBytes = try Data(contentsOf: source)
    var value = recipe()
    var assets = value["assets"] as! [[String: Any]]
    assets[0]["uri"] = source.absoluteString; value["assets"] = assets
    value = change(value, id: "main") { clip in var next = clip; next["gain"] = 1; return next }
    let original = try await engine.prepare(recipeJSON: json(value))
    try require(original.audioTrackIDs["main"] != nil, "gain usa pista real do vídeo principal")
    var prepared = original
    let item = original.playerItem(), player = AVPlayer()
    player.isMuted = true; player.replaceCurrentItem(with: item)
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    for _ in 0..<100 {
      if item.status != .unknown { break }
      try await Task.sleep(nanoseconds: 50_000_000)
    }
    try require(item.status == .readyToPlay, "item com áudio está pronto")
    let anchor = CMTime(seconds: 0.5, preferredTimescale: 120_000)
    let sought = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
      player.seek(to: anchor, toleranceBefore: .zero, toleranceAfter: .zero) {
        continuation.resume(returning: $0)
      }
    }
    try require(sought, "cursor inicial do item com áudio confirmado")
    let picture = item.videoComposition, cursor = player.currentTime(), audible = try mixedRMS(item)
    try require(audible > 0.03, "origem tem áudio audível mensurável \(audible)")
    var levels: [Double] = []
    for gain in [0.5, 0.0, 1.0] {
      let changed = change(value, id: "main") { clip in var next = clip; next["gain"] = gain; return next }
      guard let updated = try engine.updateVisuals(prepared, recipeJSON: json(changed)) else {
        throw StudioRecipeError.invalid("Teste de gesto: gain \(gain) deixou o fast path")
      }
      try require(updated.composition === original.composition && updated.videoComposition === original.videoComposition
        && updated.audioTrackIDs == original.audioTrackIDs, "gain mantém decoder, composição visual e pistas")
      try require(updated.audioMix !== prepared.audioMix, "gain altera somente o mix das pistas existentes")
      item.audioMix = updated.audioMix
      let measured = try mixedRMS(item)
      try require(abs(measured - audible * gain) < 0.00001,
        "PCM do item respeita gain \(gain): \(measured), origem \(audible)")
      try require(player.currentItem === item && item.videoComposition === picture
        && player.currentTime() == cursor && player.rate == 0,
        "volume/mute/unmute preservam item, quadro, cursor e pausa")
      levels.append(measured); prepared = updated
    }
    try require(original.recipe.clips.first { $0.id == "main" }?.gain == 1,
      "snapshot anterior de áudio permanece intacto")
    try require(try Data(contentsOf: source) == originalBytes, "original com áudio permanece intacto")
    print("Áudio fast path real: PCM origem \(audible), gain0.5/mute/unmute \(levels); mesmo AVPlayerItem, pistas, quadro e cursor.")
  }
  static func blueBounds(_ buffer: CVPixelBuffer) throws -> (Double, Double) {
    try require(CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA, "frame BGRA")
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
    guard let address = CVPixelBufferGetBaseAddress(buffer) else { throw StudioRecipeError.invalid("Frame sem pixels") }
    let bytes = address.assumingMemoryBound(to: UInt8.self), stride = CVPixelBufferGetBytesPerRow(buffer)
    let row = Int(Double(height) * 0.5)
    let blue = (0..<width).filter { x in let i = row * stride + x * 4; return bytes[i] > 180 && bytes[i + 2] < 40 }
    guard let left = blue.first, let right = blue.last else { throw StudioRecipeError.invalid("PIP invisível") }
    return (Double(left) / Double(width), Double(right) / Double(width))
  }
  static func waitFrame(_ output: AVPlayerItemVideoOutput, time: CMTime, expectedX: Double) async throws -> CVPixelBuffer {
    for _ in 0..<200 {
      if let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) {
        let bounds = try blueBounds(buffer)
        if abs(bounds.0 - (expectedX + 0.02609375)) < 0.003
          && abs(bounds.1 - (expectedX + 0.25390625)) < 0.003 { return buffer }
      }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    throw StudioRecipeError.invalid("O AVPlayer pausado não apresentou o último transform x=\(expectedX).")
  }
  static func firstPausedFrame(engine: StudioRecipeEngine) async throws {
    for scale: Float in [1, 0.8, 0.5] {
      let prepared = try await engine.prepare(recipeJSON: json(recipe()))
      prepared.videoComposition!.renderScale = scale
      let item = prepared.playerItem()
      let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
      output.suppressesPlayerRendering = true; item.add(output)
      let player = AVPlayer(playerItem: item); player.isMuted = true
      defer { player.pause(); player.replaceCurrentItem(with: nil) }
      for _ in 0..<100 {
        if item.status != .unknown { break }
        try await Task.sleep(nanoseconds: 50_000_000)
      }
      try require(item.status == .readyToPlay, "item inicial pronto sem reproduzir")
      // Readiness alone is not evidence that the first composed frame exists.
      // Record this cold observation; the initialization below explicitly seeks
      // zero, and no play or positive-time seek occurs anywhere in this test.
      let cold = output.copyPixelBuffer(forItemTime: .zero, itemTimeForDisplay: nil)
      let hadColdFrame = cold.flatMap { try? blueBounds($0) } != nil
      let completed = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
      }
      try require(completed, "pedido do primeiro quadro em zero concluiu")
      let buffer = try await waitFrame(output, time: .zero, expectedX: 0.65)
      try require(CVPixelBufferGetWidth(buffer) == Int((1920 * scale).rounded()), "primeiro quadro mantém escala")
      try require(player.currentItem === item && player.rate == 0 && abs(player.currentTime().seconds) < 0.00001,
        "primeiro quadro aparece sem play e sem deslocar cursor zero")
      print("Primeiro quadro pausado scale=\(scale): pixels em 0:00 antes de qualquer play; readiness sozinha tinha frame=\(hadColdFrame).")
    }
  }
  static func pausedPlayer(engine: StudioRecipeEngine) async throws {
    let original = recipe()
    for scale: Float in [1, 0.8, 0.5] {
      var prepared = try await engine.prepare(recipeJSON: json(original))
      prepared.videoComposition!.renderScale = scale
      let item = prepared.playerItem()
      let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
      output.suppressesPlayerRendering = true; item.add(output)
      let player = AVPlayer(playerItem: item); player.isMuted = true
      defer { player.pause(); player.replaceCurrentItem(with: nil) }
      for _ in 0..<100 {
        if item.status != .unknown { break }
        try await Task.sleep(nanoseconds: 50_000_000)
      }
      try require(item.status == .readyToPlay, "AVPlayer preparou item")
      let time = CMTime(seconds: 0.5, preferredTimescale: 120_000)
      let completed = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
      }
      try require(completed, "seek inicial concluiu")
      _ = try await waitFrame(output, time: time, expectedX: 0.65)
      var latencies: [Double] = []
      for x in [0.1, 0.3, 0.5, 0.65] {
        let start = Date()
        let snapshot = prepared, value = try json(moved(original, x: x))
        let worker = Task.detached(priority: .userInitiated) { try engine.updateVisuals(snapshot, recipeJSON: value) }
        guard let updated = try await worker.value else { throw StudioRecipeError.invalid("Transform deixou fastpath") }
        try require(updated.composition === prepared.composition && updated.audioMix === prepared.audioMix,
          "transform reutiliza decoder/mix")
        try require(updated.videoComposition?.renderScale == scale, "transform conserva escala de prévia")
        item.videoComposition = updated.videoComposition; prepared = updated
        let buffer = try await waitFrame(output, time: time, expectedX: x)
        try require(CVPixelBufferGetWidth(buffer) == Int((1920 * scale).rounded()), "frame não muda resolução durante gesto")
        try require(player.currentItem === item && player.rate == 0
          && abs(player.currentTime().seconds - 0.5) < 0.00001, "pixels atualizados sem seek, play ou salto de cursor")
        latencies.append(Date().timeIntervalSince(start) * 1000)
      }
      // Rapid intermediate drafts must finish at the final requested transform.
      for x in [0.2, 0.4, 0.6] {
        prepared = try engine.updateVisuals(prepared, recipeJSON: json(moved(original, x: x)))!
        item.videoComposition = prepared.videoComposition
      }
      _ = try await waitFrame(output, time: time, expectedX: 0.6)
      try require(abs(player.currentTime().seconds - 0.5) < 0.00001 && player.rate == 0, "último draft conserva cursor pausado")
      print("Gesto AVPlayer pausado scale=\(scale): 4 posições + 3 drafts rápidos, último x=.6 e cursor=.5; latências locais ms=\(latencies)")
    }
  }
  static func playingPlayer(engine: StudioRecipeEngine) async throws {
    let original = recipe(captions: 100)
    var prepared = try await engine.prepare(recipeJSON: json(original))
    prepared.videoComposition!.renderScale = 0.5
    let item = prepared.playerItem()
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.suppressesPlayerRendering = true; item.add(output)
    let player = AVPlayer(playerItem: item); player.isMuted = true
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    for _ in 0..<100 {
      if item.status != .unknown { break }
      try await Task.sleep(nanoseconds: 50_000_000)
    }
    try require(item.status == .readyToPlay, "AVPlayer de reprodução pronto")
    let completed = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
      player.seek(to: CMTime(seconds: 0.2, preferredTimescale: 120_000),
        toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
    }
    try require(completed, "seek inicial de reprodução concluiu")
    player.play()
    for _ in 0..<100 {
      if player.currentTime().seconds > 0.23 { break }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    try require(player.rate > 0 && player.currentTime().seconds > 0.23, "relógio realmente avança")
    let rates = StudioObservedRates()
    let observation = player.observe(\.rate, options: [.new]) { _, change in
      if let rate = change.newValue { rates.append(rate) }
    }
    let started = player.currentTime().seconds
    for x in [0.1, 0.3, 0.5, 0.65] {
      let snapshot = prepared, value = try json(moved(original, x: x))
      let worker = Task.detached(priority: .userInitiated) { try engine.updateVisuals(snapshot, recipeJSON: value) }
      guard let updated = try await worker.value else { throw StudioRecipeError.invalid("Reprodução deixou fastpath") }
      // A ready visual update changes only this property. In particular it
      // never calls pause/play, replaces the item or seeks the old anchor.
      item.videoComposition = updated.videoComposition; prepared = updated
      var delivered = false
      for _ in 0..<100 {
        if let buffer = output.copyPixelBuffer(forItemTime: player.currentTime(), itemTimeForDisplay: nil) {
          let bounds = try blueBounds(buffer)
          if abs(bounds.0 - (x + 0.02609375)) < 0.003
            && abs(bounds.1 - (x + 0.25390625)) < 0.003 { delivered = true; break }
        }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try require(delivered && player.rate > 0 && player.currentItem === item,
        "pixels do draft chegam sem interromper reprodução")
    }
    try require(player.currentTime().seconds > started && rates.snapshot().allSatisfy { $0 > 0 },
      "nenhuma taxa zero temporária enquanto a intenção é reproduzir")
    observation.invalidate()

    // A pending worker cannot undo a later user pause. The semaphore makes the
    // order deterministic without slowing normal transforms or changing media.
    let gate = DispatchSemaphore(value: 0), snapshot = prepared
    let pausedValue = try json(moved(original, x: 0.3))
    let pending = Task.detached(priority: .userInitiated) {
      gate.wait(); return try engine.updateVisuals(snapshot, recipeJSON: pausedValue)
    }
    player.pause()
    let pausedAt = player.currentTime().seconds
    gate.signal()
    guard let updated = try await pending.value else { throw StudioRecipeError.invalid("Draft pausado deixou fastpath") }
    item.videoComposition = updated.videoComposition; prepared = updated
    _ = try await waitFrame(output, time: player.currentTime(), expectedX: 0.3)
    print("Pausa durante worker: taxa=\(player.rate), cursor=\(pausedAt) → \(player.currentTime().seconds), delta=\(player.currentTime().seconds - pausedAt).")
    // Stopping a running media clock settles by tens of microseconds; this is
    // still sub-millisecond, far below one video frame. Already-paused gesture
    // tests above retain their stricter exact-seek anchor tolerance.
    try require(player.rate == 0 && abs(player.currentTime().seconds - pausedAt) < 0.001,
      "pausa explícita durante worker permanece aplicada, taxa=\(player.rate), delta cursor=\(player.currentTime().seconds - pausedAt)")

    let cancelGate = DispatchSemaphore(value: 0), cancelledSnapshot = prepared
    let cancelledValue = try json(moved(original, x: 0.1))
    let cancelled = Task.detached(priority: .userInitiated) {
      cancelGate.wait(); return try engine.updateVisuals(cancelledSnapshot, recipeJSON: cancelledValue)
    }
    cancelled.cancel(); cancelGate.signal()
    do { _ = try await cancelled.value; throw StudioRecipeError.invalid("Worker visual cancelado devolveu resultado") }
    catch is CancellationError {}
    let finalValue = try json(moved(original, x: 0.6))
    let final = Task.detached { try engine.updateVisuals(cancelledSnapshot, recipeJSON: finalValue) }
    let finalPrepared = try await final.value!
    item.videoComposition = finalPrepared.videoComposition
    _ = try await waitFrame(output, time: player.currentTime(), expectedX: 0.6)
    try require(player.rate == 0 && abs(player.currentTime().seconds - pausedAt) < 0.001,
      "worker cancelado não substitui pixels do último draft nem altera pausa/cursor")
    print("Reprodução real: 4 drafts mantêm item/taxa positiva/relógio; pausa durante worker e cancelamento preservam intenção, cursor e pixels finais.")
  }
  static func mainRecipe() -> [String: Any] {
    var value = recipe()
    var asset = (value["assets"] as! [[String: Any]])[0]
    asset["uri"] = URL(fileURLWithPath: CommandLine.arguments[4]).absoluteString
    value["assets"] = [asset]
    value["clips"] = (value["clips"] as! [[String: Any]]).filter { $0["id"] as? String == "main" }
    return value
  }
  static func mainRect(_ value: [String: Any], origin: Double, size: Double) -> [String: Any] {
    change(value, id: "main") { clip in
      var copy = clip
      copy["rect"] = ["x": origin, "y": origin, "width": size, "height": size]
      return copy
    }
  }
  // CVPixelBuffer rows use top-left coordinates, like the normalized recipe.
  static func markerPixels(_ buffer: CVPixelBuffer, origin: Double, size: Double) throws -> Bool {
    try require(CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA, "marker BGRA")
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let address = CVPixelBufferGetBaseAddress(buffer) else { return false }
    let bytes = address.assumingMemoryBound(to: UInt8.self)
    let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    func pixel(_ x: Double, _ y: Double) -> (UInt8, UInt8, UInt8) {
      let i = min(height - 1, max(0, Int(y * Double(height)))) * stride
        + min(width - 1, max(0, Int(x * Double(width)))) * 4
      return (bytes[i + 2], bytes[i + 1], bytes[i])
    }
    let cyan = pixel(origin + 0.45 * size, origin + 0.4 * size)
    let red = pixel(origin + 0.6 * size, origin + 0.4 * size)
    guard cyan.0 < 40 && cyan.1 > 180 && cyan.2 > 180,
          red.0 > 180 && red.1 < 40 && red.2 < 40 else { return false }
    if size < 1 {
      let margin = pixel(0.12, 0.6)
      guard margin.0 < 20 && margin.1 < 20 && margin.2 < 20 else { return false }
    } else {
      let corner = pixel(0.02, 0.02)
      guard corner.0 > 180 && corner.1 < 40 && corner.2 < 40 else { return false }
    }
    let row = min(height - 1, max(0, Int((origin + 0.4 * size) * Double(height))))
    let xs = (0..<width).filter { x in
      let i = row * stride + x * 4
      return bytes[i] > 180 && bytes[i + 1] > 180 && bytes[i + 2] < 40
    }
    guard let left = xs.first, let right = xs.last else { return false }
    return abs(Double(left) / Double(width) - (origin + 0.4 * size)) < 0.008
      && abs(Double(right) / Double(width) - (origin + 0.5 * size)) < 0.008
  }
  static func waitMarker(_ output: AVPlayerItemVideoOutput, time: CMTime,
                         origin: Double, size: Double) async throws {
    for _ in 0..<200 {
      if let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil),
         try markerPixels(buffer, origin: origin, size: size) { return }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    throw StudioRecipeError.invalid("O AVPlayer não apresentou main.rect origin=\(origin), size=\(size).")
  }
  static func exportBuffer(_ url: URL) async throws -> CVPixelBuffer {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw StudioRecipeError.invalid("Export sem vídeo")
    }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: 0.5, preferredTimescale: 120_000),
      duration: CMTime(seconds: 0.1, preferredTimescale: 120_000))
    let output = AVAssetReaderTrackOutput(track: track,
      outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(output)
    try require(reader.startReading(), "export pode ser lido")
    defer { reader.cancelReading() }
    guard let sample = output.copyNextSampleBuffer(), let buffer = CMSampleBufferGetImageBuffer(sample) else {
      throw StudioRecipeError.invalid("Export sem frame no cursor")
    }
    return buffer
  }
  static func mainTransform(engine: StudioRecipeEngine) async throws {
    let original = mainRecipe(), time = CMTime(seconds: 0.5, preferredTimescale: 120_000)
    let source = URL(fileURLWithPath: CommandLine.arguments[4]), originalBytes = try Data(contentsOf: source)
    let variants: [(String, Double, Double)] = [("expanded", -0.25, 1.5), ("reduced", 0.25, 0.5)]
    for scale: Float in [1, 0.8, 0.5] {
      var prepared = try await engine.prepare(recipeJSON: json(original))
      prepared.videoComposition!.renderScale = scale
      let item = prepared.playerItem()
      let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
      output.suppressesPlayerRendering = true; item.add(output)
      let player = AVPlayer(playerItem: item); player.isMuted = true
      defer { player.pause(); player.replaceCurrentItem(with: nil) }
      for _ in 0..<100 {
        if item.status != .unknown { break }
        try await Task.sleep(nanoseconds: 50_000_000)
      }
      try require(item.status == .readyToPlay, "AVPlayer main pronto")
      let completed = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
      }
      try require(completed, "seek inicial main concluiu")
      try await waitMarker(output, time: time, origin: 0, size: 1)
      for (_, origin, size) in variants {
        let snapshot = prepared, value = try json(mainRect(original, origin: origin, size: size))
        let worker = Task.detached { try engine.updateVisuals(snapshot, recipeJSON: value) }
        guard let updated = try await worker.value else { throw StudioRecipeError.invalid("Main transform saiu do fastpath") }
        item.videoComposition = updated.videoComposition; prepared = updated
        try await waitMarker(output, time: time, origin: origin, size: size)
        try require(player.currentItem === item && player.rate == 0
          && abs(player.currentTime().seconds - 0.5) < 0.00001, "main transform não reinicia decoder ou cursor")
      }
      print("Main transform pausado scale=\(scale): rect(-.25,-.25,1.5,1.5) e rect(.25,.25,.5,.5) preservam marcador, fundo e cursor.")
    }
    for (name, origin, size) in variants {
      let destination = URL(fileURLWithPath: CommandLine.arguments[5]).appendingPathComponent("main-\(name).mp4")
      _ = try await engine.export(requestId: "main-\(name)",
        recipeJSON: json(mainRect(original, origin: origin, size: size)),
        outputUri: destination.absoluteString, progress: { _ in })
      let buffer = try await exportBuffer(destination)
      try require(try markerPixels(buffer, origin: origin, size: size), "main \(name) export preserva geometria da prévia")
    }
    try require(try Data(contentsOf: source) == originalBytes, "main original intacto")
    print("Main transform: exportações 1080p30 ampliada/reduzida preservam a mesma posição do marcador e margens da prévia.")
  }
  static func main() async throws {
    try require(CommandLine.arguments.count == 7, "informe red, blue, image, main-marker, saída e vídeo com áudio")
    let engine = StudioRecipeEngine(), value = recipe(captions: 100)
    let original = try await engine.prepare(recipeJSON: json(value))
    original.videoComposition!.renderScale = 0.8
    let movedValue = moved(value, x: 0.3)
    let movedJSON = try json(movedValue)
    let began = Date()
    let worker = Task.detached(priority: .userInitiated) { try engine.updateVisuals(original, recipeJSON: movedJSON) }
    guard let updated = try await worker.value else { throw StudioRecipeError.invalid("Mover vídeo deixou fastpath") }
    let elapsed = Date().timeIntervalSince(began) * 1000
    for id in ["title"] + (0..<100).map({ "caption:\($0)" }) {
      try require(raster(original, id: id) === raster(updated, id: id), "raster intacto reutilizado: \(id)")
    }
    let oldIntervals = original.videoComposition!.instructions as! [StudioRecipeInstruction]
    let newIntervals = updated.videoComposition!.instructions as! [StudioRecipeInstruction]
    try require(oldIntervals.count == newIntervals.count, "intervalos reutilizados")
    for (old, new) in zip(oldIntervals, newIntervals) {
      try require(old.timeRange == new.timeRange && old.layers.map(\.clip.id) == new.layers.map(\.clip.id),
        "intervalo e active IDs mantidos")
      try require(new.recipe.clips.first { $0.id == "pip" }?.rect.x == 0.3, "intervalo recebe transform novo")
    }
    let styledValue = change(movedValue, id: "caption:34") { clip in
      var copy = clip, text = copy["text"] as! [String: Any]; text["content"] = "Outra legenda em português"; copy["text"] = text; return copy
    }
    let styled = try engine.updateVisuals(updated, recipeJSON: json(styledValue))!
    try require(raster(styled, id: "caption:34") !== raster(updated, id: "caption:34"), "conteúdo alterado refaz só seu raster")
    try require(raster(styled, id: "caption:35") === raster(updated, id: "caption:35"), "legenda vizinha continua em cache")
    let resizedValue = change(value, id: "title") { clip in
      var copy = clip, rect = copy["rect"] as! [String: Any]; rect["width"] = 0.5; copy["rect"] = rect; return copy
    }
    let resized = try engine.updateVisuals(original, recipeJSON: json(resizedValue))!
    try require(raster(resized, id: "title") !== raster(original, id: "title"), "largura mudou: relayout CoreText")
    let reorderedValue = change(value, id: "pip") { clip in var copy = clip; copy["zIndex"] = 5; return copy }
    let reordered = try engine.updateVisuals(original, recipeJSON: json(reorderedValue))!
    try require((reordered.videoComposition!.instructions as! [StudioRecipeInstruction]).allSatisfy { $0.layers.last?.clip.id == "pip" }, "ordem visual nova aplicada aos intervalos cacheados")
    let gainValue = change(value, id: "main") { clip in var copy = clip; copy["gain"] = 0.5; return copy }
    guard let gainUpdated = try engine.updateVisuals(original, recipeJSON: json(gainValue)) else {
      throw StudioRecipeError.invalid("Teste de gesto: gain deixou fast path")
    }
    try require(gainUpdated.composition === original.composition && gainUpdated.videoComposition === original.videoComposition
      && gainUpdated.audioMix !== original.audioMix, "gain conserva imagem/decoder e atualiza somente mix")
    let timingValue = change(value, id: "main") { clip in
      var copy = clip; copy["durationTicks"] = 120_000; copy["sourceEndTicks"] = 120_000; return copy
    }
    try require(try engine.updateVisuals(original, recipeJSON: json(timingValue)) == nil,
      "mudança de intervalo continua exigindo reconstrução das pistas")
    // Rendering a previous snapshot concurrently cannot observe the new pose.
    let concurrentJSON = try json(moved(value, x: 0.1))
    let render = Task.detached { try await engine.frame(original, at: 0.5) }
    let concurrent = Task.detached { try engine.updateVisuals(original, recipeJSON: concurrentJSON) }
    _ = try await render.value; _ = try await concurrent.value
    try require(original.recipe.clips.first { $0.id == "pip" }?.rect.x == 0.65
      && raster(original, id: "title") === raster(updated, id: "title"), "snapshot usado por render permanece intacto")
    let cancelled = Task.detached { try await engine.frame(original, at: 0.5) }
    cancelled.cancel()
    do { _ = try await cancelled.value; throw StudioRecipeError.invalid("Cancelamento do frame ignorado") }
    catch is CancellationError {}
    print("Cache: 101 rasters intactos reutilizados; conteúdo/dimensões invalidam só item alterado; \(newIntervals.count) intervalos preservados, ordem/áudio/cancelamento corretos; update local \(elapsed) ms.")
    try await audioFastPath(engine: engine)
    try await firstPausedFrame(engine: engine)
    try await pausedPlayer(engine: engine)
    try await playingPlayer(engine: engine)
    try await mainTransform(engine: engine)
    print("OK: cache e atualização real de pixels no AVPlayer pausado, sem crop/salto de cursor e sem mutar snapshot em render concorrente.")
  }
}
