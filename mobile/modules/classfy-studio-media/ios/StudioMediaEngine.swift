import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct StudioClip {
  let uri: String
  let startSeconds: Double
  let endSeconds: Double
}

struct StudioVideoProperties {
  let displaySize: CGSize
  let frameRate: Double
}

struct StudioVideoRenderSettings {
  let renderSize: CGSize
  let frameRate: Double
  var frameDuration: CMTime {
    // Common fractional camera rates need their real cadence, not a rounded
    // 24/30/60 that adds duplicate frames over a long lesson.
    for base in [24, 30, 60] {
      if abs(frameRate - Double(base) * 1000 / 1001) < 0.01 {
        return CMTime(value: 1001, timescale: Int32(base * 1000))
      }
    }
    return CMTime(seconds: 1 / frameRate, preferredTimescale: 60_000)
  }
}

enum StudioMediaError: LocalizedError {
  case invalid(String)
  case cancelled
  var errorDescription: String? {
    switch self {
    case .invalid(let message): return message
    case .cancelled: return "Preparação cancelada. Seus takes continuam salvos."
    }
  }
}

// Kept separate from Expo so the actual media export can be exercised with local fixtures.
final class StudioMediaEngine {
  private struct Job { var session: AVAssetExportSession?; var cancelled = false }
  private struct SourceMedia {
    let asset: AVURLAsset
    let duration: Double
    let video: AVAssetTrack?
    let audio: AVAssetTrack?
    let naturalSize: CGSize
    let preferredTransform: CGAffineTransform
    let videoProperties: StudioVideoProperties?
  }
  private struct PreparedClip { let source: SourceMedia; let range: CMTimeRange }
  private let lock = NSLock()
  private var jobs: [String: Job] = [:]

  static func videoRenderSettings(sources: [StudioVideoProperties], aspectRatio: String) -> StudioVideoRenderSettings {
    // Keep the current 1080 canvas for existing projects. UHD originals select
    // a UHD canvas even if that source appears after the first take or rotates.
    let hasUHD = sources.contains { source in
      max(source.displaySize.width, source.displaySize.height) >= 3840
        || min(source.displaySize.width, source.displaySize.height) >= 2160
    }
    let shortEdge: CGFloat = hasUHD ? 2160 : 1080
    let longEdge: CGFloat = hasUHD ? 3840 : 1920
    let size = aspectRatio == "portrait" ? CGSize(width: shortEdge, height: longEdge)
      : aspectRatio == "square" ? CGSize(width: shortEdge, height: shortEdge)
      : CGSize(width: longEdge, height: shortEdge)
    let rates = sources.map(\.frameRate).filter { $0.isFinite && $0 > 0 }
    // A mixed timeline uses its highest real cadence; never promote 24 to 30
    // or 50 to 60 just because those values exist in a camera quality menu.
    return StudioVideoRenderSettings(renderSize: size, frameRate: min(60, rates.max() ?? 30))
  }

  func cancel(_ requestId: String) {
    lock.lock()
    guard var job = jobs[requestId] else { lock.unlock(); return }
    job.cancelled = true
    jobs[requestId] = job
    let session = job.session
    lock.unlock()
    session?.cancelExport()
  }

  func cancelAll() {
    lock.lock()
    let ids = Array(jobs.keys)
    lock.unlock()
    ids.forEach(cancel)
  }

  private func beginJob(_ id: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard !id.isEmpty, jobs[id] == nil else {
      throw StudioMediaError.invalid("Esta preparação já está em andamento.")
    }
    jobs[id] = Job()
  }

  private func checkJob(_ id: String, session: AVAssetExportSession? = nil) throws {
    lock.lock(); defer { lock.unlock() }
    guard var job = jobs[id], !job.cancelled else { throw StudioMediaError.cancelled }
    if let session { job.session = session; jobs[id] = job }
  }

  private func endJob(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    jobs.removeValue(forKey: id)
  }

  private func localURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else {
      throw StudioMediaError.invalid("Escolha um arquivo salvo neste aparelho.")
    }
    return url.standardizedFileURL
  }

  private func inputURL(_ uri: String) throws -> URL {
    let url = try localURL(uri)
    var directory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &directory), !directory.boolValue else {
      throw StudioMediaError.invalid("O arquivo deste take não está mais disponível no aparelho.")
    }
    return url
  }

  private func outputURL(_ uri: String) throws -> URL {
    let url = try localURL(uri)
    guard !FileManager.default.fileExists(atPath: url.path) else {
      throw StudioMediaError.invalid("O arquivo de destino já existe. Seus originais foram preservados.")
    }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    return url
  }

  func mediaInfo(_ uri: String) async throws -> [String: Any] {
    let url = try inputURL(uri)
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration).seconds
    guard duration.isFinite, duration > 0 else {
      throw StudioMediaError.invalid("Não foi possível ler a duração deste arquivo.")
    }
    let video = try await asset.loadTracks(withMediaType: .video)
    let audio = try await asset.loadTracks(withMediaType: .audio)
    var width = 0.0
    var height = 0.0
    var frameRate = 0.0
    var colorMetadata: [String: Any] = [:]
    if let track = video.first {
      let size = try await track.load(.naturalSize)
      let transform = try await track.load(.preferredTransform)
      let rect = CGRect(origin: .zero, size: size).applying(transform)
      width = abs(rect.width).rounded()
      height = abs(rect.height).rounded()
      let rate = Double(try await track.load(.nominalFrameRate))
      frameRate = rate.isFinite && rate > 0 ? rate : 0
      if let format = try await track.load(.formatDescriptions).first {
        let extensions = CMFormatDescriptionGetExtensions(format) as? [String: Any]
        let primaries = extensions?[kCMFormatDescriptionExtension_ColorPrimaries as String] as? String
        let transfer = extensions?[kCMFormatDescriptionExtension_TransferFunction as String] as? String
        let matrix = extensions?[kCMFormatDescriptionExtension_YCbCrMatrix as String] as? String
        colorMetadata["colorPrimaries"] = primaries
        colorMetadata["transferFunction"] = transfer
        colorMetadata["yCbCrMatrix"] = matrix
        if transfer == kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG as String { colorMetadata["colorSpace"] = "rec2020-hlg" }
        else if transfer == kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ as String { colorMetadata["colorSpace"] = "rec2020-pq" }
        else if primaries == kCMFormatDescriptionColorPrimaries_ITU_R_709_2 as String,
          transfer == kCMFormatDescriptionTransferFunction_ITU_R_709_2 as String,
          matrix == kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2 as String { colorMetadata["colorSpace"] = "rec709" }
      }
    }
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    var info: [String: Any] = ["duration": duration, "width": width, "height": height, "frameRate": frameRate,
            "hasVideo": !video.isEmpty, "hasAudio": !audio.isEmpty,
            "fileSize": (attributes[.size] as? NSNumber)?.doubleValue ?? 0]
    info.merge(colorMetadata) { _, actual in actual }
    return info
  }

  func thumbnail(_ uri: String, outputUri: String, timeSeconds: Double) async throws -> [String: Any] {
    let input = try inputURL(uri)
    let output = try outputURL(outputUri)
    let asset = AVURLAsset(url: input)
    let duration = try await asset.load(.duration).seconds
    guard duration.isFinite, duration > 0, timeSeconds.isFinite else {
      throw StudioMediaError.invalid("Não foi possível preparar a capa deste take.")
    }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 960, height: 960)
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.1, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
    let at = CMTime(seconds: max(0, min(timeSeconds, duration - 0.01)), preferredTimescale: 600)
    let image = try generator.copyCGImage(at: at, actualTime: nil)
    guard let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
      throw StudioMediaError.invalid("Não foi possível salvar a capa.")
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      try? FileManager.default.removeItem(at: output)
      throw StudioMediaError.invalid("Não foi possível salvar a capa.")
    }
    return ["uri": output.absoluteString]
  }

  func export(requestId: String, clips: [StudioClip], outputUri: String,
              mediaType: String, aspectRatio: String,
              progress: @escaping (Double) -> Void) async throws -> [String: Any] {
    guard !clips.isEmpty, clips.count <= 1000, ["video", "audio"].contains(mediaType),
          ["landscape", "portrait", "square"].contains(aspectRatio) else {
      throw StudioMediaError.invalid("Adicione takes válidos para preparar a publicação.")
    }
    try beginJob(requestId)
    defer { endJob(requestId) }
    // Register before announcing preparation: a cancellation arriving from this
    // first callback must target a real job, before asset metadata or composition.
    progress(0)
    try checkJob(requestId)
    let output = try outputURL(outputUri)
    var succeeded = false
    defer { if !succeeded { try? FileManager.default.removeItem(at: output) } }
    let isVideo = mediaType == "video"
    // Inspect every distinct original before building transforms. A later 4K
    // take must not inherit an already-fixed 1080p canvas from the first one.
    var sources: [URL: SourceMedia] = [:]
    var prepared: [PreparedClip] = []
    for clip in clips {
      try checkJob(requestId)
      guard clip.startSeconds.isFinite, clip.endSeconds.isFinite,
            clip.startSeconds >= 0, clip.endSeconds - clip.startSeconds >= 0.01 else {
        throw StudioMediaError.invalid("Um take possui um corte inválido. Revise a edição.")
      }
      let input = try inputURL(clip.uri)
      guard input != output else { throw StudioMediaError.invalid("O original não pode ser substituído pela edição.") }
      let source: SourceMedia
      if let existing = sources[input] {
        source = existing
      } else {
        let asset = AVURLAsset(url: input)
        let duration = try await asset.load(.duration).seconds
        guard duration.isFinite, duration > 0 else {
          throw StudioMediaError.invalid("Não foi possível ler a duração deste arquivo.")
        }
        let video = isVideo ? try await asset.loadTracks(withMediaType: .video).first : nil
        let audio = try await asset.loadTracks(withMediaType: .audio).first
        var naturalSize = CGSize.zero
        var preferredTransform = CGAffineTransform.identity
        var properties: StudioVideoProperties?
        if isVideo {
          guard let video else { throw StudioMediaError.invalid("Este projeto precisa de takes de vídeo.") }
          naturalSize = try await video.load(.naturalSize)
          preferredTransform = try await video.load(.preferredTransform)
          let bounds = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
          guard bounds.width.isFinite, bounds.height.isFinite, abs(bounds.width) > 0, abs(bounds.height) > 0 else {
            throw StudioMediaError.invalid("Não foi possível ler o enquadramento de um take.")
          }
          properties = StudioVideoProperties(displaySize: CGSize(width: abs(bounds.width), height: abs(bounds.height)),
            frameRate: Double(try await video.load(.nominalFrameRate)))
        } else if audio == nil {
          throw StudioMediaError.invalid("Este projeto precisa de takes de áudio.")
        }
        source = SourceMedia(asset: asset, duration: duration, video: video, audio: audio,
          naturalSize: naturalSize, preferredTransform: preferredTransform, videoProperties: properties)
        sources[input] = source
      }
      try checkJob(requestId)
      guard clip.endSeconds <= source.duration + 0.05,
            min(clip.endSeconds, source.duration) - clip.startSeconds >= 0.01 - 1e-6 else {
        throw StudioMediaError.invalid("O corte ultrapassa a duração de um take.")
      }
      prepared.append(PreparedClip(source: source,
        range: CMTimeRange(start: CMTime(seconds: clip.startSeconds, preferredTimescale: 600),
          end: CMTime(seconds: min(clip.endSeconds, source.duration), preferredTimescale: 600))))
    }
    let settings = Self.videoRenderSettings(sources: sources.values.compactMap(\.videoProperties), aspectRatio: aspectRatio)
    let renderSize = settings.renderSize
    let composition = AVMutableComposition()
    let videoTrack = isVideo ? composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) : nil
    var audioTrack: AVMutableCompositionTrack?
    var cursor = CMTime.zero
    var instructions: [AVVideoCompositionInstructionProtocol] = []
    for clip in prepared {
      try checkJob(requestId)
      let range = clip.range
      if isVideo {
        guard let source = clip.source.video, let videoTrack else {
          throw StudioMediaError.invalid("Este projeto precisa de takes de vídeo.")
        }
        try videoTrack.insertTimeRange(range, of: source, at: cursor)
        let naturalSize = clip.source.naturalSize
        let preferred = clip.source.preferredTransform
        let bounds = CGRect(origin: .zero, size: naturalSize).applying(preferred)
        guard abs(bounds.width) > 0, abs(bounds.height) > 0 else {
          throw StudioMediaError.invalid("Não foi possível ler o enquadramento de um take.")
        }
        // Normalize rotation first, then fit and center. Nothing is cropped behind the notch.
        let scale = min(renderSize.width / abs(bounds.width), renderSize.height / abs(bounds.height))
        let transform = preferred
          .concatenating(CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
          .concatenating(CGAffineTransform(scaleX: scale, y: scale))
          .concatenating(CGAffineTransform(translationX: (renderSize.width - abs(bounds.width) * scale) / 2,
                                          y: (renderSize.height - abs(bounds.height) * scale) / 2))
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
        layer.setTransform(transform, at: cursor)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: cursor, duration: range.duration)
        instruction.backgroundColor = CGColor(gray: 0, alpha: 1)
        instruction.layerInstructions = [layer]
        instructions.append(instruction)
      }
      if let source = clip.source.audio {
        if audioTrack == nil { audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) }
        guard let audioTrack else { throw StudioMediaError.invalid("Não foi possível preparar o áudio.") }
        let audioRange = try await source.load(.timeRange)
        let intersection = CMTimeRangeGetIntersection(range, otherRange: audioRange)
        if intersection.duration.seconds > 0 {
          let offset = CMTimeSubtract(intersection.start, range.start)
          try audioTrack.insertTimeRange(intersection, of: source, at: CMTimeAdd(cursor, offset))
        }
      } else if !isVideo {
        throw StudioMediaError.invalid("Este projeto precisa de takes de áudio.")
      }
      cursor = CMTimeAdd(cursor, range.duration)
    }
    try checkJob(requestId)
    guard cursor.seconds > 0 else { throw StudioMediaError.invalid("A edição precisa ter algum conteúdo.") }
    // The H.264 highest-quality preset can silently cap a requested 60 fps at
    // 30. HEVC highest-quality preserves high cadence; verify the real output.
    let preset = isVideo ? (settings.frameRate > 30.1 ? AVAssetExportPresetHEVCHighestQuality : AVAssetExportPresetHighestQuality) : AVAssetExportPresetAppleM4A
    guard let session = AVAssetExportSession(asset: composition, presetName: preset) else {
      throw StudioMediaError.invalid("Este aparelho não conseguiu iniciar a preparação.")
    }
    let fileType: AVFileType = isVideo ? .mp4 : .m4a
    guard session.supportedFileTypes.contains(fileType) else {
      throw StudioMediaError.invalid("Este formato não pôde ser exportado neste aparelho.")
    }
    session.outputURL = output
    session.outputFileType = fileType
    session.shouldOptimizeForNetworkUse = true
    // Include trailing silence when the final video's audio ends before its image.
    session.timeRange = CMTimeRange(start: .zero, duration: cursor)
    if isVideo {
      let videoComposition = AVMutableVideoComposition()
      videoComposition.renderSize = renderSize
      videoComposition.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid
      videoComposition.frameDuration = settings.frameDuration
      videoComposition.instructions = instructions
      session.videoComposition = videoComposition
    }
    try checkJob(requestId, session: session)
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now(), repeating: .milliseconds(200))
    timer.setEventHandler { progress(Double(session.progress)) }
    timer.resume()
    defer { timer.cancel() }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { continuation.resume() }
    }
    try checkJob(requestId)
    guard session.status == .completed else {
      if session.status == .cancelled { throw StudioMediaError.cancelled }
      throw StudioMediaError.invalid(session.error?.localizedDescription ?? "Não foi possível preparar a edição. Tente novamente.")
    }
    var info = try await mediaInfo(output.absoluteString)
    try checkJob(requestId)
    if isVideo {
      let actualWidth = info["width"] as? Double ?? 0
      let actualHeight = info["height"] as? Double ?? 0
      let actualRate = info["frameRate"] as? Double ?? 0
      let expectedRate = 1 / settings.frameDuration.seconds
      #if STUDIO_MEDIA_TEST
      FileHandle.standardError.write(Data("Export \(requestId): \(Int(actualWidth))×\(Int(actualHeight)) @ \(actualRate); esperado \(Int(renderSize.width))×\(Int(renderSize.height)) @ \(expectedRate)\n".utf8))
      #endif
      guard abs(actualWidth - renderSize.width) < 1, abs(actualHeight - renderSize.height) < 1,
            abs(actualRate - expectedRate) < max(0.02, expectedRate * 0.01) else {
        throw StudioMediaError.invalid("Este aparelho não preservou a resolução ou os quadros do original. Seus takes foram mantidos; tente preparar novamente.")
      }
    }
    info["uri"] = output.absoluteString
    info["mimeType"] = isVideo ? "video/mp4" : "audio/mp4"
    succeeded = true
    progress(1)
    return info
  }
}
