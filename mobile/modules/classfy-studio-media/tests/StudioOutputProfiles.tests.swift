import AVFoundation
import CoreImage
import Darwin
import Foundation

@main
struct StudioOutputProfilesTests {
  static func require(_ value: Bool, _ message: String) throws {
    if !value { throw StudioRecipeError.invalid("Perfil de saída: \(message)") }
  }
  static func recipe(_ source: URL, width: Int, height: Int, numerator: Int, denominator: Int = 1,
                     aspect: String = "landscape", withText: Bool = false) throws -> String {
    let duration = 24_000
    var clips: [[String: Any]] = [["id": "main", "kind": "video", "assetId": "source", "startTicks": 0,
      "durationTicks": duration, "sourceStartTicks": 0, "sourceEndTicks": duration, "zIndex": 0,
      "rect": ["x": 0, "y": 0, "width": 1, "height": 1], "rotationDegrees": 0, "fit": "contain",
      "opacity": 1, "gain": 1, "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]]
    if withText {
      clips.append(["id": "title", "kind": "text", "startTicks": 0, "durationTicks": duration,
        "sourceStartTicks": 0, "sourceEndTicks": 0, "zIndex": 1,
        "rect": ["x": 0.1, "y": 0.1, "width": 0.8, "height": 0.3], "rotationDegrees": 0, "fit": "contain",
        "opacity": 1, "gain": 0, "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural",
        "text": ["content": "AULA 4K", "fontFamily": "system", "fontSize": 0.08,
          "color": "#FFFFFF", "backgroundColor": "#00000000", "alignment": "center"]])
    }
    let value: [String: Any] = ["version": 2, "timebase": 120_000, "durationTicks": duration,
      "mediaType": "video", "canvas": ["aspectRatio": aspect, "backgroundColor": "#000000"],
      "output": ["profile": "standard", "width": width, "height": height,
        "frameRateNumerator": numerator, "frameRateDenominator": denominator, "colorSpace": "rec709"],
      "assets": [["id": "source", "kind": "video", "uri": source.absoluteString,
        "durationTicks": 120_000, "sourceStage": "standard", "width": 3840, "height": 2160, "frameRate": 60]],
      "clips": clips]
    return String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
  }
  static func checkFile(_ url: URL, width: Int, height: Int, rate: Double) async throws -> [String: Any] {
    let asset = AVURLAsset(url: url)
    let track = try await asset.loadTracks(withMediaType: .video).first!
    let size = try await track.load(.naturalSize), actualRate = Double(try await track.load(.nominalFrameRate))
    try require(size.width == Double(width) && size.height == Double(height), "arquivo real tem \(width)×\(height)")
    try require(abs(actualRate - rate) < 0.02, "arquivo real FPS \(actualRate), esperado \(rate)")
    let format = try await track.load(.formatDescriptions).first!
    try require(CMFormatDescriptionGetMediaSubType(format) == (rate > 30.1 ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264), "codec confirma cadência sem degradar")
    let colors = CMFormatDescriptionGetExtensions(format) as? NSDictionary ?? [:]
    try require(colors[kCMFormatDescriptionExtension_ColorPrimaries] as? String == kCMFormatDescriptionColorPrimaries_ITU_R_709_2 as String,
      "primárias SDR Rec.709 no arquivo")
    try require(colors[kCMFormatDescriptionExtension_TransferFunction] as? String == kCMFormatDescriptionTransferFunction_ITU_R_709_2 as String,
      "transferência SDR Rec.709 no arquivo")
    let info = try await StudioMediaEngine().mediaInfo(url.absoluteString)
    try require(info["colorSpace"] as? String == "rec709" && info["transferFunction"] as? String == kCMFormatDescriptionTransferFunction_ITU_R_709_2 as String,
      "metadata pública conserva cores confirmadas do arquivo")
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.alwaysCopiesSampleData = false
    reader.add(output); try require(reader.startReading(), "arquivo pode ser lido")
    var presentation: [Double] = []
    while let sample = output.copyNextSampleBuffer() {
      guard CMSampleBufferGetImageBuffer(sample) != nil else { continue }
      let seconds = CMSampleBufferGetPresentationTimeStamp(sample).seconds
      if seconds.isFinite { presentation.append(seconds) }
    }
    try require(reader.status == .completed && presentation.count >= 4, "frames reais da exportação")
    // Compressed B-frames arrive in decode order. Their presentation times,
    // not their packet order, prove the final cadence.
    presentation.sort()
    for (left, right) in zip(presentation, presentation.dropFirst()) {
      try require(abs(right - left - 1 / rate) < 0.0001, "timestamps preservam a cadência solicitada \(rate): \(presentation)")
    }
    print("FILE \(width)x\(height) \(actualRate)fps frames=\(presentation.count) codec=\(rate > 30.1 ? "HEVC" : "H264") Rec709")
    return ["width": Int(size.width), "height": Int(size.height), "frameRate": actualRate,
      "frameCount": presentation.count, "codec": rate > 30.1 ? "hevc" : "h264", "colorSpace": "rec709"]
  }
  @MainActor
  static func leaseChecks() throws {
    var disabled = false, writes: [Bool] = []
    let lease = StudioExportIdleLease(read: { disabled }, write: { disabled = $0; writes.append($0) })
    let first = lease.begin(), second = lease.begin()
    try require(disabled && writes == [true], "lease concorrente adquire uma vez")
    lease.end(first); lease.end(first)
    try require(disabled, "release duplicado não libera outro export")
    lease.end(second)
    try require(!disabled && writes == [true, false], "última conclusão/cancel/falha restaura timer")
    disabled = true
    let existing = lease.begin(); lease.end(existing)
    try require(disabled, "preferência anterior do app é preservada")
    print("Idle timer: concorrência, conclusão/cancel/falha e restauração passaram (helper, sem UIKit).")
  }
  static func main() async throws {
    setbuf(stdout, nil)
    let root = URL(fileURLWithPath: CommandLine.arguments[1]), source = root.appendingPathComponent("source-4k60.mp4")
    let original = try Data(contentsOf: source)
    try await leaseChecks()
    let media = StudioMediaEngine()
    let unknownColor = try await media.mediaInfo(source.absoluteString)
    try require(unknownColor["colorSpace"] == nil, "4K não é usado para inventar HDR nem SDR desconhecido")
    let hlg = try await media.mediaInfo(root.appendingPathComponent("tagged-hlg.mp4").absoluteString)
    try require(hlg["colorSpace"] as? String == "rec2020-hlg", "arquivo 10bit HLG explicitamente marcado informa aviso HDR: \(hlg)")
    let engine = StudioRecipeEngine()
    let profiles: [(Int, Int, Int, Int, String)] = [
      (1920, 1080, 24, 1, "landscape"), (1920, 1080, 30, 1, "landscape"), (1920, 1080, 60, 1, "landscape"),
      (2560, 1440, 24, 1, "landscape"), (2560, 1440, 30, 1, "landscape"), (2560, 1440, 60, 1, "landscape"),
      (3840, 2160, 24, 1, "landscape"), (3840, 2160, 30, 1, "landscape"), (3840, 2160, 60, 1, "landscape"),
      (2160, 3840, 24, 1, "portrait"), (1440, 1440, 30, 1, "square"),
      (1280, 720, 30_000, 1001, "landscape"), (320, 180, 25, 1, "landscape"),
      (1280, 720, 24_000, 1001, "landscape"), (1280, 720, 60_000, 1001, "landscape")]
    let capabilities = StudioRecipeOutputSupport.capabilities()
    try require(capabilities["version"] as? Int == 2 && capabilities["available"] as? Bool == true, "capacidade do encoder local foi confirmada")
    print("CAPABILITIES \(capabilities)")
    var files: [[String: Any]] = []
    let report = CommandLine.arguments.count > 2 ? URL(fileURLWithPath: CommandLine.arguments[2]) : nil
    let artifactRoot = report?.deletingLastPathComponent().appendingPathComponent("output-profiles", isDirectory: true)
    if let artifactRoot { try FileManager.default.createDirectory(at: artifactRoot, withIntermediateDirectories: true) }
    for (index, profile) in profiles.enumerated() {
      let (width, height, numerator, denominator, aspect) = profile
      let json = try recipe(source, width: width, height: height, numerator: numerator, denominator: denominator, aspect: aspect, withText: index == 7)
      let prepared = try await engine.prepare(recipeJSON: json)
      try require(prepared.videoComposition?.frameDuration == CMTime(value: Int64(denominator), timescale: Int32(numerator)), "player/export usa intervalo racional")
      let destination = root.appendingPathComponent("output-\(index).mp4"), start = Date()
      var progress: [Double] = []
      let result = try await engine.export(requestId: "profile-\(index)", recipeJSON: json,
        outputUri: destination.absoluteString, progress: { progress.append($0) })
      try require(result["width"] as? Double == Double(width) && result["height"] as? Double == Double(height), "resposta retorna metadados reais")
      try require(progress.first == 0 && progress.last == 1 && progress.filter({ $0 == 1 }).count == 1, "conclusão representa arquivo validado")
      var actual = try await checkFile(destination, width: width, height: height, rate: Double(numerator) / Double(denominator))
      actual["duration"] = result["duration"]; actual["fileSize"] = result["fileSize"]
      actual["requestedNumerator"] = numerator; actual["requestedDenominator"] = denominator
      actual["secondsToExport"] = Date().timeIntervalSince(start)
      if let artifactRoot {
        let retained = artifactRoot.appendingPathComponent(destination.lastPathComponent)
        try FileManager.default.copyItem(at: destination, to: retained)
        actual["path"] = retained.path
      }
      files.append(actual)
      print("PROFILE elapsed=\(Date().timeIntervalSince(start))s")
    }
    for (width, height, numerator, denominator, aspect) in [(3842, 2160, 30, 1, "landscape"), (1920, 1081, 30, 1, "landscape"),
      (1920, 1080, 120, 1, "landscape"), (1920, 1080, 30, 0, "landscape"), (1920, 1080, 30, 1, "square"), (32, 18, 30, 1, "landscape")] {
      do {
        _ = try StudioRecipeEngine.decode(recipe(source, width: width, height: height, numerator: numerator, denominator: denominator, aspect: aspect))
        throw StudioRecipeError.invalid("Perfil inválido passou: \(width)x\(height) \(numerator)/\(denominator)")
      } catch StudioRecipeError.invalid(let message) { try require(!message.hasPrefix("Perfil inválido passou"), message) }
    }
    // Text scaling uses normalized canvas geometry; huge editing boxes are
    // bounded uniformly instead of failing or allocating hundreds of MB.
    let textJSON = try recipe(source, width: 3840, height: 2160, numerator: 30, withText: true)
    let textRecipe = try StudioRecipeEngine.decode(textJSON)
    let title = textRecipe.clips.last!
    let hdText = try StudioRecipeEngine.textImage(title, canvas: CGSize(width: 1920, height: 1080))
    let uhdText = try StudioRecipeEngine.textImage(title, canvas: CGSize(width: 3840, height: 2160))
    try require(uhdText.extent.width == hdText.extent.width * 2 && uhdText.extent.height == hdText.extent.height * 2,
      "raster 4K usa o dobro das dimensões HD, sem reduzir texto")
    var giant = try JSONSerialization.jsonObject(with: Data(textJSON.utf8)) as! [String: Any]
    var giantClips = giant["clips"] as! [[String: Any]]
    giantClips[1]["rect"] = ["x": -1, "y": -1, "width": 3, "height": 3]
    giant["clips"] = giantClips
    let giantRecipe = try StudioRecipeEngine.decode(String(data: JSONSerialization.data(withJSONObject: giant), encoding: .utf8)!)
    let bounded = try StudioRecipeEngine.textImage(giantRecipe.clips.last!, canvas: giantRecipe.size)
    try require(bounded.extent.width <= 6000 && bounded.extent.height <= 6000
      && bounded.extent.width * bounded.extent.height <= 16_777_216, "texto gigante permanece dentro do orçamento de raster")
    let cancelled = root.appendingPathComponent("cancelled-4k.mp4")
    do {
      _ = try await engine.export(requestId: "cancel-profile", recipeJSON: recipe(source, width: 3840, height: 2160, numerator: 60),
        outputUri: cancelled.absoluteString, progress: { value in if value == 0 { engine.cancel("cancel-profile") } })
      throw StudioRecipeError.invalid("Cancelamento foi ignorado")
    } catch StudioRecipeError.cancelled { }
    try require(!FileManager.default.fileExists(atPath: cancelled.path), "cancel preserva fontes e não produz arquivo parcial")
    try require(try Data(contentsOf: source) == original, "fonte 4K60 permaneceu intacta")
    if let report {
      try JSONSerialization.data(withJSONObject: ["passed": true, "validation": "native-file-macOS",
        "capabilities": capabilities, "files": files, "fixtureDurationSeconds": 0.2,
        "physicalValidationPending": ["iPhone camera formats and encoder", "20–60 minute thermal/memory/performance"]], options: [.prettyPrinted, .sortedKeys]).write(to: report)
    }
    print("Saídas SDR: 15 perfis reais, limites, fracionais, cancelamento e original intacto passaram. Não mede aula longa nem iPhone.")
  }
}
