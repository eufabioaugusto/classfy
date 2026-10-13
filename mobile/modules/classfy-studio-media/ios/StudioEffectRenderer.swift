import CoreImage
import CoreGraphics
import CoreVideo
import Foundation
import Metal
import Vision

enum StudioSourceStage: String, Codable {
  case standard, cinematicRaw, cinematicRendered
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
