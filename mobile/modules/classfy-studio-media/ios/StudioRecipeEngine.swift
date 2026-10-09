import AVFoundation
import CoreImage
import CoreText
import CoreVideo
import Foundation
import ImageIO

struct StudioRecipe: Codable {
  let version: Int
  let timebase: Int64
  let durationTicks: Int64
  let mediaType: String
  let canvas: Canvas
  let output: Output
  let assets: [Asset]
  let clips: [Clip]
  struct Canvas: Codable { let aspectRatio: String; let backgroundColor: String }
  struct Output: Codable {
    let profile: String; let width: Int; let height: Int
    let frameRateNumerator: Int; let frameRateDenominator: Int; let colorSpace: String
  }
  struct Asset: Codable {
    let id: String; let kind: String; let uri: String; let durationTicks: Int64
    let width: Double?; let height: Double?; let frameRate: Double?
    let sourceStage: StudioSourceStage?
    let sourceKind: String?
    let colorSpace: String?
  }
  struct Rect: Codable { let x: Double; let y: Double; let width: Double; let height: Double }
  struct Text: Codable, Equatable {
    let content: String; let fontFamily: String; let fontSize: Double
    let color: String; let backgroundColor: String; let alignment: String
  }
  struct Clip: Codable {
    let id: String; let kind: String; let assetId: String?
    let startTicks: Int64; let durationTicks: Int64
    let sourceStartTicks: Int64; let sourceEndTicks: Int64
    let zIndex: Int; let rect: Rect; let rotationDegrees: Double
    let fit: String; let opacity: Double; let gain: Double
    let fadeInTicks: Int64; let fadeOutTicks: Int64; let effect: String
    let text: Text?; let grade: StudioImageGrade?
    var effectiveGrade: StudioImageGrade { grade ?? StudioImageGrade(preset: effect) }
    var endTicks: Int64 { startTicks + durationTicks }
  }
  var size: CGSize { CGSize(width: output.width, height: output.height) }
  var durationSeconds: Double { Double(durationTicks) / Double(timebase) }
  func time(_ ticks: Int64) -> CMTime { CMTime(value: ticks, timescale: Int32(timebase)) }
}

enum StudioRecipeError: LocalizedError {
  case invalid(String), cancelled
  var errorDescription: String? {
    switch self {
    case .invalid(let message): return message
    case .cancelled: return "Preparação cancelada. Os originais continuam preservados."
    }
  }
}

struct StudioRecipeSource {
  let asset: AVURLAsset
  let duration: CMTime
  let video: AVAssetTrack?
  let audio: AVAssetTrack?
  let transform: CGAffineTransform
}

struct StudioRecipeLayer {
  let clip: StudioRecipe.Clip
  let trackId: CMPersistentTrackID?
  let raster: CIImage?
  let sourceTransform: CGAffineTransform
  let sourceStage: StudioSourceStage
}

/// Transient canvas geometry. Source ranges, effects and paint order remain
/// immutable, shared with preview/export's exact composition implementation.
struct StudioRecipeVisualOverride {
  let clipId: String
  let rect: StudioRecipe.Rect
  let textFontSize: Double?
  var raster: CIImage? = nil
}
struct StudioRecipeFrozenFrame {
  let prepared: StudioPreparedRecipe
  let layers: [StudioRecipeLayer]
  let frames: [String: CIImage]
  let seconds: Double
  var sourcesPreprocessed = false
  /// Build oriented, treated CI graphs once. Vision runs during graph creation,
  /// never at gesture cadence; GPU evaluation preserves export alpha/color.
  func processed() throws -> StudioRecipeFrozenFrame {
    if sourcesPreprocessed { return self }
    var pixels: [String: CIImage] = [:]
    for layer in layers {
      try Task.checkCancellation()
      guard var image = frames[layer.clip.id] ?? layer.raster else { continue }
      image = image.transformed(by: layer.sourceTransform)
      let extent = image.extent
      guard extent.width > 0, extent.height > 0, !extent.isInfinite else { continue }
      image = image.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
      image = prepared.renderer.outputImage(image, grade: layer.clip.effectiveGrade, sourceStage: layer.sourceStage)
      // Retaining the CI graph avoids an intermediate bitmap/color conversion
      // which changes antialiased alpha and clips extended grade values.
      pixels[layer.clip.id] = image
    }
    return StudioRecipeFrozenFrame(prepared: prepared, layers: layers, frames: pixels, seconds: seconds, sourcesPreprocessed: true)
  }
  func image(override: StudioRecipeVisualOverride? = nil) throws -> CIImage {
    var visual = override
    if var value = visual, let layer = layers.first(where: { $0.clip.id == value.clipId }), let text = layer.clip.text,
      value.rect.width != layer.clip.rect.width || value.rect.height != layer.clip.rect.height || value.textFontSize.map({ $0 != text.fontSize }) == true {
      let original = layer.clip
      let editedText = StudioRecipe.Text(content: text.content, fontFamily: text.fontFamily,
        fontSize: value.textFontSize ?? text.fontSize, color: text.color, backgroundColor: text.backgroundColor, alignment: text.alignment)
      let edited = StudioRecipe.Clip(id: original.id, kind: original.kind, assetId: original.assetId,
        startTicks: original.startTicks, durationTicks: original.durationTicks,
        sourceStartTicks: original.sourceStartTicks, sourceEndTicks: original.sourceEndTicks,
        zIndex: original.zIndex, rect: value.rect, rotationDegrees: original.rotationDegrees,
        fit: original.fit, opacity: original.opacity, gain: original.gain,
        fadeInTicks: original.fadeInTicks, fadeOutTicks: original.fadeOutTicks,
        effect: original.effect, text: editedText, grade: original.grade)
      value.raster = try StudioRecipeEngine.textImage(edited, canvas: prepared.recipe.size)
      if sourcesPreprocessed, let raster = value.raster { value.raster = prepared.renderer.outputImage(raster, grade: original.effectiveGrade, sourceStage: layer.sourceStage) }
      visual = value
    }
    return StudioRecipeCompositor.compose(layers: layers, frames: frames, recipe: prepared.recipe,
      seconds: seconds, renderer: prepared.renderer, visualOverride: visual, sourcesPreprocessed: sourcesPreprocessed)
  }
}

final class StudioPreparedRecipe {
  let recipe: StudioRecipe
  let composition: AVMutableComposition
  let videoComposition: AVMutableVideoComposition?
  let audioMix: AVMutableAudioMix
  let audioTrackIDs: [String: CMPersistentTrackID]
  let layers: [StudioRecipeLayer]
  let sources: [String: StudioRecipeSource]
  let renderer: StudioEffectRenderer
  var visualRevision: String? { (videoComposition?.instructions.first as? StudioRecipeInstruction)?.visualRevision }
  init(recipe: StudioRecipe, composition: AVMutableComposition, videoComposition: AVMutableVideoComposition?,
       audioMix: AVMutableAudioMix, audioTrackIDs: [String: CMPersistentTrackID], layers: [StudioRecipeLayer], sources: [String: StudioRecipeSource],
       renderer: StudioEffectRenderer) {
    self.recipe = recipe; self.composition = composition; self.videoComposition = videoComposition
    self.audioMix = audioMix; self.audioTrackIDs = audioTrackIDs; self.layers = layers; self.sources = sources; self.renderer = renderer
  }
  func playerItem() -> AVPlayerItem {
    let item = AVPlayerItem(asset: composition)
    item.videoComposition = videoComposition; item.audioMix = audioMix
    item.seekingWaitsForVideoCompositionRendering = true
    return item
  }
}

final class StudioRecipeInstruction: NSObject, AVVideoCompositionInstructionProtocol {
  let timeRange: CMTimeRange
  let enablePostProcessing = false
  let containsTweening = true
  let passthroughTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid
  let requiredSourceTrackIDs: [NSValue]?
  let layers: [StudioRecipeLayer]
  let recipe: StudioRecipe
  let visualRevision: String
  init(range: CMTimeRange, layers: [StudioRecipeLayer], recipe: StudioRecipe, visualRevision: String = UUID().uuidString) {
    timeRange = range; self.layers = layers; self.recipe = recipe
    self.visualRevision = visualRevision
    requiredSourceTrackIDs = Array(Set(layers.compactMap(\.trackId))).map { NSNumber(value: $0) }
    super.init()
  }
}

// Both AVPlayerItem and AVAssetExportSession instantiate this exact compositor.
// No UIKit/CoreAnimation overlay can diverge from the file that is exported.
final class StudioRecipeCompositor: NSObject, AVVideoCompositing {
  static let visualRevisionKey = "classfy.studio.visual-revision" as CFString
  private let queue = DispatchQueue(label: "classfy.studio.recipe.compositor", qos: .userInteractive)
  private let renderer = StudioEffectRenderer()
  private let lock = NSLock()
  private var generation = 0
  var sourcePixelBufferAttributes: [String: any Sendable]? {
    [kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA],
     kCVPixelBufferMetalCompatibilityKey as String: true]
  }
  var requiredPixelBufferAttributesForRenderContext: [String: any Sendable] {
    [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
     kCVPixelBufferMetalCompatibilityKey as String: true,
     kCVPixelBufferIOSurfacePropertiesKey as String: [String: String]()]
  }
  var supportsHDRSourceFrames: Bool { false }
  var supportsWideColorSourceFrames: Bool { true }
  // AVFoundation converts decoder buffers to the declared Rec.709 SDR canvas.
  // The BGRA buffer must then be interpreted as Rec.709, not implicitly sRGB.
  var canConformColorOfSourceFrames: Bool { false }
  func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}
  func cancelAllPendingVideoCompositionRequests() {
    lock.lock(); generation += 1; lock.unlock()
  }
  private func currentGeneration() -> Int { lock.lock(); defer { lock.unlock() }; return generation }
  func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
    let token = currentGeneration()
    queue.async {
      autoreleasepool {
        guard token == self.currentGeneration() else { request.finishCancelledRequest(); return }
        guard let instruction = request.videoCompositionInstruction as? StudioRecipeInstruction,
              let buffer = request.renderContext.newPixelBuffer() else {
          request.finish(with: StudioRecipeError.invalid("Não foi possível renderizar este quadro.")); return
        }
        var frames: [String: CIImage] = [:]
        for layer in instruction.layers where layer.trackId != nil {
          if let source = request.sourceFrame(byTrackID: layer.trackId!) {
            frames[layer.clip.id] = CIImage(cvPixelBuffer: source, options: [.colorSpace: StudioEffectRenderer.outputColorSpace])
          }
        }
        let image = Self.compose(layers: instruction.layers, frames: frames, recipe: instruction.recipe,
                                 seconds: request.compositionTime.seconds, renderer: self.renderer)
        do {
          try StudioVideoRenderGeometry.render(image, canvasSize: instruction.recipe.size,
            context: request.renderContext, buffer: buffer, renderer: self.renderer)
        } catch { request.finish(with: error); return }
        // CI writes Rec.709 RGB values. Tag the actual buffer as well as the
        // composition, otherwise an encoder may assume sRGB and convert twice.
        CVBufferSetAttachment(buffer, kCVImageBufferCGColorSpaceKey, StudioEffectRenderer.outputColorSpace, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        // An exact seek at an unchanged timestamp may still return an older
        // cached picture. The preview confirms this actual render receipt.
        CVBufferSetAttachment(buffer, Self.visualRevisionKey, instruction.visualRevision as CFString, .shouldPropagate)
        guard token == self.currentGeneration() else { request.finishCancelledRequest(); return }
        request.finish(withComposedVideoFrame: buffer)
      }
    }
  }

  static func compose(layers: [StudioRecipeLayer], frames: [String: CIImage], recipe: StudioRecipe,
                      seconds: Double, renderer: StudioEffectRenderer,
                      visualOverride: StudioRecipeVisualOverride? = nil, sourcesPreprocessed: Bool = false) -> CIImage {
    let canvas = CGRect(origin: .zero, size: recipe.size)
    var output = CIImage(color: StudioRecipeEngine.color(recipe.canvas.backgroundColor) ?? .black).cropped(to: canvas)
    for layer in layers {
      guard var image = (visualOverride?.clipId == layer.clip.id ? visualOverride?.raster : nil) ?? frames[layer.clip.id] ?? layer.raster else { continue }
      if !sourcesPreprocessed { image = image.transformed(by: layer.sourceTransform) }
      let extent = image.extent
      guard extent.width > 0, extent.height > 0, !extent.isInfinite, !extent.isNull else { continue }
      image = image.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
      if !sourcesPreprocessed { image = renderer.outputImage(image, grade: layer.clip.effectiveGrade, sourceStage: layer.sourceStage) }
      let rect = visualOverride?.clipId == layer.clip.id ? visualOverride!.rect : layer.clip.rect
      let box = CGRect(x: rect.x * canvas.width, y: (1 - rect.y - rect.height) * canvas.height,
                       width: rect.width * canvas.width, height: rect.height * canvas.height)
      let ratio = layer.clip.fit == "cover" ? max(box.width / extent.width, box.height / extent.height)
        : min(box.width / extent.width, box.height / extent.height)
      image = image.transformed(by: CGAffineTransform(scaleX: ratio, y: ratio))
        .transformed(by: CGAffineTransform(translationX: box.midX - extent.width * ratio / 2,
                                          y: box.midY - extent.height * ratio / 2))
      if layer.clip.fit == "cover" { image = image.cropped(to: box) }
      if layer.clip.rotationDegrees != 0 {
        image = image.transformed(by: CGAffineTransform(translationX: -box.midX, y: -box.midY)
          .concatenating(CGAffineTransform(rotationAngle: -layer.clip.rotationDegrees * .pi / 180))
          .concatenating(CGAffineTransform(translationX: box.midX, y: box.midY)))
      }
      var alpha = layer.clip.opacity
      let local = seconds - Double(layer.clip.startTicks) / Double(recipe.timebase)
      if layer.clip.fadeInTicks > 0 {
        alpha *= min(1, max(0, local / (Double(layer.clip.fadeInTicks) / Double(recipe.timebase))))
      }
      if layer.clip.fadeOutTicks > 0 {
        let remaining = Double(layer.clip.durationTicks) / Double(recipe.timebase) - local
        alpha *= min(1, max(0, remaining / (Double(layer.clip.fadeOutTicks) / Double(recipe.timebase))))
      }
      if alpha < 1 {
        image = image.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: alpha)])
      }
      output = image.composited(over: output).cropped(to: canvas)
    }
    return output
  }
}

final class StudioRecipeEngine {
  private struct Job { var cancelled = false; var committed = false; var session: AVAssetExportSession? }
  private let lock = NSLock()
  private var jobs: [String: Job] = [:]
  private let renderer = StudioEffectRenderer()
  static func decode(_ json: String) throws -> StudioRecipe {
    guard let data = json.data(using: .utf8), data.count <= 8_000_000 else {
      throw StudioRecipeError.invalid("A edição é grande demais para abrir neste aparelho.")
    }
    let recipe: StudioRecipe
    do { recipe = try JSONDecoder().decode(StudioRecipe.self, from: data) }
    catch { throw StudioRecipeError.invalid("Esta edição possui dados incompatíveis. Os originais foram preservados.") }
    try validate(recipe)
    return recipe
  }

  static func validate(_ recipe: StudioRecipe) throws {
    guard recipe.version == 2, recipe.timebase == 120_000,
          recipe.durationTicks > 0, recipe.durationTicks <= 120_000 * 43_200,
          ["video", "audio"].contains(recipe.mediaType), !recipe.clips.isEmpty, recipe.clips.count <= 1000,
          recipe.assets.count <= 1000 else { throw StudioRecipeError.invalid("Revise a duração e os elementos desta edição.") }
    guard recipe.output.profile == "standard" else {
      throw StudioRecipeError.invalid("Esta composição precisa do perfil 1080p, 30 fps SDR. Confirme a troca de perfil para usar camadas.")
    }
    let expected: CGSize
    switch recipe.canvas.aspectRatio {
    case "landscape": expected = CGSize(width: 1920, height: 1080)
    case "portrait": expected = CGSize(width: 1080, height: 1920)
    case "square": expected = CGSize(width: 1080, height: 1080)
    default: throw StudioRecipeError.invalid("O formato desta edição não é compatível.")
    }
    guard recipe.size == expected, recipe.output.frameRateNumerator == 30,
          recipe.output.frameRateDenominator == 1, recipe.output.colorSpace == "rec709",
          color(recipe.canvas.backgroundColor) != nil else {
      throw StudioRecipeError.invalid("Use o perfil 1080p, 30 fps SDR para esta composição.")
    }
    guard Set(recipe.assets.map(\.id)).count == recipe.assets.count,
          Set(recipe.clips.map(\.id)).count == recipe.clips.count else {
      throw StudioRecipeError.invalid("Há elementos duplicados nesta edição.")
    }
    let assets = Dictionary(uniqueKeysWithValues: recipe.assets.map { ($0.id, $0) })
    for asset in recipe.assets {
      guard !asset.id.isEmpty, ["video", "audio", "image"].contains(asset.kind), asset.durationTicks >= 0 else {
        throw StudioRecipeError.invalid("Um original possui dados incompatíveis.")
      }
    }
    var boundaries: [(Int64, Int)] = []
    for clip in recipe.clips {
      guard !clip.id.isEmpty, ["video", "audio", "image", "text", "caption"].contains(clip.kind),
            clip.startTicks >= 0, clip.durationTicks > 0,
            clip.durationTicks <= recipe.durationTicks,
            clip.startTicks <= recipe.durationTicks - clip.durationTicks,
            clip.sourceStartTicks >= 0, clip.sourceEndTicks >= clip.sourceStartTicks,
            clip.opacity.isFinite, (0...1).contains(clip.opacity), clip.gain.isFinite, (0...4).contains(clip.gain),
            clip.rotationDegrees.isFinite, abs(clip.rotationDegrees) <= 360,
            ["contain", "cover"].contains(clip.fit), clip.effectiveGrade.isValid,
            [clip.rect.x, clip.rect.y, clip.rect.width, clip.rect.height].allSatisfy(\.isFinite),
            (-2...3).contains(clip.rect.x), (-2...3).contains(clip.rect.y),
            clip.rect.width > 0, clip.rect.width <= 3, clip.rect.height > 0, clip.rect.height <= 3,
            clip.fadeInTicks >= 0, clip.fadeOutTicks >= 0,
            clip.fadeInTicks <= clip.durationTicks, clip.fadeOutTicks <= clip.durationTicks - clip.fadeInTicks else {
        throw StudioRecipeError.invalid("Revise o tempo, enquadramento ou ajustes de um elemento.")
      }
      if ["video", "audio", "image"].contains(clip.kind) {
        guard let id = clip.assetId, let asset = assets[id], asset.kind == clip.kind,
              asset.sourceStage != .cinematicRaw else {
          throw StudioRecipeError.invalid("Um original não está disponível para esta composição. Vídeos Cinematic precisam estar renderizados.")
        }
        if clip.kind != "image" {
          guard clip.sourceEndTicks - clip.sourceStartTicks == clip.durationTicks else {
            throw StudioRecipeError.invalid("A duração de um corte não corresponde ao original.")
          }
        }
      } else {
        guard let text = clip.text, !text.content.isEmpty, text.content.count <= 10_000,
              text.fontSize.isFinite, (0.005...0.5).contains(text.fontSize),
              color(text.color) != nil, color(text.backgroundColor) != nil,
              ["left", "center", "right"].contains(text.alignment) else {
          throw StudioRecipeError.invalid("Revise o texto ou a legenda desta edição.")
        }
      }
      if clip.kind == "video" { boundaries.append((clip.startTicks, 1)); boundaries.append((clip.endTicks, -1)) }
    }
    var videos = 0
    for boundary in boundaries.sorted(by: { $0.0 == $1.0 ? $0.1 < $1.1 : $0.0 < $1.0 }) {
      videos += boundary.1
      if videos > 2 { throw StudioRecipeError.invalid("Esta versão permite até dois vídeos simultâneos.") }
    }
  }

  static func color(_ value: String) -> CIColor? {
    guard value.hasPrefix("#"), [7, 9].contains(value.count), let number = UInt64(value.dropFirst(), radix: 16) else { return nil }
    let hasAlpha = value.count == 9
    let rgb = hasAlpha ? number >> 8 : number
    return CIColor(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255,
                   blue: Double(rgb & 255) / 255, alpha: hasAlpha ? Double(number & 255) / 255 : 1)
  }

  // Track transforms use video's top-left coordinate system; Core Image uses
  // bottom-left. Conjugating the transform avoids reversing camera rotation.
  static func coreImageTransform(size: CGSize, preferred: CGAffineTransform) -> CGAffineTransform {
    let bounds = CGRect(origin: .zero, size: size).applying(preferred)
    let inputFlip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: size.height)
    let outputFlip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: abs(bounds.height))
    return inputFlip.concatenating(preferred)
      .concatenating(CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
      .concatenating(outputFlip)
  }

  private static func cgColor(_ value: String) -> CGColor {
    let color = color(value)!
    return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                   components: [color.red, color.green, color.blue, color.alpha])!
  }

  private func localURL(_ uri: String, mustExist: Bool) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else { throw StudioRecipeError.invalid("Use um arquivo salvo neste aparelho.") }
    let path = url.standardizedFileURL
    var directory: ObjCBool = false
    let exists = FileManager.default.fileExists(atPath: path.path, isDirectory: &directory)
    if mustExist && (!exists || directory.boolValue) { throw StudioRecipeError.invalid("Um original não está mais disponível neste aparelho.") }
    if !mustExist && exists { throw StudioRecipeError.invalid("O arquivo de destino já existe. Os originais foram preservados.") }
    return path
  }

  func prepare(recipeJSON: String) async throws -> StudioPreparedRecipe {
    try await prepare(recipe: Self.decode(recipeJSON), check: { try Task.checkCancellation() })
  }

  // Slider/text/transform changes can update instructions on the same player
  // item. Gain/fade changes reuse the original tracks and update their mix.
  // Only timing or media bindings rebuild decoder tracks.
  func updateVisuals(_ previous: StudioPreparedRecipe, recipeJSON: String) throws -> StudioPreparedRecipe? {
    try Task.checkCancellation()
    let next = try Self.decode(recipeJSON)
    func structure(_ value: StudioRecipe) throws -> Data {
      var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
      object["clips"] = (object["clips"] as! [[String: Any]]).map { clip -> [String: Any] in
        var media = clip
        for key in ["grade", "effect", "opacity", "rect", "rotationDegrees", "fit", "zIndex", "text", "gain", "fadeInTicks", "fadeOutTicks"] { media.removeValue(forKey: key) }
        return media
      }
      return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
    guard try structure(next) == structure(previous.recipe) else { return nil }
    let original = Dictionary(uniqueKeysWithValues: previous.layers.map { ($0.clip.id, $0) })
    var layers: [StudioRecipeLayer] = []
    for clip in next.clips where clip.kind != "audio" {
      try Task.checkCancellation()
      guard let old = original[clip.id] else { return nil }
      let raster: CIImage?
      if ["text", "caption"].contains(clip.kind) {
        // Translation, rotation, opacity and grade act on the existing raster.
        // Re-layout only when glyphs/style or raster dimensions really change.
        let sameRaster = clip.text == old.clip.text && next.size == previous.recipe.size
          && Int((clip.rect.width * next.size.width).rounded()) == Int((old.clip.rect.width * next.size.width).rounded())
          && Int((clip.rect.height * next.size.height).rounded()) == Int((old.clip.rect.height * next.size.height).rounded())
        raster = sameRaster && old.raster != nil ? old.raster : try Self.textImage(clip, canvas: next.size)
      } else { raster = old.raster }
      layers.append(StudioRecipeLayer(clip: clip, trackId: old.trackId, raster: raster,
        sourceTransform: old.sourceTransform, sourceStage: old.sourceStage))
    }
    let order = Dictionary(uniqueKeysWithValues: next.clips.enumerated().map { ($0.element.id, $0.offset) })
    layers.sort { $0.clip.zIndex == $1.clip.zIndex ? order[$0.clip.id]! < order[$1.clip.id]! : $0.clip.zIndex < $1.clip.zIndex }
    try Task.checkCancellation()
    // Audio-only changes must not invalidate the visible composition at all.
    // Fades remain visual: their opacity envelope changes alongside the mix.
    let samePicture = try zip(previous.recipe.clips.filter { $0.kind != "audio" }, next.clips.filter { $0.kind != "audio" }).allSatisfy { a, b in
      var left = try JSONSerialization.jsonObject(with: JSONEncoder().encode(a)) as! [String: Any]
      var right = try JSONSerialization.jsonObject(with: JSONEncoder().encode(b)) as! [String: Any]
      left.removeValue(forKey: "gain"); right.removeValue(forKey: "gain")
      return NSDictionary(dictionary: left).isEqual(to: right)
    }
    let video = samePicture ? previous.videoComposition : next.mediaType == "video" ? Self.videoComposition(next, layers: layers,
      reusingIntervals: previous.videoComposition) : nil
    let sameMix = zip(previous.recipe.clips, next.clips).allSatisfy { a, b in
      a.gain == b.gain && a.fadeInTicks == b.fadeInTicks && a.fadeOutTicks == b.fadeOutTicks
    }
    let mix = sameMix ? previous.audioMix : Self.audioMix(next, trackIDs: previous.audioTrackIDs)
    try Task.checkCancellation()
    return StudioPreparedRecipe(recipe: next, composition: previous.composition, videoComposition: video,
      audioMix: mix, audioTrackIDs: previous.audioTrackIDs, layers: layers, sources: previous.sources, renderer: renderer)
  }

  private static func audioMix(_ recipe: StudioRecipe, trackIDs: [String: CMPersistentTrackID]) -> AVMutableAudioMix {
    let mix = AVMutableAudioMix()
    mix.inputParameters = recipe.clips.compactMap { clip in
      guard let trackID = trackIDs[clip.id] else { return nil }
      let parameters = AVMutableAudioMixInputParameters()
      parameters.trackID = trackID
      parameters.setVolume(Float(clip.gain), at: recipe.time(clip.startTicks))
      if clip.fadeInTicks > 0 {
        parameters.setVolumeRamp(fromStartVolume: 0, toEndVolume: Float(clip.gain),
          timeRange: CMTimeRange(start: recipe.time(clip.startTicks), duration: recipe.time(clip.fadeInTicks)))
      }
      if clip.fadeOutTicks > 0 {
        parameters.setVolumeRamp(fromStartVolume: Float(clip.gain), toEndVolume: 0,
          timeRange: CMTimeRange(start: recipe.time(clip.endTicks - clip.fadeOutTicks), duration: recipe.time(clip.fadeOutTicks)))
      }
      return parameters
    }
    return mix
  }

  private static func videoComposition(_ recipe: StudioRecipe, layers: [StudioRecipeLayer],
                                       reusingIntervals previous: AVMutableVideoComposition? = nil) -> AVMutableVideoComposition {
    let video = AVMutableVideoComposition()
    video.customVideoCompositorClass = StudioRecipeCompositor.self
    video.renderSize = recipe.size; video.frameDuration = CMTime(value: 1, timescale: 30)
    video.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid
    video.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    video.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    video.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    let visualRevision = UUID().uuidString
    if let previous, let intervals = previous.instructions as? [StudioRecipeInstruction], !intervals.isEmpty {
      // updateVisuals already proved media/timing structure unchanged. The old
      // active-ID sets and time ranges remain valid; avoid scanning every layer
      // for every boundary in a long captioned lesson during a transform.
      let replacements = Dictionary(uniqueKeysWithValues: layers.map { ($0.clip.id, $0) })
      let order = Dictionary(uniqueKeysWithValues: layers.enumerated().map { ($0.element.clip.id, $0.offset) })
      video.renderScale = previous.renderScale
      video.instructions = intervals.map { interval in
        let active = interval.layers.compactMap { replacements[$0.clip.id] }
          .sorted { order[$0.clip.id]! < order[$1.clip.id]! }
        return StudioRecipeInstruction(range: interval.timeRange, layers: active, recipe: recipe, visualRevision: visualRevision)
      }
      return video
    }
    let ticks = Set([Int64(0), recipe.durationTicks] + layers.flatMap { [$0.clip.startTicks, $0.clip.endTicks] }).sorted()
    var instructions: [StudioRecipeInstruction] = []
    for pair in zip(ticks, ticks.dropFirst()) where pair.1 > pair.0 {
      let active = layers.filter { $0.clip.startTicks <= pair.0 && $0.clip.endTicks > pair.0 }
      instructions.append(StudioRecipeInstruction(range: CMTimeRange(start: recipe.time(pair.0), duration: recipe.time(pair.1 - pair.0)), layers: active, recipe: recipe, visualRevision: visualRevision))
    }
    video.instructions = instructions
    return video
  }

  private func prepare(recipe: StudioRecipe, check: () throws -> Void) async throws -> StudioPreparedRecipe {
    try check()
    let used = Set(recipe.clips.compactMap(\.assetId))
    var sources: [String: StudioRecipeSource] = [:]
    var rasters: [String: CIImage] = [:]
    for asset in recipe.assets where used.contains(asset.id) {
      try check()
      let url = try localURL(asset.uri, mustExist: true)
      if asset.kind == "image" {
        guard let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]),
              image.extent.width > 0, image.extent.height > 0 else {
          throw StudioRecipeError.invalid("Não foi possível abrir uma imagem desta edição.")
        }
        rasters[asset.id] = image
      } else {
        let original = AVURLAsset(url: url)
        let duration = try await original.load(.duration)
        let video = asset.kind == "video" ? try await original.loadTracks(withMediaType: .video).first : nil
        let audio = try await original.loadTracks(withMediaType: .audio).first
        guard duration.seconds.isFinite, duration.seconds > 0, asset.kind == "video" ? video != nil : audio != nil else {
          throw StudioRecipeError.invalid("Não foi possível ler um original desta edição.")
        }
        let preferred = try await video?.load(.preferredTransform) ?? .identity
        let size = try await video?.load(.naturalSize) ?? .zero
        if video != nil {
          guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0,
                [preferred.a, preferred.b, preferred.c, preferred.d, preferred.tx, preferred.ty].allSatisfy(\.isFinite) else {
            throw StudioRecipeError.invalid("Não foi possível ler a orientação de um take.")
          }
        }
        let transform = video == nil ? CGAffineTransform.identity : Self.coreImageTransform(size: size, preferred: preferred)
        sources[asset.id] = StudioRecipeSource(asset: original, duration: duration, video: video, audio: audio, transform: transform)
      }
    }
    let composition = AVMutableComposition()
    // Keep at most two decoder lanes even for a lesson with hundreds of cuts.
    var lanes: [(AVMutableCompositionTrack, Int64)] = []
    var layers: [StudioRecipeLayer] = []
    var audioTrackIDs: [String: CMPersistentTrackID] = [:]
    let assetByID = Dictionary(uniqueKeysWithValues: recipe.assets.map { ($0.id, $0) })
    let ordered = recipe.clips.enumerated().sorted { $0.element.startTicks == $1.element.startTicks ? $0.offset < $1.offset : $0.element.startTicks < $1.element.startTicks }
    for (_, clip) in ordered {
      try check()
      var trackID: CMPersistentTrackID?
      var raster: CIImage?
      var preferred: CGAffineTransform = .identity
      let stage = clip.assetId.flatMap { assetByID[$0]?.sourceStage } ?? .standard
      if let assetID = clip.assetId, let source = sources[assetID] {
        let range = CMTimeRange(start: recipe.time(clip.sourceStartTicks), duration: recipe.time(clip.durationTicks))
        guard recipe.time(clip.sourceEndTicks).seconds <= source.duration.seconds + 0.001 else {
          throw StudioRecipeError.invalid("Um corte ultrapassa a duração do original.")
        }
        if clip.kind == "video", let video = source.video {
          let laneIndex: Int
          if let free = lanes.firstIndex(where: { $0.1 <= clip.startTicks }) { laneIndex = free }
          else {
            guard lanes.count < 2, let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
              throw StudioRecipeError.invalid("Não foi possível preparar as camadas de vídeo.")
            }
            lanes.append((track, 0)); laneIndex = lanes.count - 1
          }
          try lanes[laneIndex].0.insertTimeRange(range, of: video, at: recipe.time(clip.startTicks))
          lanes[laneIndex].1 = clip.endTicks
          trackID = lanes[laneIndex].0.trackID; preferred = source.transform
        }
        if let audio = source.audio {
          guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw StudioRecipeError.invalid("Não foi possível preparar o áudio.")
          }
          let originalRange = try await audio.load(.timeRange)
          let intersection = CMTimeRangeGetIntersection(range, otherRange: originalRange)
          if intersection.duration.seconds > 0 {
            let offset = CMTimeSubtract(intersection.start, range.start)
            try track.insertTimeRange(intersection, of: audio, at: CMTimeAdd(recipe.time(clip.startTicks), offset))
          }
          audioTrackIDs[clip.id] = track.trackID
        }
      } else if clip.kind == "image" {
        raster = clip.assetId.flatMap { rasters[$0] }
      } else if clip.kind == "text" || clip.kind == "caption" {
        raster = try Self.textImage(clip, canvas: recipe.size)
      }
      if clip.kind != "audio" {
        layers.append(StudioRecipeLayer(clip: clip, trackId: trackID, raster: raster,
                                       sourceTransform: preferred, sourceStage: stage))
      }
    }
    // Background/image-only and trailing-silence projects need an explicit clock.
    if composition.duration < recipe.time(recipe.durationTicks) {
      composition.insertEmptyTimeRange(CMTimeRange(start: composition.duration,
        duration: CMTimeSubtract(recipe.time(recipe.durationTicks), composition.duration)))
    }
    let stableOrder = Dictionary(uniqueKeysWithValues: recipe.clips.enumerated().map { ($0.element.id, $0.offset) })
    layers.sort { $0.clip.zIndex == $1.clip.zIndex ? stableOrder[$0.clip.id]! < stableOrder[$1.clip.id]! : $0.clip.zIndex < $1.clip.zIndex }
    let audioMix = Self.audioMix(recipe, trackIDs: audioTrackIDs)
    var videoComposition: AVMutableVideoComposition?
    if recipe.mediaType == "video" {
      videoComposition = Self.videoComposition(recipe, layers: layers)
    }
    try check()
    return StudioPreparedRecipe(recipe: recipe, composition: composition, videoComposition: videoComposition,
      audioMix: audioMix, audioTrackIDs: audioTrackIDs, layers: layers, sources: sources, renderer: renderer)
  }

  // CoreText is rasterized once per element, shared unchanged between player and export.
  static func textImage(_ clip: StudioRecipe.Clip, canvas: CGSize) throws -> CIImage {
    guard let text = clip.text else { throw StudioRecipeError.invalid("O texto deste elemento está vazio.") }
    let width = max(1, Int((clip.rect.width * canvas.width).rounded()))
    let height = max(1, Int((clip.rect.height * canvas.height).rounded()))
    guard width <= 6000, height <= 6000,
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      throw StudioRecipeError.invalid("O texto é grande demais para renderizar.")
    }
    context.setFillColor(cgColor(text.backgroundColor)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let font = CTFontCreateWithName((text.fontFamily.lowercased() == "system" ? "Helvetica" : text.fontFamily) as CFString,
                                  text.fontSize * canvas.height, nil)
    var alignment: CTTextAlignment = text.alignment == "left" ? .left : text.alignment == "right" ? .right : .center
    let paragraph = withUnsafePointer(to: &alignment) { pointer -> CTParagraphStyle in
      var setting = CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: pointer)
      return CTParagraphStyleCreate(&setting, 1)
    }
    let attributed = NSAttributedString(string: text.content, attributes: [
      NSAttributedString.Key(kCTFontAttributeName as String): font,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): cgColor(text.color),
      NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraph
    ])
    let framesetter = CTFramesetterCreateWithAttributedString(attributed)
    let inset = min(8, CGFloat(width) / 8, CGFloat(height) / 8)
    let box = CGRect(x: inset, y: inset, width: CGFloat(width) - inset * 2, height: CGFloat(height) - inset * 2)
    let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), CGPath(rect: box, transform: nil), nil)
    context.textMatrix = .identity; CTFrameDraw(frame, context)
    guard let image = context.makeImage() else { throw StudioRecipeError.invalid("Não foi possível renderizar o texto.") }
    return CIImage(cgImage: image)
  }

  func frame(_ prepared: StudioPreparedRecipe, at seconds: Double,
             sourceOverride: (clipId: String, seconds: Double)? = nil) async throws -> CGImage {
    let frozen = try await frozenFrame(prepared, at: seconds, sourceOverride: sourceOverride)
    let image = try frozen.image()
    guard let cg = prepared.renderer.context.createCGImage(image, from: CGRect(origin: .zero, size: prepared.recipe.size),
      format: .RGBA8, colorSpace: StudioEffectRenderer.outputColorSpace) else {
      throw StudioRecipeError.invalid("Não foi possível visualizar este quadro.")
    }
    return cg
  }

  /// Decode the visible sources once; a drag only changes the CI geometry.
  /// The recipe validator bounds simultaneous video decoders to two.
  func frozenFrame(_ prepared: StudioPreparedRecipe, at seconds: Double,
                   sourceOverride: (clipId: String, seconds: Double)? = nil) async throws -> StudioRecipeFrozenFrame {
    guard seconds.isFinite, seconds >= 0, seconds < prepared.recipe.durationSeconds else {
      throw StudioRecipeError.invalid("Escolha um tempo válido da edição.")
    }
    try Task.checkCancellation()
    let ticks = Int64((seconds * Double(prepared.recipe.timebase)).rounded(.down))
    let overrideLayer = prepared.layers.first { $0.clip.id == sourceOverride?.clipId }
    let layers = prepared.layers.filter {
      if overrideLayer?.clip.zIndex == 0 && $0.clip.kind == "video" && $0.clip.zIndex == 0 && $0.clip.id != sourceOverride?.clipId { return false }
      return ($0.clip.startTicks <= ticks && $0.clip.endTicks > ticks) || $0.clip.id == sourceOverride?.clipId
    }
    var frames: [String: CIImage] = [:]
    for layer in layers where layer.clip.kind == "video" {
      guard let assetId = layer.clip.assetId, let source = prepared.sources[assetId] else { continue }
      let sourceSeconds: Double
      if layer.clip.id == sourceOverride?.clipId, let override = sourceOverride {
        guard override.seconds.isFinite, override.seconds >= 0, override.seconds < source.duration.seconds else {
          throw StudioRecipeError.invalid("Escolha um quadro válido do original.")
        }
        sourceSeconds = override.seconds
      } else {
        sourceSeconds = Double(layer.clip.sourceStartTicks) / Double(prepared.recipe.timebase)
          + seconds - Double(layer.clip.startTicks) / Double(prepared.recipe.timebase)
      }
      // Keep inspection in CVPixelBuffer rather than round-tripping through a
      // CGImage whose implicit decode color conversion differs for imports.
      if let videoTrack = source.video {
        let decoding = AVMutableVideoComposition()
        decoding.renderSize = try await videoTrack.load(.naturalSize)
        decoding.frameDuration = CMTime(value: 1, timescale: 30)
        decoding.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        decoding.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        decoding.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        decoding.customVideoCompositorClass = StudioRecipeCompositor.self
        let sourceTicks = Int64((source.duration.seconds * 120_000).rounded(.down))
        let sourceClip = StudioRecipe.Clip(id: layer.clip.id, kind: "video", assetId: assetId, startTicks: 0,
          durationTicks: sourceTicks, sourceStartTicks: 0, sourceEndTicks: sourceTicks, zIndex: 0,
          rect: StudioRecipe.Rect(x: 0, y: 0, width: 1, height: 1), rotationDegrees: 0, fit: "contain",
          opacity: 1, gain: 0, fadeInTicks: 0, fadeOutTicks: 0, effect: "natural", text: nil, grade: nil)
        let size = decoding.renderSize
        let rawRecipe = StudioRecipe(version: 2, timebase: 120_000, durationTicks: sourceTicks, mediaType: "video",
          canvas: StudioRecipe.Canvas(aspectRatio: "landscape", backgroundColor: "#000000"),
          output: StudioRecipe.Output(profile: "standard", width: Int(size.width), height: Int(size.height),
            frameRateNumerator: 30, frameRateDenominator: 1, colorSpace: "rec709"), assets: [], clips: [sourceClip])
        let rawLayer = StudioRecipeLayer(clip: sourceClip, trackId: videoTrack.trackID, raster: nil,
          sourceTransform: .identity, sourceStage: .standard)
        decoding.instructions = [StudioRecipeInstruction(range: CMTimeRange(start: .zero, duration: source.duration),
          layers: [rawLayer], recipe: rawRecipe)]
        let reader = try AVAssetReader(asset: source.asset)
        reader.timeRange = CMTimeRange(start: CMTime(seconds: sourceSeconds, preferredTimescale: 120_000),
          duration: CMTime(seconds: min(1 / 30.0, source.duration.seconds - sourceSeconds), preferredTimescale: 120_000))
        let output = AVAssetReaderVideoCompositionOutput(videoTracks: [videoTrack], videoSettings: [
          kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
          kCVPixelBufferMetalCompatibilityKey as String: true
        ])
        output.videoComposition = decoding; output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw StudioRecipeError.invalid("Não foi possível inspecionar este original.") }
        reader.add(output)
        guard reader.startReading() else { throw reader.error ?? StudioRecipeError.invalid("Não foi possível ler este quadro.") }
        defer { reader.cancelReading() }
        guard let sample = output.copyNextSampleBuffer(), let buffer = CMSampleBufferGetImageBuffer(sample) else {
          throw reader.error ?? StudioRecipeError.invalid("Não foi possível visualizar este quadro do original.")
        }
        frames[layer.clip.id] = CIImage(cvPixelBuffer: buffer, options: [.colorSpace: StudioEffectRenderer.outputColorSpace])
      }
      try Task.checkCancellation()
    }
    return StudioRecipeFrozenFrame(prepared: prepared, layers: layers, frames: frames, seconds: seconds)
  }

  func cancel(_ requestId: String) {
    lock.lock()
    guard var job = jobs[requestId], !job.committed else { lock.unlock(); return }
    job.cancelled = true; jobs[requestId] = job
    let session = job.session; lock.unlock(); session?.cancelExport()
  }
  func cancelAll() { lock.lock(); let ids = Array(jobs.keys); lock.unlock(); ids.forEach(cancel) }
  private func beginJob(_ requestId: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard !requestId.isEmpty, jobs[requestId] == nil else { throw StudioRecipeError.invalid("Esta preparação já está em andamento.") }
    jobs[requestId] = Job()
  }
  private func endJob(_ requestId: String) { lock.lock(); defer { lock.unlock() }; jobs.removeValue(forKey: requestId) }
  private func checkJob(_ id: String, session: AVAssetExportSession? = nil) throws {
    try Task.checkCancellation()
    lock.lock(); defer { lock.unlock() }
    guard var job = jobs[id], !job.cancelled else { throw StudioRecipeError.cancelled }
    if let session { job.session = session; jobs[id] = job }
  }
  private func commitOutput(_ id: String, staging: URL, destination: URL) throws {
    lock.lock(); defer { lock.unlock() }
    try Task.checkCancellation()
    guard var job = jobs[id], !job.cancelled else { throw StudioRecipeError.cancelled }
    // A same-directory move has no suspension point. Cancel and commit share
    // this reservation: a cancel before it wins; after a successful move the
    // file is durable and cancellation must not undo a completed export.
    try FileManager.default.moveItem(at: staging, to: destination)
    job.committed = true; jobs[id] = job
  }

  func export(requestId: String, recipeJSON: String, outputUri: String,
              progress: @escaping (Double) -> Void) async throws -> [String: Any] {
    try beginJob(requestId)
    defer { endJob(requestId) }
    progress(0); try checkJob(requestId)
    let output = try localURL(outputUri, mustExist: false)
    let recipe = try Self.decode(recipeJSON)
    guard !recipe.assets.contains(where: { URL(string: $0.uri)?.standardizedFileURL == output }) else {
      throw StudioRecipeError.invalid("A edição não pode substituir um original.")
    }
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    // Only this request owns the temporary path. Another writer may create
    // the requested destination while encoding; neither cleanup nor success
    // may remove/overwrite that file. Publish once through a non-replacing move.
    let staging = output.deletingLastPathComponent().appendingPathComponent(
      ".classfy-export-\(UUID().uuidString).\(recipe.mediaType == "audio" ? "m4a" : "mp4")")
    defer { try? FileManager.default.removeItem(at: staging) }
    let prepared = try await prepare(recipe: recipe, check: { try self.checkJob(requestId) })
    let audioOnly = recipe.mediaType == "audio"
    guard let session = AVAssetExportSession(asset: prepared.composition,
      presetName: audioOnly ? AVAssetExportPresetAppleM4A : AVAssetExportPresetHighestQuality) else {
      throw StudioRecipeError.invalid("Este aparelho não conseguiu iniciar a preparação.")
    }
    let fileType: AVFileType = audioOnly ? .m4a : .mp4
    guard session.supportedFileTypes.contains(fileType) else { throw StudioRecipeError.invalid("Este aparelho não suporta o formato de exportação.") }
    session.outputURL = staging; session.outputFileType = fileType; session.shouldOptimizeForNetworkUse = true
    session.videoComposition = prepared.videoComposition; session.audioMix = prepared.audioMix
    session.timeRange = CMTimeRange(start: .zero, duration: recipe.time(recipe.durationTicks))
    try checkJob(requestId, session: session)
    let progressQueue = DispatchQueue(label: "Classfy.StudioExportProgress.\(UUID().uuidString)", qos: .utility)
    let timer = DispatchSource.makeTimerSource(queue: progressQueue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(200))
    timer.setEventHandler {
      let value = Double(session.progress)
      // AVFoundation reaching 1 still precedes profile validation and commit.
      // Report completion only once the destination is a confirmed file.
      if value >= 0 && value < 1 { progress(value) }
    }; timer.resume()
    defer { timer.cancel() }
    await withTaskCancellationHandler(operation: {
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        session.exportAsynchronously { continuation.resume() }
      }
    }, onCancel: { self.cancel(requestId) })
    try checkJob(requestId)
    guard session.status == .completed else {
      if session.status == .cancelled { throw StudioRecipeError.cancelled }
      throw StudioRecipeError.invalid(session.error?.localizedDescription ?? "Não foi possível preparar esta composição.")
    }
    let asset = AVURLAsset(url: staging)
    let duration = try await asset.load(.duration).seconds
    let video = try await asset.loadTracks(withMediaType: .video).first
    let audio = try await asset.loadTracks(withMediaType: .audio).first
    var width = 0.0, height = 0.0, rate = 0.0
    if let video {
      let size = try await video.load(.naturalSize)
      width = size.width; height = size.height; rate = Double(try await video.load(.nominalFrameRate))
    }
    guard abs(duration - recipe.durationSeconds) <= 1 / 30.0 + 0.01,
          audioOnly || (width == Double(recipe.output.width) && height == Double(recipe.output.height) && abs(rate - 30) < 0.02) else {
      throw StudioRecipeError.invalid("A exportação não preservou o perfil da edição. Os originais foram mantidos.")
    }
    try checkJob(requestId)
    let attributes = try FileManager.default.attributesOfItem(atPath: staging.path)
    try commitOutput(requestId, staging: staging, destination: output)
    timer.cancel()
    progressQueue.sync { progress(1) }
    return ["uri": output.absoluteString, "mimeType": audioOnly ? "audio/mp4" : "video/mp4", "duration": duration,
            "width": width, "height": height, "frameRate": rate, "hasVideo": video != nil, "hasAudio": audio != nil,
            "fileSize": (attributes[.size] as? NSNumber)?.doubleValue ?? 0, "profile": "standard", "colorSpace": "rec709"]
  }
}
