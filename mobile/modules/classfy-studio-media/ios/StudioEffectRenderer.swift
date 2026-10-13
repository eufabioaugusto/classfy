import CoreImage
import CoreGraphics
import CoreVideo
import Foundation
import Metal
import Vision

enum StudioSourceStage: String, Codable {
  case standard, cinematicRaw, cinematicRendered
}

// Independent non-destructive editor treatments. These are deliberately not
// part of the camera grade: originals and physical camera settings stay intact.
struct StudioSceneEnhancement: Codable, Equatable {
  let version: Int
  let strength: Double
  let exposure: Double
  let contrast: Double
  let saturation: Double
  let temperature: Double
  let tint: Double
  let shadows: Double
  let highlights: Double
  let analyzedFrames: Int
  var isValid: Bool {
    version == 1 && strength.isFinite && (0...1).contains(strength)
      && exposure.isFinite && (-2...2).contains(exposure)
      && [contrast, saturation, temperature, tint, shadows, highlights].allSatisfy { $0.isFinite && (-1...1).contains($0) }
      && (1...24).contains(analyzedFrames)
  }
}
struct StudioNaturalPortrait: Codable, Equatable {
  let version: Int
  let strength: Double
  var isValid: Bool { version == 1 && strength.isFinite && (0...1).contains(strength) }
}
enum StudioEditorTreatmentError: LocalizedError {
  case unavailable
  var errorDescription: String? { "Este aparelho não conseguiu processar o tratamento. Os originais continuam preservados." }
}

/// Transient geometry for one actual image only; never stored or shared across
/// timestamps. Features use bottom-left normalized image coordinates.
struct StudioPortraitGeometry {
  let bounds: CGRect
  let protectedFeatures: [[CGPoint]]
}

struct StudioImageGrade: Codable, Equatable {
  var preset: String = "natural"
  var intensity: Double = 1
  var exposure: Double = 0
  var contrast: Double = 0
  var saturation: Double = 0
  var temperature: Double = 0
  static let identity = StudioImageGrade()

  init(preset: String = "natural", intensity: Double = 1, exposure: Double = 0,
       contrast: Double = 0, saturation: Double = 0, temperature: Double = 0) {
    self.preset = preset; self.intensity = intensity; self.exposure = exposure
    self.contrast = contrast; self.saturation = saturation; self.temperature = temperature
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    preset = try values.decodeIfPresent(String.self, forKey: .preset) ?? "natural"
    intensity = try values.decodeIfPresent(Double.self, forKey: .intensity) ?? 1
    exposure = try values.decodeIfPresent(Double.self, forKey: .exposure) ?? 0
    contrast = try values.decodeIfPresent(Double.self, forKey: .contrast) ?? 0
    saturation = try values.decodeIfPresent(Double.self, forKey: .saturation) ?? 0
    temperature = try values.decodeIfPresent(Double.self, forKey: .temperature) ?? 0
  }

  private enum CodingKeys: String, CodingKey {
    case preset, intensity, exposure, contrast, saturation, temperature
  }

  var isValid: Bool {
    ["natural", "studio", "cinematic"].contains(preset)
      && intensity.isFinite && (0...1).contains(intensity)
      && exposure.isFinite && (-2...2).contains(exposure)
      && [contrast, saturation, temperature].allSatisfy { $0.isFinite && (-1...1).contains($0) }
  }
  var isIdentity: Bool {
    intensity == 0 || (preset == "natural" && exposure == 0 && contrast == 0 && saturation == 0 && temperature == 0)
  }
}

enum StudioRemoteFrameRenderError: Error { case busy, invalid }

/// Separate serial-queue context: one remote frame is rendered at a time.
/// The capture delegate only replaces its bounded mailbox, never waits on GPU.
final class StudioRemoteFrameRenderer {
  private let renderer: StudioEffectRenderer
  private var pool: CVPixelBufferPool?
  private var size = CGSize.zero
  init(renderer: StudioEffectRenderer = StudioEffectRenderer()) { self.renderer = renderer }

  func render(_ buffer: CVPixelBuffer, grade: StudioImageGrade, width: Int, height: Int,
              sourceStage: StudioSourceStage = .standard) throws -> CVPixelBuffer {
    guard grade.isValid, width > 0, height > 0, max(width, height) <= 1920,
      min(width, height) <= 1080, sourceStage != .cinematicRaw else { throw StudioRemoteFrameRenderError.invalid }
    if size != CGSize(width: width, height: height) || pool == nil {
      pool = nil
      let attributes: [String: Any] = [kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferMetalCompatibilityKey as String: true, kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
      guard CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attributes as CFDictionary, &pool) == kCVReturnSuccess else {
        throw StudioRemoteFrameRenderError.invalid
      }
      size = CGSize(width: width, height: height)
    }
    guard let pool else { throw StudioRemoteFrameRenderError.invalid }
    var output: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool,
      [kCVPixelBufferPoolAllocationThresholdKey as String: 3] as CFDictionary, &output)
    if status == kCVReturnWouldExceedAllocationThreshold { throw StudioRemoteFrameRenderError.busy }
    guard status == kCVReturnSuccess, let output else { throw StudioRemoteFrameRenderError.invalid }
    CVBufferSetAttachment(output, kCVImageBufferCGColorSpaceKey, StudioEffectRenderer.outputColorSpace, .shouldPropagate)
    CVBufferSetAttachment(output, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(output, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(output, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
    let input = CIImage(cvPixelBuffer: buffer), treated = renderer.outputImage(input, grade: grade, sourceStage: sourceStage)
    guard treated.extent.width > 0, treated.extent.height > 0 else { throw StudioRemoteFrameRenderError.invalid }
    let scale = min(CGFloat(width) / treated.extent.width, CGFloat(height) / treated.extent.height)
    let transform = CGAffineTransform(translationX: -treated.extent.minX, y: -treated.extent.minY)
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))
      .concatenating(CGAffineTransform(translationX: (CGFloat(width) - treated.extent.width * scale) / 2,
        y: (CGFloat(height) - treated.extent.height * scale) / 2))
    let bounds = CGRect(origin: .zero, size: size)
    let image = treated.transformed(by: transform).composited(over: CIImage(color: .black).cropped(to: bounds)).cropped(to: bounds)
    let destination = CIRenderDestination(pixelBuffer: output)
    destination.colorSpace = StudioEffectRenderer.outputColorSpace
    destination.alphaMode = .none
    let task = try renderer.context.startTask(toRender: image, to: destination)
    _ = try task.waitUntilCompleted()
    return output
  }
}

// One color pipeline for capture preview, composition preview, source-frame
// inspection and export. This is a tonal grade, never synthetic camera depth.
final class StudioEffectRenderer {
  static let workingColorSpace = CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!
  static let outputColorSpace = CGColorSpace(name: CGColorSpace.itur_709)!
  let context: CIContext

  // CI evaluates in linear sRGB. Explicitly encode/decode around the shared
  // display-encoded SDR equations so web and app use the same mathematics.
  private static let enhancementKernel = CIColorKernel(source: """
    vec3 encoded(vec3 v) {
      return mix(v * 12.92, 1.055 * pow(max(v, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), v));
    }
    vec3 linearized(vec3 v) {
      return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), v));
    }
    kernel vec4 studioEnhancement(__sample pixel, float strength, float exposure,
      float contrast, float saturation, float temperature, float tint, float shadows, float highlights) {
      vec4 p = unpremultiply(pixel);
      vec3 original = encoded(p.rgb);
      vec3 e = original * pow(2.0, exposure) * vec3(1.0+temperature*0.08, 1.0+tint*0.06, 1.0-temperature*0.08);
      vec3 weights = vec3(0.2126, 0.7152, 0.0722);
      float y = dot(e, weights);
      float lift = shadows*0.14*(1.0-smoothstep(0.05,0.65,y)) + highlights*0.14*smoothstep(0.5,1.0,y);
      vec3 corrected = (e+lift-0.42)*(1.0+contrast*0.25)+0.42;
      float luma = dot(corrected, weights);
      vec3 saturated = vec3(luma)+(corrected-vec3(luma))*(1.0+saturation*0.4);
      vec3 result = clamp(mix(original,saturated,strength),0.0,1.0);
      return premultiply(vec4(linearized(result),p.a));
    }
    """)
  private static let portraitKernel = CIKernel(source: """
    vec3 encodedPortrait(vec3 v) {
      return mix(v*12.92,1.055*pow(max(v,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),v));
    }
    vec3 linearPortrait(vec3 v) {
      return mix(v/12.92,pow((v+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),v));
    }
    float luminanceAt(sampler image, vec2 point) {
      return dot(encodedPortrait(unpremultiply(sample(image,samplerTransform(image,point))).rgb),vec3(0.2126,0.7152,0.0722));
    }
    kernel vec4 studioPortrait(sampler image, sampler mask, float strength, float radius) {
      vec2 p = destCoord();
      vec4 original = unpremultiply(sample(image,samplerTransform(image,p)));
      vec3 rgb = encodedPortrait(original.rgb);
      float y = dot(rgb,vec3(0.2126,0.7152,0.0722));
      float sum=y, weights=1.0;
      float n=luminanceAt(image,p+vec2(radius,0.0)); float w=0.75*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      n=luminanceAt(image,p+vec2(-radius,0.0)); w=0.75*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      n=luminanceAt(image,p+vec2(0.0,radius)); w=0.75*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      n=luminanceAt(image,p+vec2(0.0,-radius)); w=0.75*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      n=luminanceAt(image,p+vec2(radius,radius)); w=0.5*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      n=luminanceAt(image,p+vec2(-radius,radius)); w=0.5*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      n=luminanceAt(image,p+vec2(radius,-radius)); w=0.5*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      n=luminanceAt(image,p+vec2(-radius,-radius)); w=0.5*exp(-((n-y)*(n-y))/(2.0*0.035*0.035)); sum+=n*w; weights+=w;
      float coverage=clamp(sample(mask,samplerTransform(mask,p)).r,0.0,1.0);
      float delta=clamp(sum/weights-y,-0.03,0.03)*strength*coverage*0.45;
      delta=clamp(delta,-min(min(rgb.r,rgb.g),rgb.b),1.0-max(max(rgb.r,rgb.g),rgb.b));
      return premultiply(vec4(linearPortrait(rgb+delta),original.a));
    }
    """)
  static var editorTreatmentsAvailable: Bool { enhancementKernel != nil && portraitKernel != nil }

  /// Same order as web: portrait from original landmarks, enhancement, grade.
  /// A kernel failure aborts preview/export rather than dropping an effect.
  func editorImage(_ input: CIImage, grade: StudioImageGrade = .identity,
                   enhancement: StudioSceneEnhancement? = nil, portrait: StudioNaturalPortrait? = nil,
                   sourceStage: StudioSourceStage = .standard) throws -> CIImage {
    var result = input
    if let portrait, portrait.strength > 0 {
      guard portrait.isValid, Self.editorTreatmentsAvailable else { throw StudioEditorTreatmentError.unavailable }
      result = try naturalPortrait(input, strength: portrait.strength)
    }
    if let enhancement, enhancement.strength > 0 {
      guard enhancement.isValid, let kernel = Self.enhancementKernel,
        let enhanced = kernel.apply(extent: result.extent, arguments: [result, enhancement.strength,
          enhancement.exposure, enhancement.contrast, enhancement.saturation, enhancement.temperature,
          enhancement.tint, enhancement.shadows, enhancement.highlights]) else { throw StudioEditorTreatmentError.unavailable }
      result = enhanced
    }
    return outputImage(result, grade: grade, sourceStage: sourceStage)
  }

  func portraitGeometry(in image: CIImage) -> [StudioPortraitGeometry] {
    let extent = image.extent
    guard extent.width > 0, extent.height > 0, !extent.isInfinite, !extent.isNull else { return [] }
    let scale = min(1, 256 / max(extent.width, extent.height))
    let small = image.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
      .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cg = context.createCGImage(small, from: small.extent, format: .RGBA8,
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!) else { return [] }
    let request = VNDetectFaceLandmarksRequest()
    do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request]) }
    catch { return [] }
    return (request.results ?? []).filter { $0.confidence >= 0.65 }
      .sorted { $0.boundingBox.width*$0.boundingBox.height > $1.boundingBox.width*$1.boundingBox.height }
      .prefix(1).compactMap { face in
        guard let landmarks = face.landmarks, let left = landmarks.leftEye, let right = landmarks.rightEye,
          let lips = landmarks.outerLips, let leftBrow = landmarks.leftEyebrow, let rightBrow = landmarks.rightEyebrow, left.pointCount >= 3, right.pointCount >= 3, lips.pointCount >= 3 else { return nil }
        let regions = [left, right, lips, leftBrow, rightBrow, landmarks.nose].compactMap { $0 }
        let box = face.boundingBox
        let features = regions.map { region in
          region.normalizedPoints.map { CGPoint(x: box.minX + CGFloat($0.x)*box.width, y: box.minY + CGFloat($0.y)*box.height) }
        }
        return StudioPortraitGeometry(bounds: box, protectedFeatures: features)
      }
  }

  /// Small transient skin mask. A contracted ellipse protects the silhouette;
  /// expanded eye/mouth/brow/nose polygons remain exactly untouched. Blurring
  /// happens before subtracting these exclusions, so it cannot bleed into them.
  func portraitMask(extent: CGRect, faces: [StudioPortraitGeometry]) -> CIImage? {
    guard !faces.isEmpty, extent.width > 0, extent.height > 0 else { return nil }
    let scale = min(1, 256 / max(extent.width, extent.height))
    let width = max(1, Int(ceil(extent.width*scale))), height = max(1, Int(ceil(extent.height*scale)))
    guard let canvas = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
    canvas.setFillColor(gray: 0, alpha: 1); canvas.fill(CGRect(x: 0, y: 0, width: width, height: height))
    canvas.setFillColor(gray: 1, alpha: 1)
    for face in faces {
      let b = CGRect(x: face.bounds.minX*CGFloat(width), y: face.bounds.minY*CGFloat(height),
        width: face.bounds.width*CGFloat(width), height: face.bounds.height*CGFloat(height))
      canvas.fillEllipse(in: b.insetBy(dx: b.width*0.04, dy: b.height*0.04))
    }
    guard let first = canvas.makeImage() else { return nil }
    var mask = CIImage(cgImage: first).applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 2.0])
      .cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
    guard let blurred = context.createCGImage(mask, from: mask.extent, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray()) else { return nil }
    canvas.draw(blurred, in: CGRect(x: 0, y: 0, width: width, height: height))
    canvas.setFillColor(gray: 0, alpha: 1); canvas.setStrokeColor(gray: 0, alpha: 1); canvas.setLineJoin(.round)
    for face in faces {
      canvas.setLineWidth(max(3, face.bounds.width*CGFloat(width)*0.075))
      for points in face.protectedFeatures where points.count >= 3 {
        let path = CGMutablePath(); path.move(to: CGPoint(x: points[0].x*CGFloat(width), y: points[0].y*CGFloat(height)))
        for point in points.dropFirst() { path.addLine(to: CGPoint(x: point.x*CGFloat(width), y: point.y*CGFloat(height))) }
        path.closeSubpath(); canvas.addPath(path); canvas.drawPath(using: .fillStroke)
      }
    }
    guard let final = canvas.makeImage() else { return nil }
    mask = CIImage(cgImage: final).transformed(by: CGAffineTransform(scaleX: extent.width/CGFloat(width), y: extent.height/CGFloat(height)))
      .transformed(by: CGAffineTransform(translationX: extent.minX, y: extent.minY))
    return mask.cropped(to: extent)
  }

  func naturalPortrait(_ image: CIImage, strength: Double, geometry: [StudioPortraitGeometry]? = nil) throws -> CIImage {
    let faces = geometry ?? portraitGeometry(in: image)
    guard let mask = portraitMask(extent: image.extent, faces: faces) else { return image }
    let radius = max(1, (faces.map { $0.bounds.width }.max() ?? 0)*image.extent.width*0.92*0.004)
    guard let result = Self.portraitKernel?.apply(extent: image.extent,
      roiCallback: { index, rect in index == 0 ? rect.insetBy(dx: -radius, dy: -radius) : rect },
      arguments: [image.clampedToExtent(), mask, strength, radius]) else {
      throw StudioEditorTreatmentError.unavailable
    }
    return result
  }

  init(context: CIContext? = nil) {
    if let context { self.context = context; return }
    let options: [CIContextOption: Any] = [
      .workingColorSpace: Self.workingColorSpace,
      .outputColorSpace: Self.outputColorSpace,
      .cacheIntermediates: false
    ]
    if let device = MTLCreateSystemDefaultDevice() {
      self.context = CIContext(mtlDevice: device, options: options)
    } else {
      self.context = CIContext(options: options)
    }
  }

  func outputImage(_ input: CIImage, grade: StudioImageGrade = .identity,
                   sourceStage: StudioSourceStage = .standard) -> CIImage {
    // The caller must refuse raw cinematic sources. A rendered source already
    // carries its native bokeh; the grade does not reinterpret or invent depth.
    guard grade.isValid, grade.intensity > 0, sourceStage != .cinematicRaw else { return input }
    var output = input
    if grade.exposure != 0 {
      output = output.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: grade.exposure])
    }
    if grade.temperature != 0 {
      output = output.applyingFilter("CITemperatureAndTint", parameters: [
        "inputNeutral": CIVector(x: 6500, y: 0),
        "inputTargetNeutral": CIVector(x: 6500 + grade.temperature * 900, y: 0)
      ])
    }
    // Conservative curves keep highlight information and avoid hue shifts.
    // The studio preset adds only a bounded, feathered light mask below.
    if grade.preset == "studio" {
      output = tone(output, points: [0, 0.235, 0.505, 0.765, 1])
    } else if grade.preset == "cinematic" {
      output = tone(output, points: [0.012, 0.235, 0.495, 0.745, 0.985])
    }
    let presetSaturation = grade.preset == "cinematic" ? 0.96 : 1.0
    if grade.contrast != 0 || grade.saturation != 0 || presetSaturation != 1 {
      output = output.applyingFilter("CIColorControls", parameters: [
        kCIInputContrastKey: 1 + grade.contrast * 0.25,
        kCIInputSaturationKey: max(0, presetSaturation + grade.saturation * 0.4)
      ])
    }
    if grade.preset == "studio" { output = faceIllumination(output) }
    if grade.intensity < 1 {
      output = input.applyingFilter("CIDissolveTransition", parameters: [
        kCIInputTargetImageKey: output, kCIInputTimeKey: grade.intensity
      ])
    }
    return output.cropped(to: input.extent)
  }

  func render(_ image: CIImage, to buffer: CVPixelBuffer, bounds: CGRect,
              colorSpace: CGColorSpace = StudioEffectRenderer.outputColorSpace) {
    context.render(image, to: buffer, bounds: bounds, colorSpace: colorSpace)
  }

  func render(_ image: CIImage, to texture: MTLTexture, commandBuffer: MTLCommandBuffer?,
              bounds: CGRect, colorSpace: CGColorSpace = StudioEffectRenderer.outputColorSpace) {
    context.render(image, to: texture, commandBuffer: commandBuffer, bounds: bounds, colorSpace: colorSpace)
  }

  private func tone(_ image: CIImage, points: [Double]) -> CIImage {
    image.applyingFilter("CIToneCurve", parameters: [
      "inputPoint0": CIVector(x: 0, y: points[0]),
      "inputPoint1": CIVector(x: 0.25, y: points[1]),
      "inputPoint2": CIVector(x: 0.5, y: points[2]),
      "inputPoint3": CIVector(x: 0.75, y: points[3]),
      "inputPoint4": CIVector(x: 1, y: points[4])
    ])
  }

  // A real face detector produces a broad feathered light mask. It never
  // smooths skin, changes geometry or simulates depth. Detection is bounded to
  // 256 px and five faces, and fails closed to the ordinary tonal grade.
  func faceRegions(in image: CIImage) -> [CGRect] {
    let extent = image.extent
    guard extent.width > 0, extent.height > 0, !extent.isInfinite, !extent.isNull else { return [] }
    let scale = min(1, 256 / max(extent.width, extent.height))
    let sampled = image.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
      .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cg = context.createCGImage(sampled, from: sampled.extent, format: .RGBA8, colorSpace: Self.outputColorSpace) else { return [] }
    let request = VNDetectFaceRectanglesRequest()
    do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request]) }
    catch { return [] }
    return (request.results ?? []).filter { $0.confidence >= 0.5 }
      .sorted { $0.boundingBox.width * $0.boundingBox.height > $1.boundingBox.width * $1.boundingBox.height }
      .prefix(5).map { face in
        let box = face.boundingBox
        return CGRect(x: extent.minX + box.minX * extent.width, y: extent.minY + box.minY * extent.height,
          width: box.width * extent.width, height: box.height * extent.height)
      }
  }

  func faceIllumination(_ image: CIImage, exposure: Double = 0.12) -> CIImage {
    guard exposure.isFinite, exposure > 0, exposure <= 0.3 else { return image }
    let faces = faceRegions(in: image)
    guard !faces.isEmpty else { return image }
    var mask = CIImage(color: .black).cropped(to: image.extent)
    for face in faces {
      guard let gradient = CIFilter(name: "CIRadialGradient", parameters: [
        "inputCenter": CIVector(x: face.midX, y: face.midY),
        "inputRadius0": min(face.width, face.height) * 0.3,
        "inputRadius1": max(face.width, face.height) * 0.7,
        "inputColor0": CIColor.white, "inputColor1": CIColor.black
      ])?.outputImage else { continue }
      mask = gradient.cropped(to: image.extent).applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: mask])
    }
    let lit = image.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: exposure])
    return lit.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: image, kCIInputMaskImageKey: mask]).cropped(to: image.extent)
  }
}
