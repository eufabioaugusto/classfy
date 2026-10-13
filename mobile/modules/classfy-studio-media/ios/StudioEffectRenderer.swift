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
  var isValid: Bool { [1,2].contains(version) && strength.isFinite && (0...1).contains(strength) }
}
struct StudioCinematicSignature: Codable, Equatable {
  let version: Int
  let strength: Double
  let subjectExposure: Double
  let backgroundExposure: Double
  let backgroundBlur: Double
  let temperature: Double
  var isValid: Bool {
    version == 1 && strength.isFinite && (0...1).contains(strength)
      && subjectExposure.isFinite && (-0.5...1).contains(subjectExposure)
      && backgroundExposure.isFinite && (-2...0).contains(backgroundExposure)
      && backgroundBlur.isFinite && (0...1).contains(backgroundBlur)
      && temperature.isFinite && (-1...1).contains(temperature)
  }
}
struct StudioSignatureMasks {
  let person: CIImage
  let face: CIImage
  let faceBounds: CGRect?
}
/// Stateless cleanup of the reduced Vision matte. The face is normalized,
/// top-down like the pixel-buffer rows. Keep connected hands/hair and their
/// original soft alpha; isolated objects never become part of the creator.
enum StudioSignatureMatte {
  static func principalPerson(_ bytes: [UInt8], width: Int, height: Int, face: CGRect?) -> [UInt8] {
    guard width > 0, height > 0, bytes.count == width*height else { return bytes }
    var visited = [Bool](repeating: false, count: bytes.count)
    var winner = [Int](), bestAnchor = 0.0, bestSize = 0.0
    for start in bytes.indices where bytes[start] >= 64 && !visited[start] {
      var component = [start], cursor = 0, anchor = 0.0, size = 0.0
      visited[start] = true
      while cursor < component.count {
        let index = component[cursor], x = index%width, y = index/width
        cursor += 1; size += Double(bytes[index])/255
        if let face, face.width > 0, face.height > 0 {
          let dx = (Double(x)+0.5-Double(face.midX)*Double(width))/(Double(face.width)*Double(width)*0.45)
          let dy = (Double(y)+0.5-Double(face.midY)*Double(height))/(Double(face.height)*Double(height)*0.48)
          if dx*dx+dy*dy <= 1 { anchor += Double(bytes[index])/255 }
        }
        for dy in -1...1 { for dx in -1...1 where dx != 0 || dy != 0 {
          let nx = x+dx, ny = y+dy
          guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
          let next = ny*width+nx
          if !visited[next] && bytes[next] >= 64 { visited[next] = true; component.append(next) }
        } }
      }
      if anchor > bestAnchor || (anchor == bestAnchor && size > bestSize) {
        winner = component; bestAnchor = anchor; bestSize = size
      }
    }
    var kept = [Bool](repeating: false, count: bytes.count)
    for index in winner { kept[index] = true }
    // Retain at most two pixels of existing subthreshold fringe. No dilation
    // of alpha, disconnected high-confidence island or previous-frame matte.
    for _ in 0..<2 {
      var next = kept
      for index in bytes.indices where !kept[index] && bytes[index] > 0 && bytes[index] < 64 {
        let x = index%width, y = index/width
        for dy in -1...1 { for dx in -1...1 {
          let nx = x+dx, ny = y+dy
          if nx >= 0, nx < width, ny >= 0, ny < height, kept[ny*width+nx] { next[index] = true }
        } }
      }
      kept = next
    }
    return bytes.indices.map { kept[$0] ? bytes[$0] : 0 }
  }
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
  private static let portraitV2Kernel = CIKernel(source: """
    vec3 encodedPortrait(vec3 v) {
      return mix(v*12.92,1.055*pow(max(v,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),v));
    }
    vec3 linearPortrait(vec3 v) {
      return mix(v/12.92,pow((v+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),v));
    }
    float luminanceAt(sampler image, vec2 point) {
      return dot(encodedPortrait(unpremultiply(sample(image,samplerTransform(image,point))).rgb),vec3(0.2126,0.7152,0.0722));
    }
    float bilateralPortrait(sampler image,vec2 p,float radius,float y) {
      float sum=y,weights=1.0,n,w;
      n=luminanceAt(image,p+vec2(1.0*radius,0.0*radius));w=0.75*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      n=luminanceAt(image,p+vec2(-1.0*radius,0.0*radius));w=0.75*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      n=luminanceAt(image,p+vec2(0.0*radius,1.0*radius));w=0.75*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      n=luminanceAt(image,p+vec2(0.0*radius,-1.0*radius));w=0.75*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      n=luminanceAt(image,p+vec2(1.0*radius,1.0*radius));w=0.5*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      n=luminanceAt(image,p+vec2(-1.0*radius,1.0*radius));w=0.5*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      n=luminanceAt(image,p+vec2(1.0*radius,-1.0*radius));w=0.5*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      n=luminanceAt(image,p+vec2(-1.0*radius,-1.0*radius));w=0.5*exp(-((n-y)*(n-y))/(2.0*0.09*0.09));sum+=n*w;weights+=w;
      return sum/weights;
    }
    kernel vec4 studioPortraitV2(sampler image,sampler mask,float strength,float radius) {
      vec2 p=destCoord();vec4 source=sample(image,samplerTransform(image,p));
      float coverage=clamp(sample(mask,samplerTransform(mask,p)).r,0.0,1.0);
      if(coverage<=0.0||strength<=0.0)return source;
      vec4 original=unpremultiply(source);
      vec3 rgb=encodedPortrait(original.rgb);float y=dot(rgb,vec3(0.2126,0.7152,0.0722));
      float target=bilateralPortrait(image,p,radius*0.5,y)*0.55+bilateralPortrait(image,p,radius,y)*0.30+bilateralPortrait(image,p,radius*1.8,y)*0.15;
      float delta=clamp(target-y,-0.14,0.14)*1.0*pow(strength,1.5)*coverage;
      delta=clamp(delta,-min(min(rgb.r,rgb.g),rgb.b),1.0-max(max(rgb.r,rgb.g),rgb.b));
      return premultiply(vec4(linearPortrait(rgb+delta),original.a));
    }
    """)
  static var portraitV2Available: Bool { portraitV2Kernel != nil }
  static var editorTreatmentsAvailable: Bool { enhancementKernel != nil && portraitKernel != nil }
  private static let backgroundIsolationKernel = CIColorKernel(source: """
    kernel vec4 backgroundOnly(__sample pixel, __sample mask) {
      return pixel*(1.0-smoothstep(0.02,0.18,clamp(mask.r,0.0,1.0)));
    }
    """)
  private static let signatureFaceAnalysisKernel = CIKernel(source: """
    kernel vec4 faceAnalysis(float cx,float cy,float rx,float ry) {
      vec2 d=(destCoord()-vec2(cx,cy))/vec2(rx,ry);
      float w=exp(-2.5*dot(d,d));return vec4(w,w,w,1.0);
    }
    """)
  private static let signatureMeasurementKernel = CIColorKernel(source: """
    kernel vec4 subjectMeasurement(__sample person,__sample face,float hasFace) {
      float eligible=hasFace>0.5?step(0.350001,face.r)*step(0.600001,person.r):step(0.850001,person.r);
      return vec4(eligible,eligible,eligible,1.0);
    }
    """)
  private static let signatureMatteKernel = CIKernel(source: """
    vec3 matteRGB(sampler image,vec2 p) {
      vec3 v=unpremultiply(sample(image,samplerTransform(image,p))).rgb;
      return mix(v*12.92,1.055*pow(max(v,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),v));
    }
    kernel vec4 refineMatte(sampler image,sampler mask,float sx,float sy,float cx,float cy,float fw,float fh,float hasFace) {
      vec2 p=destCoord();vec3 rgb=matteRGB(image,p);float a=sample(mask,samplerTransform(mask,p)).r,sum=a,weights=1.0;
      vec2 q=p+vec2(sx,0.0);vec3 d=matteRGB(image,q)-rgb;float w=0.75*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      q=p+vec2(-sx,0.0);d=matteRGB(image,q)-rgb;w=0.75*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      q=p+vec2(0.0,sy);d=matteRGB(image,q)-rgb;w=0.75*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      q=p+vec2(0.0,-sy);d=matteRGB(image,q)-rgb;w=0.75*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      q=p+vec2(sx,sy);d=matteRGB(image,q)-rgb;w=0.5*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      q=p+vec2(-sx,sy);d=matteRGB(image,q)-rgb;w=0.5*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      q=p+vec2(sx,-sy);d=matteRGB(image,q)-rgb;w=0.5*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      q=p+vec2(-sx,-sy);d=matteRGB(image,q)-rgb;w=0.5*exp(-dot(d,d)/(2.0*0.09*0.09));sum+=sample(mask,samplerTransform(mask,q)).r*w;weights+=w;
      float refined=min(a,mix(a,sum/weights,0.6));
      if(hasFace>0.5){vec2 fd=(p-vec2(cx,cy))/vec2(fw*0.50,fh*0.55);refined=max(refined,smoothstep(0.35,0.75,exp(-2.5*dot(fd,fd))));}
      return vec4(vec3(clamp(refined,0.0,1.0)),1.0);
    }
    """)
  private static let signatureKernel = CIKernel(source: """
    vec3 encodedSignature(vec3 v) { return mix(v*12.92,1.055*pow(max(v,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),v)); }
    vec3 linearSignature(vec3 v) { return mix(v/12.92,pow((v+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),v)); }
    float signatureTone(float value) {
      float v=clamp(value,0.0,1.0);
      if(v<0.12)return v*0.085/0.12;
      if(v<0.25)return 0.085+(v-0.12)*(0.225-0.085)/(0.25-0.12);
      if(v<0.5)return 0.225+(v-0.25)*(0.515-0.225)/(0.5-0.25);
      if(v<0.75)return 0.515+(v-0.5)*(0.775-0.515)/(0.75-0.5);
      return 0.775+(v-0.75)*(0.97-0.775)/(1.0-0.75);
    }
    kernel vec4 signature(sampler image,sampler background,sampler person,
      float strength,float subjectExposure,float backgroundExposure,float temperature,
      float cx,float cy,float fw,float fh,float hasFace) {
      vec2 p=destCoord();vec4 original=unpremultiply(sample(image,samplerTransform(image,p)));
      vec3 rgb=encodedSignature(original.rgb);
      float mask=clamp(sample(person,samplerTransform(person,p)).r,0.0,1.0),key=0.0;
      if(hasFace>0.5){
        float x=(p.x-cx)/(fw*0.6),y=(cy-p.y)/(fh*0.7);
        float radius=length(vec2(x,y)),t=clamp((radius-0.55)/0.57,0.0,1.0);
        float feather=1.0-t*t*(3.0-2.0*t),direction=clamp(0.6-0.22*x-0.16*y,0.18,1.0);
        key=clamp(feather*(0.7+0.3*direction),0.0,1.0)*mask;
      }
      vec4 bgSample=sample(background,samplerTransform(background,p));
      vec3 bgRGB=bgSample.a>0.01?encodedSignature(unpremultiply(bgSample).rgb):rgb;
      vec3 fg=rgb*pow(2.0,subjectExposure*(0.18+0.82*key))*vec3(1.0+temperature*0.05*key,1.0,1.0-temperature*0.04*key);
      vec3 bg=bgRGB*pow(2.0,backgroundExposure)*vec3(0.99,1.0,1.015);
      fg=vec3(signatureTone(fg.r),signatureTone(fg.g),signatureTone(fg.b));
      bg=vec3(signatureTone(bg.r),signatureTone(bg.g),signatureTone(bg.b));
      vec3 weights=vec3(0.2126,0.7152,0.0722);float yf=dot(fg,weights),yb=dot(bg,weights);
      fg=vec3(yf)+(fg-vec3(yf))*0.97;bg=vec3(yb)+(bg-vec3(yb))*0.88;
      vec3 result=clamp(mix(rgb,mix(bg,fg,mask),strength),0.0,1.0);
      return premultiply(vec4(linearSignature(result),original.a));
    }
    """)
  static var cinematicSignatureAvailable: Bool { signatureKernel != nil && backgroundIsolationKernel != nil && signatureFaceAnalysisKernel != nil && signatureMeasurementKernel != nil && signatureMatteKernel != nil }

  func signatureSubjectMeasurementMask(_ masks: StudioSignatureMasks) throws -> CIImage {
    guard let result = Self.signatureMeasurementKernel?.apply(extent: masks.person.extent,
      arguments: [masks.person,masks.face,masks.faceBounds == nil ? 0.0 : 1.0]) else { throw StudioEditorTreatmentError.unavailable }
    return result
  }
  func refineSignatureMatte(_ image: CIImage, mask: CIImage, pixelSize: CGSize, faceBounds: CGRect?) throws -> CIImage {
    let box = faceBounds ?? CGRect(x: image.extent.midX,y: image.extent.midY,width: 1,height: 1)
    guard let result = Self.signatureMatteKernel?.apply(extent: image.extent,
      roiCallback: { _, rect in rect.insetBy(dx: -pixelSize.width,dy: -pixelSize.height) },
      arguments: [image.clampedToExtent(),mask.clampedToExtent(),pixelSize.width,pixelSize.height,
        box.midX,box.midY,box.width,box.height,faceBounds == nil ? 0.0 : 1.0]) else { throw StudioEditorTreatmentError.unavailable }
    return result
  }
  /// Blur weighted background only. Dividing by its blurred alpha reconstructs
  /// neighboring background colors without spreading the person's pixels into
  /// hair/shoulder edges. The compositor uses the current matte to blend it.
  func isolatedSignatureBackground(_ image: CIImage, person: CIImage, amount: Double) throws -> CIImage {
    guard amount > 0 else { return image }
    guard let isolated = Self.backgroundIsolationKernel?.apply(extent: image.extent, arguments: [image, person]) else {
      throw StudioEditorTreatmentError.unavailable
    }
    let radius = min(image.extent.width, image.extent.height)*amount*0.035
    return isolated.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: radius]).cropped(to: image.extent)
  }

  /// Same order as web: portrait from original landmarks, enhancement, grade.
  /// A kernel failure aborts preview/export rather than dropping an effect.
  func editorImage(_ input: CIImage, grade: StudioImageGrade = .identity,
                   enhancement: StudioSceneEnhancement? = nil, portrait: StudioNaturalPortrait? = nil,
                   signature: StudioCinematicSignature? = nil,
                   sourceStage: StudioSourceStage = .standard) throws -> CIImage {
    var result = input
    if let portrait, portrait.strength > 0 {
      guard portrait.isValid, Self.editorTreatmentsAvailable else { throw StudioEditorTreatmentError.unavailable }
      result = try naturalPortrait(input, strength: portrait.strength, version: portrait.version)
    }
    if let enhancement, enhancement.strength > 0 {
      guard enhancement.isValid, let kernel = Self.enhancementKernel,
        let enhanced = kernel.apply(extent: result.extent, arguments: [result, enhancement.strength,
          enhancement.exposure, enhancement.contrast, enhancement.saturation, enhancement.temperature,
          enhancement.tint, enhancement.shadows, enhancement.highlights]) else { throw StudioEditorTreatmentError.unavailable }
      result = enhanced
    }
    if let signature, signature.strength > 0 {
      guard signature.isValid, Self.cinematicSignatureAvailable else { throw StudioEditorTreatmentError.unavailable }
      result = try cinematicSignature(result, signature: signature, masks: signatureMasks(in: input))
    }
    return outputImage(result, grade: grade, sourceStage: sourceStage)
  }

  func cinematicSignature(_ image: CIImage, signature: StudioCinematicSignature, masks: StudioSignatureMasks?) throws -> CIImage {
    guard signature.strength > 0 else { return image }
    // A signature is accepted only after analysis found a creator. If they
    // leave the current frame, keep the background treatment instead of
    // flashing back to the untreated original or reusing an old person mask.
    let black = CIImage(color: .black).cropped(to: image.extent)
    let masks = masks ?? StudioSignatureMasks(person: black, face: black, faceBounds: nil)
    let background = try isolatedSignatureBackground(image, person: masks.person, amount: signature.backgroundBlur)
    let box = masks.faceBounds ?? CGRect(x: image.extent.midX, y: image.extent.midY, width: 1, height: 1)
    guard let result = Self.signatureKernel?.apply(extent: image.extent, roiCallback: { _, rect in rect },
      arguments: [image, background, masks.person, signature.strength, signature.subjectExposure,
        signature.backgroundExposure, signature.temperature, box.midX, box.midY,
        box.width, box.height, masks.faceBounds == nil ? 0.0 : 1.0]) else { throw StudioEditorTreatmentError.unavailable }
    return result
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
  func portraitMask(extent: CGRect, faces: [StudioPortraitGeometry], version: Int = 1) -> CIImage? {
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
    if version == 2 {
      // Keep the feather inside the contracted oval. It must not carry the
      // stronger v2 smoothing into hair/background beside the silhouette.
      mask = mask.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: CIImage(cgImage: first)])
    }
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

  func naturalPortrait(_ image: CIImage, strength: Double, version: Int = 1, geometry: [StudioPortraitGeometry]? = nil) throws -> CIImage {
    guard [1,2].contains(version), strength.isFinite, (0...1).contains(strength) else { throw StudioEditorTreatmentError.unavailable }
    let faces = geometry ?? portraitGeometry(in: image)
    guard let mask = portraitMask(extent: image.extent, faces: faces, version: version) else { return image }
    let width = (faces.map { $0.bounds.width }.max() ?? 0)*image.extent.width
    let radius = version == 2 ? max(1.25,width*0.92*0.018) : max(1,width*0.92*0.004)
    let sampleRadius = radius*(version == 2 ? 1.8 : 1)
    let kernel = version == 2 ? Self.portraitV2Kernel : Self.portraitKernel
    guard let result = kernel?.apply(extent: image.extent,
      roiCallback: { index, rect in index == 0 ? rect.insetBy(dx: -sampleRadius, dy: -sampleRadius) : rect },
      arguments: [image.clampedToExtent(), mask, strength, radius]) else {
      throw StudioEditorTreatmentError.unavailable
    }
    return result
  }

  /// A new request for this exact oriented image. The reduced matte is never
  /// reused across frames/cuts; Vision keeps hair and hands in the person mask.
  func signatureMasks(in image: CIImage) throws -> StudioSignatureMasks? {
    let extent = image.extent
    guard extent.width > 0, extent.height > 0, !extent.isInfinite, !extent.isNull else { return nil }
    let scale = min(1, 512 / max(extent.width, extent.height))
    let small = image.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
      .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cg = context.createCGImage(small, from: small.extent, format: .RGBA8,
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!) else { throw StudioEditorTreatmentError.unavailable }
    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = .balanced; request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request]) }
    catch { throw StudioEditorTreatmentError.unavailable }
    guard let buffer = request.results?.first?.pixelBuffer else { return nil }
    CVPixelBufferLockBaseAddress(buffer, .readOnly); defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let address = CVPixelBufferGetBaseAddress(buffer) else { throw StudioEditorTreatmentError.unavailable }
    let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer), rowBytes = CVPixelBufferGetBytesPerRow(buffer)
    let bytes = address.assumingMemoryBound(to: UInt8.self)
    let box = faceRegions(in: image).first
    let face = box.map { CGRect(x: ($0.minX-extent.minX)/extent.width, y: 1-($0.maxY-extent.minY)/extent.height, width: $0.width/extent.width, height: $0.height/extent.height) }
    let original = (0..<height).flatMap { y in (0..<width).map { bytes[y*rowBytes+$0] } }
    let cleaned = StudioSignatureMatte.principalPerson(original, width: width, height: height, face: face)
    let confident = cleaned.reduce(0) { $0+($1 >= 192 ? 1 : 0) }
    guard Double(confident)/Double(width*height) >= 0.015 else { return nil }
    var cleanBuffer: CVPixelBuffer?
    guard CVPixelBufferCreate(kCFAllocatorDefault,width,height,kCVPixelFormatType_OneComponent8,nil,&cleanBuffer) == kCVReturnSuccess, let cleanBuffer else { throw StudioEditorTreatmentError.unavailable }
    CVPixelBufferLockBaseAddress(cleanBuffer, []); defer { CVPixelBufferUnlockBaseAddress(cleanBuffer, []) }
    guard let output = CVPixelBufferGetBaseAddress(cleanBuffer)?.assumingMemoryBound(to: UInt8.self) else { throw StudioEditorTreatmentError.unavailable }
    let outputRowBytes = CVPixelBufferGetBytesPerRow(cleanBuffer)
    for y in 0..<height { for x in 0..<width { output[y*outputRowBytes+x] = cleaned[y*width+x] } }
    let raw = CIImage(cvPixelBuffer: cleanBuffer, options: [.colorSpace: NSNull()])
    // A small feather after upscaling prevents pixel steps without turning the
    // matte into a broad ellipse or discarding fine hair/hand boundaries.
    let radius = max(0.35, min(extent.width, extent.height)*0.0004)
    let upscaled = raw.transformed(by: CGAffineTransform(scaleX: extent.width/CGFloat(width), y: extent.height/CGFloat(height)))
      .transformed(by: CGAffineTransform(translationX: extent.minX, y: extent.minY))
      .clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: radius]).cropped(to: extent)
    let sx = extent.width/CGFloat(width), sy = extent.height/CGFloat(height)
    let person = try refineSignatureMatte(image,mask: upscaled,pixelSize: CGSize(width: sx,height: sy),faceBounds: box)
    var faceMask = CIImage(color: .black).cropped(to: extent)
    if let box, let ellipse = Self.signatureFaceAnalysisKernel?.apply(extent: extent, roiCallback: { _, rect in rect },
      arguments: [box.midX-box.width*0.06,box.midY+box.height*0.08,box.width*0.63,box.height*0.68]) {
      faceMask = ellipse.cropped(to: extent)
    }
    return StudioSignatureMasks(person: person, face: faceMask, faceBounds: box)
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
