import CoreImage
import CoreText
import Foundation
import CryptoKit

/// Optional recipe-v2 fields. Both the interactive frame and AVFoundation's
/// player/export compositor evaluate this same local clock and geometry.
enum StudioRecipeVisualEffects {
  static let decorations = ["none", "outline", "outline-inverse", "background", "background-inverse"]
  static let textEffects = ["none", "shadow-soft", "shadow-strong", "block", "neon", "glow", "halo"]
  static let animations = ["none", "typewriter", "pop", "bounce", "fade", "zoom", "slide-right"]
  static let motions = ["none", "fade-in", "fade-out", "zoom-in", "pulse", "blink"]
  static func valid(_ clip: StudioRecipe.Clip) -> Bool {
    let maximum = Int64(120_000 * 43_200)
    guard motions.contains(clip.motion ?? "none"),
      clip.animationOffsetTicks.map({ (0...maximum).contains($0) }) ?? true,
      clip.motionOffsetTicks.map({ (0...maximum).contains($0) }) ?? true,
      clip.motionDurationTicks.map({ (1...maximum).contains($0) }) ?? true else { return false }
    guard let text = clip.text else { return true }
    return decorations.contains(text.decoration ?? "none") && textEffects.contains(text.visualEffect ?? "none")
      && animations.contains(text.animation ?? "none")
      && (text.secondaryColor.map({ StudioRecipeEngine.color($0) != nil }) ?? true)
      && (text.animationDurationTicks.map({ (1...maximum).contains($0) }) ?? true)
      && (text.gradientColors.map({ $0.count == 2 && $0.allSatisfy { StudioRecipeEngine.color($0) != nil } }) ?? true)
  }
  static func localTicks(_ clip: StudioRecipe.Clip, seconds: Double, timebase: Int64) -> Double {
    max(0, seconds * Double(timebase) - Double(clip.startTicks))
  }
  static func introProgress(_ clip: StudioRecipe.Clip, seconds: Double, timebase: Int64) -> Double {
    let duration = clip.text?.animationDurationTicks ?? min(48_000, clip.durationTicks)
    return min(1, max(0, (localTicks(clip, seconds: seconds, timebase: timebase)
      + Double(clip.animationOffsetTicks ?? 0)) / Double(max(1, duration))))
  }
  static func visibleCharacters(_ clip: StudioRecipe.Clip, seconds: Double, timebase: Int64) -> Int? {
    guard let text = clip.text, text.animation == "typewriter" else { return nil }
    return min(text.content.count, Int((Double(text.content.count) * introProgress(clip, seconds: seconds, timebase: timebase)).rounded(.down)))
  }
  struct Pose { var scale = 1.0; var x = 0.0; var y = 0.0; var alpha = 1.0 }
  static func pose(_ clip: StudioRecipe.Clip, seconds: Double, timebase: Int64) -> Pose {
    var result = Pose()
    let p = introProgress(clip, seconds: seconds, timebase: timebase)
    let ease = 1 - pow(1 - p, 3)
    switch clip.text?.animation ?? "none" {
    case "pop":
      let q = p - 1
      result.scale = 0.45 + 0.55 * (1 + 2.70158 * q * q * q + 1.70158 * q * q)
      result.alpha = min(1, p * 5)
    case "bounce":
      result.scale = p >= 1 ? 1 : max(0.05, 1 - 0.45 * exp(-6 * p) * cos(3 * .pi * p))
      result.y = p >= 1 ? 0 : 0.12 * exp(-6 * p) * sin(3 * .pi * p)
      result.alpha = min(1, p * 5)
    case "fade": result.alpha = p
    case "zoom": result.scale = 0.6 + 0.4 * ease; result.alpha = min(1, p * 4)
    case "slide-right": result.x = -0.85 * (1 - ease); result.alpha = min(1, p * 4)
    default: break
    }
    let ticks = localTicks(clip, seconds: seconds, timebase: timebase) + Double(clip.motionOffsetTicks ?? 0)
    let span = Double(clip.motionDurationTicks ?? clip.durationTicks)
    let local = ticks / Double(timebase), progress = min(1, max(0, ticks / max(1, span)))
    let intro = min(48_000, max(1, span))
    switch clip.motion ?? "none" {
    case "fade-in": result.alpha *= min(1, max(0, ticks / intro))
    case "fade-out": result.alpha *= min(1, max(0, (span - ticks) / intro))
    case "zoom-in": result.scale *= 1 + 0.12 * progress
    case "pulse": result.scale *= 1 + 0.035 * sin(local * 2 * .pi)
    case "blink": result.alpha *= cos(local * 4 * .pi) >= 0 ? 1 : 0.15
    default: break
    }
    return result
  }
}

/// Text runs use the full layout even while revealing graphemes, so a
/// typewriter never recenters or rewraps already visible letters. No UIKit.
enum StudioTextRenderer {
  private static func color(_ value: String) -> CGColor {
    let rgba = StudioRecipeEngine.color(value)!
    return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [rgba.red, rgba.green, rgba.blue, rgba.alpha])!
  }
  private static func context(_ width: Int, _ height: Int) throws -> CGContext {
    guard let value = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      throw StudioRecipeError.invalid("O texto é grande demais para renderizar.")
    }
    return value
  }
  private static func image(_ context: CGContext) throws -> CIImage {
    guard let value = context.makeImage() else { throw StudioRecipeError.invalid("Não foi possível renderizar o texto.") }
    return CIImage(cgImage: value)
  }
  static func image(_ clip: StudioRecipe.Clip, canvas: CGSize, visibleCharacters: Int? = nil) throws -> CIImage {
    guard let text = clip.text else { throw StudioRecipeError.invalid("O texto deste elemento está vazio.") }
    let rawWidth = max(1, clip.rect.width * canvas.width), rawHeight = max(1, clip.rect.height * canvas.height)
    let rasterScale = min(1, 6000 / max(rawWidth, rawHeight), sqrt(16_777_216 / (rawWidth * rawHeight)))
    let width = max(1, Int((rawWidth * rasterScale).rounded(.down)))
    let height = max(1, Int((rawHeight * rasterScale).rounded(.down)))
    let bounds = CGRect(x: 0, y: 0, width: width, height: height)
    let pointSize = text.fontSize * canvas.height * rasterScale
    let scale = min(canvas.width, canvas.height) / 1080 * rasterScale
    let inset = min(8 * scale, CGFloat(width) / 8, CGFloat(height) / 8)
    let box = bounds.insetBy(dx: inset, dy: inset)
    // CTFont resolves absent PostScript/family names through its system
    // fallback; the exact resolved font is used by preview and export.
    let font = CTFontCreateWithName((text.fontFamily.lowercased() == "system" ? "Helvetica" : text.fontFamily) as CFString, pointSize, nil)
    var alignment: CTTextAlignment = text.alignment == "left" ? .left : text.alignment == "right" ? .right : .center
    let paragraph = withUnsafePointer(to: &alignment) { pointer -> CTParagraphStyle in
      var setting = CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: pointer)
      return CTParagraphStyleCreate(&setting, 1)
    }
    let inverse = ["outline-inverse", "background-inverse"].contains(text.decoration ?? "none")
    let secondary = text.secondaryColor ?? "#000000"
    let fillColor = inverse ? secondary : text.color
    let detailColor = inverse ? text.color : secondary
    let outline = ["outline", "outline-inverse"].contains(text.decoration ?? "none")
    let plate = ["background", "background-inverse"].contains(text.decoration ?? "none")
    let fullLength = (text.content as NSString).length
    let prefix = visibleCharacters.map { (String(text.content.prefix(max(0, $0))) as NSString).length } ?? fullLength
    func glyphs(fill: String, stroke: String? = nil) throws -> CIImage {
      let raster = try context(width, height)
      var attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(fill),
        NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraph,
      ]
      if let stroke {
        attributes[NSAttributedString.Key(kCTStrokeColorAttributeName as String)] = color(stroke)
        attributes[NSAttributedString.Key(kCTStrokeWidthAttributeName as String)] = 3.5
      }
      let attributed = NSMutableAttributedString(string: text.content, attributes: attributes)
      if prefix < fullLength {
        let range = NSRange(location: prefix, length: fullLength - prefix)
        attributed.addAttribute(NSAttributedString.Key(kCTForegroundColorAttributeName as String), value: color("#00000000"), range: range)
        attributed.addAttribute(NSAttributedString.Key(kCTStrokeColorAttributeName as String), value: color("#00000000"), range: range)
      }
      let setter = CTFramesetterCreateWithAttributedString(attributed)
      let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: box, transform: nil), nil)
      raster.textMatrix = .identity; CTFrameDraw(frame, raster)
      return try image(raster)
    }
    var glyph = try glyphs(fill: fillColor)
    if let colors = text.gradientColors {
      let mask = try glyphs(fill: "#FFFFFF")
      let gradient = CIFilter(name: "CILinearGradient", parameters: ["inputPoint0": CIVector(x: bounds.midX, y: bounds.maxY),
        "inputPoint1": CIVector(x: bounds.midX, y: bounds.minY), "inputColor0": StudioRecipeEngine.color(colors[0])!,
        "inputColor1": StudioRecipeEngine.color(colors[1])!])!.outputImage!.cropped(to: bounds)
      glyph = gradient.applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: mask]).cropped(to: bounds)
    }
    let base = try context(width, height)
    base.setFillColor(color(plate ? detailColor : text.backgroundColor))
    if plate {
      base.addPath(CGPath(roundedRect: bounds, cornerWidth: min(12 * scale, bounds.width / 4), cornerHeight: min(12 * scale, bounds.height / 4), transform: nil)); base.fillPath()
    } else { base.fill(bounds) }
    var result = try image(base)
    let alphaMask = try glyphs(fill: "#FFFFFF")
    func tinted(_ rgba: String) -> CIImage {
      CIImage(color: StudioRecipeEngine.color(rgba)!).cropped(to: bounds)
        .applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: alphaMask]).cropped(to: bounds)
    }
    let effect = text.visualEffect ?? "none"
    if effect != "none" {
      let tint = tinted(["neon", "glow"].contains(effect) ? text.color : secondary)
      switch effect {
      case "block":
        for step in (1...5).reversed() {
          let offset = CGFloat(step) * max(scale, pointSize * 0.013)
          result = tint.transformed(by: CGAffineTransform(translationX: offset, y: -offset)).composited(over: result)
        }
      case "neon":
        result = tint.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: pointSize * 0.15]).composited(over: result)
        result = tint.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: pointSize * 0.055]).composited(over: result)
      case "glow": result = tint.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: pointSize * 0.16]).composited(over: result)
      case "halo":
        result = tint.applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: max(1, pointSize * 0.055)])
          .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: pointSize * 0.035]).composited(over: result)
      default:
        let strong = effect == "shadow-strong"
        result = tint.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: pointSize * (strong ? 0.035 : 0.09)])
          .transformed(by: CGAffineTransform(translationX: (strong ? 4 : 2) * scale, y: -(strong ? 4 : 2) * scale)).composited(over: result)
      }
    }
    if outline { result = try glyphs(fill: "#00000000", stroke: detailColor).composited(over: result) }
    return glyph.composited(over: result).cropped(to: bounds)
  }
}

/// One bounded process-local LRU shared by all animated captions. Rendering
/// happens on demand, with no ahead work or retention proportional to duration.
final class StudioTextRasterCache {
  private struct Entry { let image: CIImage; let bytes: Int; var access: UInt64 }
  private static let lock = NSLock()
  private static var entries: [String: Entry] = [:]
  private static var bytes = 0
  private static var access: UInt64 = 0
  private static let maximumBytes = 32 * 1024 * 1024
  private static let maximumEntries = 32
  private let clip: StudioRecipe.Clip
  private let canvas: CGSize
  private let full: CIImage
  private let signature: String
  init(clip: StudioRecipe.Clip, canvas: CGSize, full: CIImage) {
    self.clip = clip; self.canvas = canvas; self.full = full
    var style = clip; style.rect = StudioRecipe.Rect(x: 0, y: 0, width: clip.rect.width, height: clip.rect.height)
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    // Temporal fields and grade are irrelevant to the glyph raster. The
    // current clip determines reveal progress when old raster cache is reused.
    let data = (try? encoder.encode(style.text)) ?? Data()
    signature = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      + ":\(style.rect.width):\(style.rect.height):\(canvas.width):\(canvas.height)"
  }
  func image(at seconds: Double, timebase: Int64, clip current: StudioRecipe.Clip? = nil) throws -> CIImage {
    let target = current ?? clip
    guard let count = StudioRecipeVisualEffects.visibleCharacters(target, seconds: seconds, timebase: timebase),
      count < (target.text?.content.count ?? 0) else { return full }
    let key = signature + ":\(count)"
    Self.lock.lock(); Self.access &+= 1
    if var cached = Self.entries[key] {
      cached.access = Self.access; Self.entries[key] = cached; Self.lock.unlock(); return cached.image
    }
    Self.lock.unlock()
    try Task.checkCancellation()
    let image = try StudioTextRenderer.image(clip, canvas: canvas, visibleCharacters: count)
    // A styled CI graph can retain glyph, plate, gradient-mask and stroke
    // rasters. Charge six RGBA rasters rather than only its final extent.
    let cost = Int(image.extent.width) * Int(image.extent.height) * 4 * 6
    if cost <= Self.maximumBytes {
      Self.lock.lock(); defer { Self.lock.unlock() }
      if Self.entries[key] == nil {
        while Self.entries.count >= Self.maximumEntries || Self.bytes + cost > Self.maximumBytes {
          guard let oldest = Self.entries.min(by: { $0.value.access < $1.value.access }) else { break }
          Self.bytes -= oldest.value.bytes; Self.entries.removeValue(forKey: oldest.key)
        }
        Self.access &+= 1; Self.entries[key] = Entry(image: image, bytes: cost, access: Self.access); Self.bytes += cost
      }
    }
    return image
  }
  static func cacheUsage() -> (count: Int, bytes: Int) {
    lock.lock(); defer { lock.unlock() }; return (entries.count, bytes)
  }
}
