import AVFoundation
import CoreImage
import CoreVideo
import Foundation
import ImageIO

@main @MainActor
struct StudioEditorToolsTests {
  static let root = URL(fileURLWithPath: CommandLine.arguments[1])
  static let engine = StudioRecipeEngine()
  static var evidence: [[String: Any]] = []
  static func require(_ value: Bool, _ message: String) throws {
    if !value { throw StudioRecipeError.invalid("Editor tools: \(message)") }
  }
  static func json(_ value: [String: Any]) throws -> String {
    String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
  }
  static func base(source: String = "clock.mp4", seconds: Double = 2) -> [String: Any] {
    let ticks = Int64((seconds * 120_000).rounded())
    return ["version": 2, "timebase": 120_000, "durationTicks": ticks, "mediaType": "video",
      "canvas": ["aspectRatio": "landscape", "backgroundColor": "#101010"],
      "output": ["profile": "standard", "width": 640, "height": 360, "frameRateNumerator": 30, "frameRateDenominator": 1, "colorSpace": "rec709"],
      "assets": [["id": "source", "kind": "video", "uri": root.appendingPathComponent(source).absoluteString, "durationTicks": 240_000]],
      "clips": [["id": "main", "kind": "video", "assetId": "source", "startTicks": 0, "durationTicks": ticks,
        "sourceStartTicks": 0, "sourceEndTicks": 240_000, "zIndex": 0, "rect": ["x": 0, "y": 0, "width": 1, "height": 1],
        "rotationDegrees": 0, "fit": "contain", "opacity": 1, "gain": 1, "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]]]
  }
  static func modify(_ recipe: [String: Any], id: String = "main", _ patch: ([String: Any]) -> [String: Any]) -> [String: Any] {
    var value = recipe
    value["clips"] = (value["clips"] as! [[String: Any]]).map { $0["id"] as? String == id ? patch($0) : $0 }
    return value
  }
  static func text(_ id: String, rect: [Double] = [0.05, 0.1, 0.9, 0.7], animation: String = "none") -> [String: Any] {
    ["id": id, "kind": "text", "startTicks": 0, "durationTicks": 240_000, "sourceStartTicks": 0, "sourceEndTicks": 0,
      "zIndex": 1, "rect": ["x": rect[0], "y": rect[1], "width": rect[2], "height": rect[3]], "rotationDegrees": 0, "fit": "contain", "opacity": 1, "gain": 0,
      "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural", "text": ["content": "Aula em ação 👩🏽‍💻", "fontFamily": "Helvetica-Bold", "fontSize": 0.09,
        "color": "#FFFFFF", "backgroundColor": "#00000000", "alignment": "center", "animation": animation, "animationDurationTicks": 96_000]]
  }
  static func textRecipe(animation: String = "none") -> [String: Any] {
    var value = base(source: "background.mp4")
    value["clips"] = (value["clips"] as! [[String: Any]]) + [text("title", animation: animation)]; return value
  }
  static func pixels(_ image: CGImage) throws -> [UInt8] {
    var data = [UInt8](repeating: 0, count: image.width * image.height * 4)
    try data.withUnsafeMutableBytes { bytes in
      guard let context = CGContext(data: bytes.baseAddress, width: image.width, height: image.height,
        bitsPerComponent: 8, bytesPerRow: image.width * 4, space: StudioEffectRenderer.outputColorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw StudioRecipeError.invalid("Pixels") }
      context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    }
    return data
  }
  static func image(_ buffer: CVPixelBuffer, prepared: StudioPreparedRecipe) throws -> CGImage {
    guard let result = prepared.renderer.context.createCGImage(CIImage(cvPixelBuffer: buffer,
      options: [.colorSpace: StudioEffectRenderer.outputColorSpace]), from: CGRect(origin: .zero, size: prepared.recipe.size),
      format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace) else { throw StudioRecipeError.invalid("Buffer") }
    return result
  }
  static func write(_ image: CGImage, name: String) throws {
    let url = root.appendingPathComponent(name)
    guard let writer = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { throw StudioRecipeError.invalid("PNG") }
    CGImageDestinationAddImage(writer, image, nil); try require(CGImageDestinationFinalize(writer), "PNG salvo")
  }
  static func meanDifference(_ a: CGImage, _ b: CGImage) throws -> Double {
    try require(a.width == b.width && a.height == b.height, "dimensões para comparação iguais")
    let left = try pixels(a), right = try pixels(b)
    return zip(left, right).enumerated().reduce(0) { $0 + ($1.offset % 4 == 3 ? 0 : abs(Double($1.element.0) - Double($1.element.1))) }
      / Double(a.width * a.height * 3)
  }
  static func read(_ url: URL, at seconds: Double) throws -> CVPixelBuffer {
    let asset = AVURLAsset(url: url), track = asset.tracks(withMediaType: .video).first!
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: seconds, preferredTimescale: 120_000), duration: CMTime(seconds: 0.08, preferredTimescale: 120_000))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(output); try require(reader.startReading(), "arquivo real decodifica")
    defer { reader.cancelReading() }
    guard let sample = output.copyNextSampleBuffer(), let buffer = CMSampleBufferGetImageBuffer(sample) else { throw StudioRecipeError.invalid("Arquivo sem quadro") }
    return buffer
  }
  static func preview(_ prepared: StudioPreparedRecipe, at seconds: Double) async throws -> CGImage {
    let item = prepared.playerItem(), player = AVPlayer()
    let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.suppressesPlayerRendering = true; item.add(output); player.isMuted = true; player.replaceCurrentItem(with: item)
    defer { player.pause(); player.replaceCurrentItem(with: nil) }
    for _ in 0..<100 { if item.status != .unknown { break }; try await Task.sleep(nanoseconds: 30_000_000) }
    try require(item.status == .readyToPlay, "player real pronto")
    let time = CMTime(seconds: seconds, preferredTimescale: 120_000)
    let done = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
      player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
    }
    try require(done, "seek exato do player")
    for _ in 0..<200 {
      if let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) { return try image(buffer, prepared: prepared) }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    throw StudioRecipeError.invalid("Prévia sem pixels")
  }
  static func export(_ value: [String: Any], name: String) async throws -> URL {
    print("Export case: \(name)")
    let destination = root.appendingPathComponent(name + ".mp4")
    let result = try await engine.export(requestId: name, recipeJSON: json(value), outputUri: destination.absoluteString, progress: { _ in })
    evidence.append(["case": name, "duration": result["duration"] ?? NSNull(), "width": result["width"] ?? NSNull(),
      "height": result["height"] ?? NSNull(), "frameRate": result["frameRate"] ?? NSNull(), "uri": destination.absoluteString])
    return destination
  }
  static func textGrid() async throws {
    var value = textRecipe(), clips: [[String: Any]] = []
    let styles = StudioRecipeVisualEffects.decorations.map { ("decoration", $0) }
      + StudioRecipeVisualEffects.textEffects.filter { $0 != "none" }.map { ("visualEffect", $0) }
      + [("gradient", "two-colors")]
    for (index, style) in styles.enumerated() {
      var clip = text("style:\(index)", rect: [Double(index % 3) / 3 + 0.015, Double(index / 3) / 4 + 0.01, 0.3, 0.23])
      var title = clip["text"] as! [String: Any]
      title["content"] = "Aula\n\(style.1)"; title["fontSize"] = 0.05; title["secondaryColor"] = "#FFDB00"
      if style.0 == "gradient" { title["gradientColors"] = ["#FF3D78", "#44AAFF"] } else { title[style.0] = style.1 }
      clip["text"] = title; clips.append(clip)
    }
    value["clips"] = (value["clips"] as! [[String: Any]]).filter { $0["id"] as? String == "main" } + clips
    let prepared = try await engine.prepare(recipeJSON: json(value))
    let frame = try await engine.frame(prepared, at: 0.5); try write(frame, name: "text-style-grid.png")
    let native = try await preview(prepared, at: 0.5)
    let previewDifference = try meanDifference(frame, native)
    try require(previewDifference < 0.2, "CoreText/CI e AVPlayer têm a mesma grade de texto: \(previewDifference)")
    let output = try await export(value, name: "text-style-grid")
    let exportDifference = try meanDifference(frame, image(read(output, at: 0.5), prepared: prepared))
    try require(exportDifference < 8, "grade de efeitos mantém pixels no arquivo: \(exportDifference)")
    // Text styles are visual-only: same media composition and player identity.
    let updated = modify(value, id: "style:0") { clip in var next = clip; var text = clip["text"] as! [String: Any]; text["decoration"] = "outline"; next["text"] = text; return next }
    let visual = try engine.updateVisuals(prepared, recipeJSON: json(updated))
    try require(visual?.composition === prepared.composition, "decoração não reconstrói pistas")
    print("Texto: 5 decorações, 6 sombras/luz e gradiente real; MAE preview \(previewDifference), export \(exportDifference)/255.")
  }
  static func animations() async throws {
    for kind in StudioRecipeVisualEffects.animations.filter({ $0 != "none" }) {
      let value = textRecipe(animation: kind), prepared = try await engine.prepare(recipeJSON: json(value))
      let first = try await engine.frame(prepared, at: 0), midway = try await engine.frame(prepared, at: 0.2), final = try await engine.frame(prepared, at: 1)
      let staticPrepared = try await engine.prepare(recipeJSON: json(textRecipe()))
      let settled = try await engine.frame(staticPrepared, at: 1)
      try require(try meanDifference(final, settled) < 0.01, "\(kind) termina no raster estático")
      try require(try meanDifference(first, final) > 0.1 && meanDifference(midway, final) > 0.05, "\(kind) anima pixels reais")
      let output = try await export(value, name: "animation-\(kind)")
      let decoded = try image(read(output, at: 0.2), prepared: prepared)
      try require(try meanDifference(midway, decoded) < 8, "\(kind) prévia/export usa relógio local")
      let clip = prepared.recipe.clips.first { $0.id == "title" }!
      if kind == "typewriter" {
        let cache = prepared.layers.first { $0.clip.id == "title" }!.textFrames!
        let a = try cache.image(at: 0.2, timebase: 120_000), b = try cache.image(at: 0.2, timebase: 120_000)
        try require(a === b, "typewriter reutiliza prefixo/style atual")
        var shifted = clip; shifted.animationOffsetTicks = 24_000
        let shiftedImage = try cache.image(at: 0, timebase: 120_000, clip: shifted)
        try require(a === shiftedImage, "trim/offset mantém fase e usa cache vigente")
        for step in 0..<150 { _ = try cache.image(at: Double(step) / 200, timebase: 120_000) }
        let usage = StudioTextRasterCache.cacheUsage()
        try require(usage.count <= 32 && usage.bytes <= 32 * 1024 * 1024, "cache não cresce com duração")
      }
    }
    print("Animação: typewriter/pop/bounce/fade/zoom/slide-right, arquivo real no mesmo tempo; cache limitado32/32MB.")
  }
  static func defaultsAndInteractiveText() async throws {
    let legacy = textRecipe(), prepared = try await engine.prepare(recipeJSON: json(legacy))
    var explicit = modify(legacy) { clip in
      var next = clip; next["playbackRate"] = 1; next["flipHorizontal"] = false; next["flipVertical"] = false; next["motion"] = "none"; return next
    }
    explicit = modify(explicit, id: "title") { clip in
      var next = clip, title = clip["text"] as! [String: Any]
      title["decoration"] = "none"; title["visualEffect"] = "none"; title["animation"] = "none"
      next["text"] = title; return next
    }
    let defaults = try engine.updateVisuals(prepared, recipeJSON: json(explicit))
    try require(defaults?.composition === prepared.composition, "defaults opcionais mantêm pistas de receita antiga")
    let oldFrame = try await engine.frame(prepared, at: 0.2), defaultFrame = try await engine.frame(defaults!, at: 0.2)
    try require(try meanDifference(oldFrame, defaultFrame) == 0, "defaults opcionais preservam pixels antigos")
    let styled = modify(textRecipe(animation: "typewriter"), id: "title") { clip in
      var next = clip, title = clip["text"] as! [String: Any]
      title["decoration"] = "outline-inverse"; title["visualEffect"] = "halo"
      title["gradientColors"] = ["#FF3D78", "#44AAFF"]; title["secondaryColor"] = "#FFDB00"
      next["text"] = title; next["flipHorizontal"] = true
      next["grade"] = ["preset": "cinematic", "intensity": 0.5, "exposure": 0.1, "contrast": 0.2, "saturation": 0.1, "temperature": 0.2]
      return next
    }
    let current = try await engine.prepare(recipeJSON: json(styled))
    let frozen = try await engine.frozenFrame(current, at: 0.2).processed()
    let rect = StudioRecipe.Rect(x: 0.13, y: 0.17, width: 0.6, height: 0.5)
    let resized = modify(styled, id: "title") { clip in
      var next = clip, title = clip["text"] as! [String: Any]
      next["rect"] = ["x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height]
      title["fontSize"] = 0.07; next["text"] = title; return next
    }
    let canonical = try engine.updateVisuals(current, recipeJSON: json(resized))!
    let live = try frozen.image(override: StudioRecipeVisualOverride(clipId: "title", rect: rect, textFontSize: 0.07))
    let liveImage = current.renderer.context.createCGImage(live, from: CGRect(origin: .zero, size: current.recipe.size), format: .RGBA8,
      colorSpace: StudioEffectRenderer.outputColorSpace)!
    let canonicalImage = try await engine.frame(canonical, at: 0.2)
    try require(try meanDifference(liveImage, canonicalImage) < 0.01, "resize interativo preserva outline/halo/gradiente/grade/typewriter/espelho")
    let shifted = modify(styled, id: "title") { clip in var next = clip; next["animationOffsetTicks"] = 24_000; return next }
    let shiftedPrepared = try engine.updateVisuals(current, recipeJSON: json(shifted))!
    let before = try await engine.frame(current, at: 0.2), after = try await engine.frame(shiftedPrepared, at: 0)
    try require(try meanDifference(before, after) < 0.01, "animação mantém fase no trim sem resetar cache")
    for motion in StudioRecipeVisualEffects.motions.filter({ $0 != "none" }) {
      let whole = modify(base(source: "quadrants.mp4")) { clip in var next = clip; next["motion"] = motion; return next }
      let original = try await engine.prepare(recipeJSON: json(whole))
      var trimmed = base(source: "quadrants.mp4", seconds: 1.5)
      trimmed = modify(trimmed) { clip in
        var next = clip; next["sourceStartTicks"] = 60_000; next["motion"] = motion
        next["motionOffsetTicks"] = 60_000; next["motionDurationTicks"] = 240_000; return next
      }
      let cut = try await engine.prepare(recipeJSON: json(trimmed))
      let originalFrame = try await engine.frame(original, at: 0.7), cutFrame = try await engine.frame(cut, at: 0.2)
      try require(try meanDifference(originalFrame, cutFrame) < 0.01, "motion\(motion) mantém fase no trim")
    }
    print("Defaults e resize congelado de texto com efeitos têm paridade exata; offsets preservam animação/motion após trim.")
  }
  static func speed() async throws {
    let source = root.appendingPathComponent("clock.mp4"), bytes = try Data(contentsOf: source)
    for rate in [0.25, 0.5, 1.0, 2.0, 4.0] {
      var value = base(seconds: 2 / rate)
      value = modify(value) { clip in var next = clip; next["playbackRate"] = rate; return next }
      let prepared = try await engine.prepare(recipeJSON: json(value))
      try require(abs(prepared.composition.duration.seconds - 2 / rate) < 0.001, "\(rate)x mapeia duração real")
      for mediaType in [AVMediaType.video, AVMediaType.audio] {
        let segments = prepared.composition.tracks(withMediaType: mediaType).flatMap { $0.segments ?? [] }.filter { !$0.isEmpty }
        try require(segments.count == 1 && abs(segments[0].timeMapping.source.duration.seconds - 2) < 0.03
          && abs(segments[0].timeMapping.target.duration.seconds - 2 / rate) < 0.03,
          "\(mediaType.rawValue) tem mapeamento de fonte real\(rate)x")
      }
      let output = try await export(value, name: "speed-\(rate)")
      let asset = AVURLAsset(url: output), duration = try await asset.load(.duration).seconds
      try require(abs(duration - 2 / rate) < 0.04, "arquivo \(rate)x tem duração correta")
      try require(try await asset.loadTracks(withMediaType: .audio).count == 1, "\(rate)x conserva áudio")
      for fraction in [0.25, 0.75] {
        let at = 2 / rate * fraction, frame = try await engine.frame(prepared, at: at)
        let actual = try image(read(output, at: at), prepared: prepared)
        try require(try meanDifference(frame, actual) < 3, "\(rate)x escolhe quadro original pelo tempo escalado")
      }
      // Check a slow timeline's nonaligned source-frame boundary, rather
      // than relying only on samples exactly aligned to original timestamps.
      if rate == 0.25 {
        let at = 119 / 30.0
        let frame = try await engine.frame(prepared, at: at)
        let actual = try image(read(output, at: at), prepared: prepared)
        try require(try meanDifference(frame, actual) < 3, "slow0.25x mantém paridade na fronteira não alinhada")
      }
    }
    try require(try Data(contentsOf: source) == bytes, "velocidade não reescreve fonte")
    print("Velocidade: .25/.5/1/2/4x com duração de áudio/vídeo e quadros reais, fonte intacta.")
  }
  static func mirrorsAndFades() async throws {
    let original = base(source: "quadrants.mp4"), prepared = try await engine.prepare(recipeJSON: json(original))
    let normal = try await engine.frame(prepared, at: 0.5), normalPixels = try pixels(normal)
    for horizontal in [false, true] { for vertical in [false, true] {
      let value = modify(original) { clip in var next = clip; next["flipHorizontal"] = horizontal; next["flipVertical"] = vertical; return next }
      let current = try engine.updateVisuals(prepared, recipeJSON: json(value))!
      try require(current.composition === prepared.composition, "espelho mantém pistas/item")
      let frame = try await engine.frame(current, at: 0.5), data = try pixels(frame)
      func index(_ x: Int, _ y: Int) -> Int { (y * 640 + x) * 4 }
      for (x, y) in [(80, 45), (560, 45), (80, 315), (560, 315)] {
        let from = index(horizontal ? 639 - x : x, vertical ? 359 - y : y), to = index(x, y)
        try require((0..<3).allSatisfy { abs(Int(data[to + $0]) - Int(normalPixels[from + $0])) <= 2 }, "espelhoH\(horizontal)V\(vertical) move somente pixels corretos")
      }
      let output = try await export(value, name: "mirror-\(horizontal)-\(vertical)")
      try require(try meanDifference(frame, image(read(output, at: 0.5), prepared: current)) < 3, "espelho prévia/export iguais")
    } }
    let faded = modify(base()) { clip in var next = clip; next["fadeInTicks"] = 48_000; next["fadeOutTicks"] = 48_000; return next }
    let fadePrepared = try await engine.prepare(recipeJSON: json(faded))
    let start = try pixels(await engine.frame(fadePrepared, at: 0.0)), middle = try pixels(await engine.frame(fadePrepared, at: 0.2))
    try require(start[0] < middle[0] && middle[0] < 250, "fade principal altera alpha verdadeiro")
    let fadeOutput = try await export(faded, name: "main-fades")
    let expected = try await engine.frame(fadePrepared, at: 0.2)
    try require(try meanDifference(expected, image(read(fadeOutput, at: 0.2), prepared: fadePrepared)) < 3, "fade principal exportado")
    print("Espelho H/V real, fades do principal e fontes sem mutação; sem reconstrução visual das pistas.")
  }
  static func audioRMS(_ url: URL, at seconds: Double) throws -> Double {
    let asset = AVURLAsset(url: url), tracks = asset.tracks(withMediaType: .audio)
    try require(!tracks.isEmpty, "arquivo mantém pista real de som")
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: seconds, preferredTimescale: 48_000), duration: CMTime(seconds: 0.05, preferredTimescale: 48_000))
    let output = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM,
      AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false])
    reader.add(output); try require(reader.startReading(), "decode PCM inicia")
    defer { reader.cancelReading() }
    var squared = 0.0, count = 0
    while let sample = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
      let length = CMBlockBufferGetDataLength(block); var bytes = Data(count: length)
      let status = bytes.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
      try require(status == noErr, "PCM lido")
      bytes.withUnsafeBytes { for x in $0.bindMemory(to: Float.self) { squared += Double(x) * Double(x); count += 1 } }
    }
    try require(count > 0, "PCM não vazio")
    return sqrt(squared / Double(count))
  }
  static func audioFrequency(_ url: URL, at seconds: Double) throws -> Double {
    let asset = AVURLAsset(url: url), reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: seconds, preferredTimescale: 48_000), duration: CMTime(seconds: 0.2, preferredTimescale: 48_000))
    let output = AVAssetReaderAudioMixOutput(audioTracks: asset.tracks(withMediaType: .audio), audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1, AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false])
    reader.add(output); try require(reader.startReading(), "PCM para pitch inicia")
    defer { reader.cancelReading() }
    var samples: [Double] = []
    while let sample = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(sample) {
      let length = CMBlockBufferGetDataLength(block); var bytes = Data(count: length)
      let status = bytes.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
      try require(status == noErr, "PCM pitch lido")
      bytes.withUnsafeBytes { samples.append(contentsOf: $0.bindMemory(to: Float.self).map(Double.init)) }
    }
    try require(!samples.isEmpty, "PCM pitch não vazio")
    let window = samples.enumerated().map { index, value in value * (0.5 - 0.5 * cos(2 * .pi * Double(index) / Double(samples.count - 1))) }
    // Splice edges in pitch-corrected audio add zero-crossings; use dominant
    // spectral power rather than confusing those transitions with voice pitch.
    var strongest = 0.0, frequency = 0.0
    for candidate in stride(from: 400, through: 4000, by: 5) {
      let coefficient = 2 * cos(2 * .pi * Double(candidate) / 48_000)
      var previous = 0.0, previous2 = 0.0
      for sample in window { let current = sample + coefficient * previous - previous2; previous2 = previous; previous = current }
      let power = previous * previous + previous2 * previous2 - coefficient * previous * previous2
      if power > strongest { strongest = power; frequency = Double(candidate) }
    }
    return frequency
  }
  static func retimedAudioClock() async throws {
    // M4A has no video track to constrain time-pitch latency. Repeat short
    // requests and check both the actual clock and pitch, not just track maps.
    let rates = [0.25, 0.5, 1.0, 2.0, 4.0] + Array(repeating: 2.0, count: 20)
    for (index, rate) in rates.enumerated() {
      var value = base(seconds: 2 / rate), assets = value["assets"] as! [[String: Any]]
      assets[0]["hasAudio"] = true; value["assets"] = assets; value["mediaType"] = "audio"
      value = modify(value) { clip in var next = clip; next["kind"] = "audio"; next["playbackRate"] = rate; return next }
      var output = value["output"] as! [String: Any]; output["frameRateNumerator"] = 60; value["output"] = output
      let url = root.appendingPathComponent("audio-rate-\(index)-\(rate).m4a")
      print("Export audio case: audio-rate-\(index), playbackRate=\(rate), expectedDuration=\(2 / rate), outputFPS=60")
      let result = try await engine.export(requestId: "audio-rate-\(index)", recipeJSON: json(value), outputUri: url.absoluteString, progress: { _ in })
      let duration = result["duration"] as? Double ?? 0
      let encodedDuration = result["audioEncodedDuration"] as? Double ?? 0
      let pitch = try audioFrequency(url, at: min(0.2, 0.5 / rate))
      print("Audio normalized: case=\(index), rate=\(rate), encodedDuration=\(encodedDuration), canonicalDuration=\(duration), expected=\(2 / rate), pitch=\(pitch)")
      try require(duration <= 2 / rate + 1 / 48_000.0 + 0.0001, "M4A\(rate)x remux não mantém cauda fora da montagem")
      if encodedDuration > 2 / rate {
        try require(abs(duration - 2 / rate) < 1 / 48_000.0 + 0.0001, "M4A\(rate)x corta cauda no tempo canônico")
      } else {
        try require(abs(duration - encodedDuration) < 1 / 48_000.0 + 0.0001, "M4A\(rate)x não inventa áudio ausente no encode")
      }
      try require(abs(duration - 2 / rate) <= 1 / 60.0 + 0.01, "M4A\(rate)x respeita relógio canônico sem relaxar guard")
      try require(abs(pitch - 880) < 35, "M4A\(rate)x mantém pitch da voz: \(pitch)")
      evidence.append(["case": "audio-rate-\(index)-\(rate)", "encodedDuration": encodedDuration, "duration": duration, "expectedDuration": 2 / rate, "frequency": pitch, "hasAudio": true, "uri": url.absoluteString])
    }
    try require(try FileManager.default.contentsOfDirectory(atPath: root.path).allSatisfy { !$0.hasPrefix(".classfy-export-") }, "temporários das duas fases são limpos")
    print("M4A retimed:\(rates.count)exports em.25/.5/1/2/4x e repetição2x removem cauda AAC, preservam guard60fps e pitch880Hz.")
  }
  static func audioTransactionSafety() async throws {
    var value = base(seconds: 1), assets = value["assets"] as! [[String: Any]]
    assets[0]["hasAudio"] = true; value["assets"] = assets; value["mediaType"] = "audio"
    value = modify(value) { clip in var next = clip; next["kind"] = "audio"; next["playbackRate"] = 2; return next }
    let original = root.appendingPathComponent("clock.mp4"), bytes = try Data(contentsOf: original)
    let destination = root.appendingPathComponent("audio-normalization-safety.m4a")
    var sawRemux = false, progress: [Double] = []
    do {
      _ = try await engine.export(requestId: "audio-safety", recipeJSON: json(value), outputUri: destination.absoluteString, progress: { amount in
        progress.append(amount)
        if amount == 0.9 { sawRemux = true; engine.cancel("audio-safety") }
      })
      throw StudioRecipeError.invalid("Teste: cancel entre fases publicou áudio")
    } catch { try require(!error.localizedDescription.contains("Teste:"), "cancel entre fases é respeitado") }
    try require(sawRemux && !FileManager.default.fileExists(atPath: destination.path) && !progress.contains(1), "remux cancelado não publica destino nem100%")
    try require(zip(progress, progress.dropFirst()).allSatisfy { $0 <= $1 }, "progresso antes do cancel é monotônico")
    try require(try FileManager.default.contentsOfDirectory(atPath: root.path).allSatisfy { !$0.hasPrefix(".classfy-export-") }, "cancel limpa os dois temporários exclusivos")
    let sentinel = Data("Arquivo de outra operação".utf8)
    do {
      _ = try await engine.export(requestId: "audio-safety", recipeJSON: json(value), outputUri: destination.absoluteString, progress: { amount in
        if amount == 0.9 && !FileManager.default.fileExists(atPath: destination.path) { try! sentinel.write(to: destination) }
      })
      throw StudioRecipeError.invalid("Teste: remux substituiu destino concorrente")
    } catch { try require(!error.localizedDescription.contains("Teste:"), "colisão tardia rejeita commit") }
    try require(try Data(contentsOf: destination) == sentinel, "colisão mantém arquivo alheio")
    try FileManager.default.removeItem(at: destination)
    progress = []
    let result = try await engine.export(requestId: "audio-safety", recipeJSON: json(value), outputUri: destination.absoluteString, progress: { amount in
      progress.append(amount)
      if amount == 1 { engine.cancel("audio-safety") }
    })
    try require(abs((result["duration"] as? Double ?? 0) - 1) < 0.0001 && FileManager.default.fileExists(atPath: destination.path), "mesmo requestID pode retry; cancel100% não desfaz arquivo durável")
    try require(progress.filter { $0 == 1 }.count == 1 && zip(progress, progress.dropFirst()).allSatisfy { $0 <= $1 }, "normalização publica progresso monotônico e100% único")
    try require(try Data(contentsOf: original) == bytes && audioRMS(destination, at: 0.3) > 0.03, "retry mantém áudio real e original intacto")
    try require(try FileManager.default.contentsOfDirectory(atPath: root.path).allSatisfy { !$0.hasPrefix(".classfy-export-") }, "retry limpa temporários das duas fases")
    print("Transação M4A: cancel90%, colisão tardia e retry mesmoID preservam destino, fonte, progresso e temporários.")
  }
  static func motionAndExtraction() async throws {
    let value = base(source: "quadrants.mp4"), prepared = try await engine.prepare(recipeJSON: json(value))
    for kind in StudioRecipeVisualEffects.motions.filter({ $0 != "none" }) {
      let changed = modify(value) { clip in var next = clip; next["motion"] = kind; return next }
      let visual = try engine.updateVisuals(prepared, recipeJSON: json(changed))!
      try require(visual.composition === prepared.composition, "motion\(kind) mantém decoder")
      let at = kind == "fade-out" ? 1.8 : 0.2
      let normal = try await engine.frame(prepared, at: at), animated = try await engine.frame(visual, at: at)
      try require(try meanDifference(normal, animated) > 0.05, "motion\(kind) altera imagem real")
      let output = try await export(changed, name: "motion-\(kind)")
      try require(try meanDifference(animated, image(read(output, at: at), prepared: visual)) < 4,
        "motion\(kind) usa compositor igual no arquivo")
    }
    var extracted = base(), assets = extracted["assets"] as! [[String: Any]]
    assets[0]["hasAudio"] = true; extracted["assets"] = assets
    var audio = (extracted["clips"] as! [[String: Any]])[0]; audio["kind"] = "audio"; audio["id"] = "extracted"; audio["playbackRate"] = 2; audio["durationTicks"] = 120_000
    extracted["clips"] = [audio]; extracted["mediaType"] = "audio"; extracted["durationTicks"] = 120_000
    let audioPrepared = try await engine.prepare(recipeJSON: json(extracted))
    try require(audioPrepared.composition.tracks(withMediaType: .video).isEmpty && audioPrepared.audioTrackIDs.count == 1,
      "extração aponta original sem criar decoder de vídeo")
    let url = root.appendingPathComponent("extracted-audio.m4a")
    print("Export audio case: extracted-audio, playbackRate=2, expectedDuration=1, outputFPS=30")
    let result = try await engine.export(requestId: "extract", recipeJSON: json(extracted), outputUri: url.absoluteString, progress: { _ in })
    evidence.append(["case": "extracted-audio-2x", "duration": result["duration"] ?? NSNull(), "expectedDuration": 1, "hasAudio": true, "uri": url.absoluteString])
    try require(abs((result["duration"] as? Double ?? 0) - 1) < 0.04 && audioRMS(url, at: 0.25) > 0.03,
      "extração contém som original real e rate2x")
    var invalid = extracted; assets[0]["hasAudio"] = false; invalid["assets"] = assets
    do { _ = try StudioRecipeEngine.decode(json(invalid)); throw StudioRecipeError.invalid("Teste: extração sem áudio aceita") }
    catch { try require(!error.localizedDescription.contains("Teste:"), "metadatahasAudiofalse impede extração") }
    var missing = extracted; assets[0]["uri"] = root.appendingPathComponent("quadrants.mp4").absoluteString; assets[0]["hasAudio"] = true; missing["assets"] = assets
    do { _ = try await engine.prepare(recipeJSON: json(missing)); throw StudioRecipeError.invalid("Teste: metadata mentirosa aceitou pista ausente") }
    catch { try require(!error.localizedDescription.contains("Teste:"), "pista real ausente impede extração") }
    let faded = root.appendingPathComponent("main-fades.mp4")
    let edge = try audioRMS(faded, at: 0.04), center = try audioRMS(faded, at: 0.8), tail = try audioRMS(faded, at: 1.91)
    try require(center > 0.03 && edge < center * 0.4 && tail < center * 0.4, "fades do principal alteram áudio real")
    print("Motion: 5 efeitos reais; extraçãoaudio2x semcópia e fadesRMSedge\(edge)/center\(center)/tail\(tail).")
  }
  static func thumbnailsAndValidation() async throws {
    let output = root.appendingPathComponent("treatment-thumbnail.jpg")
    let result = try await engine.thumbnail(recipeJSON: json(base()), outputUri: output.absoluteString, seconds: 0.5)
    try require(result["width"] as? Int == 480 && result["height"] as? Int == 270, "miniatura real limitada480")
    let saved = try Data(contentsOf: output)
    do { _ = try await engine.thumbnail(recipeJSON: json(base()), outputUri: output.absoluteString, seconds: 0.5); throw StudioRecipeError.invalid("Teste: destino sobrescrito") }
    catch { try require(!error.localizedDescription.contains("Teste:"), "destino existente rejeitado") }
    try require(try Data(contentsOf: output) == saved, "miniatura existente intacta")
    for patch in [["playbackRate": 0.1], ["playbackRate": 5], ["motion": "reverse"], ["animationOffsetTicks": -1]] as [[String: Any]] {
      let bad = modify(base()) { clip in clip.merging(patch, uniquingKeysWith: { _, b in b }) }
      do { _ = try StudioRecipeEngine.decode(json(bad)); throw StudioRecipeError.invalid("Teste: inválido aceito") }
      catch { try require(!error.localizedDescription.contains("Teste:"), "enum/rate/offset inválido rejeitado") }
    }
  }
  static func main() async throws {
    setbuf(stdout, nil)
    if CommandLine.arguments.contains("--audio-only") {
      try await retimedAudioClock()
      try await audioTransactionSafety()
      let report: [String: Any] = ["passed": true, "scope": "retimed-audio", "exports": evidence]
      try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: root.appendingPathComponent("audio-report.json"))
      return
    }
    try await textGrid(); try await animations(); try await defaultsAndInteractiveText(); try await speed(); try await mirrorsAndFades(); try await motionAndExtraction(); try await retimedAudioClock(); try await audioTransactionSafety(); try await thumbnailsAndValidation()
    let report: [String: Any] = ["passed": true, "exports": evidence, "typewriterCache": ["count": StudioTextRasterCache.cacheUsage().count, "bytes": StudioTextRasterCache.cacheUsage().bytes]]
    try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: root.appendingPathComponent("report.json"))
    print("OK: \(evidence.count) arquivos reais; report.json e text-style-grid.png no diretório do teste.")
  }
}
