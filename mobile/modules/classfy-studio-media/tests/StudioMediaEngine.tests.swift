// Run on macOS with swiftc + StudioMediaEngine.swift. Inputs are local synthetic fixtures,
// so this verification never publishes or sends media to a server.
import Foundation
import AVFoundation

@main
struct StudioMediaEngineTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioMediaError.invalid("Teste: \(message)") }
  }
  static func main() async throws {
    guard CommandLine.arguments.count == 8 else {
      throw StudioMediaError.invalid("Informe os quatro originais básicos e fixtures UHD 24/60 e 25 fps.")
    }
    let red = URL(fileURLWithPath: CommandLine.arguments[1]).absoluteString
    let blue = URL(fileURLWithPath: CommandLine.arguments[2]).absoluteString
    let audio = URL(fileURLWithPath: CommandLine.arguments[3]).absoluteString
    let rotated = URL(fileURLWithPath: CommandLine.arguments[4]).absoluteString
    let uhd24 = URL(fileURLWithPath: CommandLine.arguments[5]).absoluteString
    let uhd60 = URL(fileURLWithPath: CommandLine.arguments[6]).absoluteString
    let fps25 = URL(fileURLWithPath: CommandLine.arguments[7]).absoluteString
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("classfy-studio-engine-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let engine = StudioMediaEngine()
    func settings(_ dimensions: [(Int, Int, Double)], _ aspect: String = "landscape") -> StudioVideoRenderSettings {
      StudioMediaEngine.videoRenderSettings(sources: dimensions.map {
        StudioVideoProperties(displaySize: CGSize(width: $0.0, height: $0.1), frameRate: $0.2)
      }, aspectRatio: aspect)
    }
    let baseline = settings([(1920, 1080, 24)])
    try require(baseline.renderSize == CGSize(width: 1920, height: 1080) && abs(baseline.frameDuration.seconds - 1 / 24.0) < 1e-6, "24 fps não vira 30")
    let mixed = settings([(1920, 1080, 30), (2160, 3840, 60)])
    try require(mixed.renderSize == CGSize(width: 3840, height: 2160) && mixed.frameRate == 60, "4K rotacionado e maior FPS de take posterior")
    try require(settings([(7680, 4320, 120)], "portrait").renderSize == CGSize(width: 2160, height: 3840), "canvas limitado a UHD em portrait")
    try require(settings([(7680, 4320, 120)]).frameRate == 60, "cadência limitada a 60 fps")
    try require(settings([(320, 180, 25)]).frameRate == 25 && settings([(320, 180, 50)]).frameRate == 50, "25/50 não ganham quadros artificiais")
    try require(settings([(1920, 1080, 59.94)]).frameDuration == CMTime(value: 1001, timescale: 60_000), "59,94 preserva cadência fracionária")
    try require(settings([(1920, 1080, .nan), (1920, 1080, 0)]).frameRate == 30, "metadata sem taxa usa fallback seguro")
    try require(settings([(3840, 2160, 30)], "square").renderSize == CGSize(width: 2160, height: 2160), "canvas quadrado UHD")
    let portrait = try await engine.mediaInfo(blue)
    try require(portrait["height"] as? Double == 320, "metadata vertical")
    try require(abs((portrait["frameRate"] as? Double ?? 0) - 30) < 0.02, "mediaInfo expõe taxa real")
    let rotatedInfo = try await engine.mediaInfo(rotated)
    try require(rotatedInfo["width"] as? Double == 180 && rotatedInfo["height"] as? Double == 320, "metadata de rotação respeitada")
    let landscapeURL = dir.appendingPathComponent("landscape.mp4")
    let result = try await engine.export(requestId: "landscape", clips: [
      StudioClip(uri: blue, startSeconds: 0.5, endSeconds: 1.5),
      StudioClip(uri: red, startSeconds: 0.25, endSeconds: 1.0)
    ], outputUri: landscapeURL.absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    try require(abs((result["duration"] as? Double ?? 0) - 1.75) < 0.06, "cortes e concatenação reais")
    try require(result["width"] as? Double == 1920 && result["height"] as? Double == 1080, "exportação 1080p horizontal")
    try require(result["hasAudio"] as? Bool == true, "áudio preservado após take silencioso")
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: landscapeURL))
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    let first = try generator.copyCGImage(at: CMTime(seconds: 0.2, preferredTimescale: 600), actualTime: nil)
    let last = try generator.copyCGImage(at: CMTime(seconds: 1.5, preferredTimescale: 600), actualTime: nil)
    func pixel(_ image: CGImage, x: Int, y: Int) -> [UInt8] {
      var bytes = [UInt8](repeating: 0, count: 4)
      bytes.withUnsafeMutableBytes { raw in
        let context = CGContext(data: raw.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: -x, y: -y, width: image.width, height: image.height))
      }
      return bytes
    }
    let firstCenter = pixel(first, x: 960, y: 540)
    let firstEdge = pixel(first, x: 20, y: 540)
    let lastCenter = pixel(last, x: 960, y: 540)
    try require(firstCenter[2] > 200 && firstCenter[0] < 30, "ordem: take azul primeiro")
    try require(firstEdge[0] < 20 && firstEdge[1] < 20 && firstEdge[2] < 20, "take vertical centralizado sem recorte")
    try require(lastCenter[0] > 200 && lastCenter[2] < 30, "ordem: take vermelho por último")
    _ = try await engine.thumbnail(landscapeURL.absoluteString, outputUri: dir.appendingPathComponent("cover.jpg").absoluteString, timeSeconds: 0.2)
    let vertical = try await engine.export(requestId: "portrait", clips: [StudioClip(uri: red, startSeconds: 0, endSeconds: 1)],
      outputUri: dir.appendingPathComponent("portrait.mp4").absoluteString, mediaType: "video", aspectRatio: "portrait", progress: { _ in })
    try require(vertical["width"] as? Double == 1080 && vertical["height"] as? Double == 1920, "short 1080p vertical")
    let rotatedURL = dir.appendingPathComponent("rotated.mp4")
    _ = try await engine.export(requestId: "rotation", clips: [StudioClip(uri: rotated, startSeconds: 0, endSeconds: 1)],
      outputUri: rotatedURL.absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    let rotatedGenerator = AVAssetImageGenerator(asset: AVURLAsset(url: rotatedURL))
    let rotatedImage = try rotatedGenerator.copyCGImage(at: .zero, actualTime: nil)
    let rotatedEdge = pixel(rotatedImage, x: 20, y: 540)
    let rotatedCenter = pixel(rotatedImage, x: 960, y: 540)
    try require(rotatedEdge[0] < 20 && rotatedCenter[0] > 200, "rotação normalizada e centralizada")
    let trailingURL = dir.appendingPathComponent("trailing-silence.mp4")
    let trailing = try await engine.export(requestId: "trailing", clips: [
      StudioClip(uri: red, startSeconds: 0, endSeconds: 1),
      StudioClip(uri: blue, startSeconds: 0, endSeconds: 1)
    ], outputUri: trailingURL.absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    try require(abs((trailing["duration"] as? Double ?? 0) - 2) < 0.1, "take final silencioso preserva a duração do vídeo")
    let podcast = try await engine.export(requestId: "audio", clips: [
      StudioClip(uri: audio, startSeconds: 0.5, endSeconds: 1.5),
      StudioClip(uri: audio, startSeconds: 0, endSeconds: 0.5)
    ], outputUri: dir.appendingPathComponent("podcast.m4a").absoluteString, mediaType: "audio", aspectRatio: "landscape", progress: { _ in })
    try require(abs((podcast["duration"] as? Double ?? 0) - 1.5) < 0.06, "cortes de áudio reais")
    try require(podcast["hasAudio"] as? Bool == true && podcast["hasVideo"] as? Bool == false, "podcast M4A")
    try require(podcast["frameRate"] as? Double == 0, "áudio não inventa taxa de vídeo")
    let uhdInfo = try await engine.mediaInfo(uhd24)
    try require(uhdInfo["width"] as? Double == 3840 && uhdInfo["height"] as? Double == 2160 && abs((uhdInfo["frameRate"] as? Double ?? 0) - 24) < 0.02, "metadata UHD 24 fps")
    let originalBytes = try Data(contentsOf: URL(string: uhd24)!)
    let high24 = try await engine.export(requestId: "uhd24", clips: [StudioClip(uri: uhd24, startSeconds: 0, endSeconds: 0.25)],
      outputUri: dir.appendingPathComponent("uhd24.mp4").absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    try require(high24["width"] as? Double == 3840 && high24["height"] as? Double == 2160 && abs((high24["frameRate"] as? Double ?? 0) - 24) < 0.02, "exportação real UHD mantém 24 fps")
    let mixed30 = try await engine.export(requestId: "24-then-30", clips: [
      StudioClip(uri: uhd24, startSeconds: 0, endSeconds: 0.125), StudioClip(uri: red, startSeconds: 0, endSeconds: 0.1)
    ], outputUri: dir.appendingPathComponent("24-then-30.mp4").absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    try require(abs((mixed30["frameRate"] as? Double ?? 0) - 30) < 0.02, "24 fps primeiro não limita take posterior de 30 fps")
    let high60 = try await engine.export(requestId: "uhd60-mixed", clips: [
      StudioClip(uri: red, startSeconds: 0, endSeconds: 0.1), StudioClip(uri: uhd60, startSeconds: 0, endSeconds: 0.1)
    ], outputUri: dir.appendingPathComponent("uhd60-mixed.mp4").absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    try require(high60["width"] as? Double == 3840 && high60["height"] as? Double == 2160 && abs((high60["frameRate"] as? Double ?? 0) - 60) < 0.02, "take UHD posterior mantém resolução e 60 fps na montagem")
    let highPortrait = try await engine.export(requestId: "uhd-portrait", clips: [StudioClip(uri: uhd24, startSeconds: 0, endSeconds: 0.125)],
      outputUri: dir.appendingPathComponent("uhd-portrait.mp4").absoluteString, mediaType: "video", aspectRatio: "portrait", progress: { _ in })
    try require(highPortrait["width"] as? Double == 2160 && highPortrait["height"] as? Double == 3840 && abs((highPortrait["frameRate"] as? Double ?? 0) - 24) < 0.02, "canvas portrait UHD preserva FPS")
    let originalAfterExport = try Data(contentsOf: URL(string: uhd24)!)
    try require(originalAfterExport == originalBytes, "exportação UHD não altera bytes do original")
    let real25 = try await engine.export(requestId: "25fps", clips: [StudioClip(uri: fps25, startSeconds: 0, endSeconds: 0.24)],
      outputUri: dir.appendingPathComponent("25fps.mp4").absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    try require(abs((real25["frameRate"] as? Double ?? 0) - 25) < 0.02, "exportação real 25 fps sem aumentar para 30")
    var refusedOverwrite = false
    do {
      _ = try await engine.export(requestId: "overwrite", clips: [StudioClip(uri: red, startSeconds: 0, endSeconds: 1)],
        outputUri: red, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    } catch { refusedOverwrite = true }
    try require(refusedOverwrite, "original nunca sobrescrito")
    let earlyCancellationOutput = dir.appendingPathComponent("cancelled-before-metadata.mp4")
    var cancelledBeforeMetadata = false
    do {
      _ = try await engine.export(requestId: "cancel-early", clips: [StudioClip(uri: red, startSeconds: 0, endSeconds: 1)],
        outputUri: earlyCancellationOutput.absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in engine.cancel("cancel-early") })
    } catch { cancelledBeforeMetadata = true }
    try require(cancelledBeforeMetadata && !FileManager.default.fileExists(atPath: earlyCancellationOutput.path), "cancelamento no primeiro progresso antecede preparação de mídia")
    let cancellationOutput = dir.appendingPathComponent("cancelled.mp4")
    let task = Task {
      try await engine.export(requestId: "cancel", clips: (0..<20).map { _ in StudioClip(uri: red, startSeconds: 0, endSeconds: 2) },
        outputUri: cancellationOutput.absoluteString, mediaType: "video", aspectRatio: "landscape", progress: { _ in })
    }
    try await Task.sleep(nanoseconds: 50_000_000)
    engine.cancel("cancel")
    var cancelled = false
    do { _ = try await task.value } catch { cancelled = true }
    try require(cancelled && !FileManager.default.fileExists(atPath: cancellationOutput.path), "cancelamento limpa apenas exportação incompleta")
    print("OK: cortes, ordem, contain/rotação, áudio, capa, UHD 24/60, 25 fps, original e cancelamento. Arquivos: \(dir.path)")
  }
}
