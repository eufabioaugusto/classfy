import Foundation
import CoreImage

/// A canonical frame and a durable save are independent acknowledgments. The
/// transient surface may leave only when both belong to its same operation.
struct StudioCompositionHandoffGate {
  private(set) var operationId: String?
  private(set) var canonicalReady = false
  private(set) var durableCommit = false
  var canRevealCanonical: Bool { operationId != nil && canonicalReady && durableCommit }

  mutating func begin(operationId: String, committed: Bool) {
    let previousCommit = self.operationId == operationId && durableCommit
    self.operationId = operationId; canonicalReady = false
    durableCommit = committed || previousCommit
  }
  mutating func acknowledgeCommit(operationId: String) {
    guard self.operationId == operationId else { return }
    durableCommit = true
  }
  mutating func prime(operationId: String) {
    guard self.operationId == operationId else { return }
    canonicalReady = true
  }
  mutating func reset() { self = Self() }
}

struct StudioCompositionInteractionPatch: Decodable {
  struct Transform: Decodable { let rect: StudioRecipe.Rect; let textFontSize: Double? }
  let version: Int
  let revision: String
  let active: Bool
  let sequence: Int
  let operationId: String
  let epoch: Int
  let clipId: String
  let phase: String
  let transform: Transform
  let finish: String?

  static func decode(_ json: String) throws -> Self {
    guard let data = json.data(using: .utf8), data.count <= 4096 else {
      throw StudioRecipeError.invalid("A posição deste elemento é inválida.")
    }
    let value = try JSONDecoder().decode(Self.self, from: data)
    let r = value.transform.rect
    guard value.version == 1, value.sequence >= 0, value.epoch >= 0,
      value.revision.count <= 256, value.operationId.count <= 512, value.clipId.count <= 256,
      ["idle", "gesture", "committing"].contains(value.phase),
      value.active == (value.phase != "idle"),
      value.finish == nil || ["commit", "cancel"].contains(value.finish!),
      [r.x, r.y, r.width, r.height].allSatisfy(\.isFinite),
      (-2...3).contains(r.x), (-2...3).contains(r.y),
      r.width > 0, r.width <= 3, r.height > 0, r.height <= 3,
      value.transform.textFontSize.map({ $0.isFinite && $0 > 0 && $0 <= 1 }) ?? true else {
      throw StudioRecipeError.invalid("A posição deste elemento é inválida.")
    }
    return value
  }
  var visualOverride: StudioRecipeVisualOverride {
    StudioRecipeVisualOverride(clipId: clipId, rect: transform.rect, textFontSize: transform.textFontSize)
  }
  func matches(_ recipe: StudioRecipe) -> Bool {
    guard let clip = recipe.clips.first(where: { $0.id == clipId }) else { return false }
    let a = clip.rect, b = transform.rect
    return zip([a.x, a.y, a.width, a.height], [b.x, b.y, b.width, b.height]).allSatisfy { abs($0 - $1) < 0.00001 }
      && (transform.textFontSize == nil || abs((clip.text?.fontSize ?? 0) - transform.textFontSize!) < 0.00001)
  }
  func withCanonicalTransform(_ recipe: StudioRecipe) -> Self {
    guard let clip = recipe.clips.first(where: { $0.id == clipId }) else { return self }
    return Self(version: version, revision: revision, active: active, sequence: sequence,
      operationId: operationId, epoch: epoch, clipId: clipId, phase: phase,
      transform: Transform(rect: clip.rect, textFontSize: clip.text?.fontSize), finish: finish)
  }
  /// Fabric may deliver a canonical prop before its UI phase patch. Only a
  /// pose/font change on this same item may hold the transient surface over it.
  func preservesComposition(_ previous: StudioRecipe, _ next: StudioRecipe) -> Bool {
    func structural(_ recipe: StudioRecipe) throws -> Data {
      var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(recipe)) as! [String: Any]
      object["clips"] = (object["clips"] as! [[String: Any]]).map { clip in
        guard clip["id"] as? String == clipId else { return clip }
        var value = clip; value.removeValue(forKey: "rect")
        if var text = value["text"] as? [String: Any] { text.removeValue(forKey: "fontSize"); value["text"] = text }
        return value
      }
      return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
    guard previous.clips.contains(where: { $0.id == clipId }), next.clips.contains(where: { $0.id == clipId }),
      let a = try? structural(previous), let b = try? structural(next) else { return false }
    return a == b
  }
}

#if canImport(UIKit) && canImport(MetalKit)
import UIKit
import MetalKit

/// One cached decoded frame-set and at most two GPU submissions. Geometry is
/// rendered on demand at display cadence, never by replacing AVPlayerItem.
@MainActor
final class StudioCompositionInteractiveSurface: NSObject, MTKViewDelegate {
  let view: MTKView
  private let queue: MTLCommandQueue
  private let context: CIContext
  private let slots = DispatchSemaphore(value: 2)
  private var frame: StudioRecipeFrozenFrame?
  private var patch: StudioCompositionInteractionPatch?
  private var generation = 0
  private var drawRevision = 0
  private var submittedRevision = -1
  var onDrawn: ((String, Int) -> Void)?
  var onFailure: ((Error) -> Void)?

  init?(device: MTLDevice? = MTLCreateSystemDefaultDevice()) {
    guard let device, let queue = device.makeCommandQueue() else { return nil }
    self.queue = queue
    context = CIContext(mtlCommandQueue: queue, options: [
      .workingColorSpace: StudioEffectRenderer.workingColorSpace,
      .outputColorSpace: StudioEffectRenderer.outputColorSpace, .cacheIntermediates: false
    ])
    view = MTKView(frame: .zero, device: device)
    super.init()
    view.framebufferOnly = false; view.colorPixelFormat = .bgra8Unorm
    view.isPaused = true; view.enableSetNeedsDisplay = true
    view.isUserInteractionEnabled = false; view.isHidden = true
    view.contentScaleFactor = UIScreen.main.scale
    if let layer = view.layer as? CAMetalLayer { layer.colorspace = StudioEffectRenderer.outputColorSpace }
    view.delegate = self
  }

  func update(_ frame: StudioRecipeFrozenFrame, patch: StudioCompositionInteractionPatch) {
    self.frame = frame; self.patch = patch; drawRevision += 1; view.setNeedsDisplay()
  }
  func clear() {
    generation += 1; frame = nil; patch = nil; drawRevision += 1; submittedRevision = -1; view.isHidden = true
  }
  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { drawRevision += 1; view.setNeedsDisplay() }
  func draw(in view: MTKView) {
    guard let frame, let patch, submittedRevision != drawRevision,
      slots.wait(timeout: .now()) == .success else { return }
    guard let drawable = view.currentDrawable, let command = queue.makeCommandBuffer() else { slots.signal(); return }
    let source: CIImage
    do { source = try frame.image(override: patch.visualOverride) }
    catch { slots.signal(); onFailure?(error); return }
    let target = CGRect(x: 0, y: 0, width: drawable.texture.width, height: drawable.texture.height)
    let size = frame.prepared.recipe.size
    let scale = min(target.width / size.width, target.height / size.height)
    let image = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale)
      .concatenating(CGAffineTransform(translationX: (target.width - size.width * scale) / 2,
        y: (target.height - size.height * scale) / 2)))
      .composited(over: CIImage(color: .black).cropped(to: target)).cropped(to: target)
    let destination = CIRenderDestination(mtlTexture: drawable.texture, commandBuffer: command)
    destination.colorSpace = StudioEffectRenderer.outputColorSpace; destination.isFlipped = true
    do { _ = try context.startTask(toRender: image, to: destination) }
    catch { slots.signal(); onFailure?(error); return }
    let token = generation, operation = patch.operationId, sequence = patch.sequence, slots = self.slots
    let drawing = drawRevision
    submittedRevision = drawing
    command.addCompletedHandler { [weak self] value in
      // CIImage retains the source buffers until this command has finished.
      _ = frame
      slots.signal()
      DispatchQueue.main.async { [weak self] in
        guard let self, token == self.generation, self.patch?.operationId == operation else { return }
        guard value.status == .completed else {
          self.onFailure?(value.error ?? StudioRecipeError.invalid("Não foi possível atualizar a prévia deste elemento.")); return
        }
        self.view.isHidden = false; self.onDrawn?(operation, sequence)
        // A canonical pose can replace a transient frame without changing its
        // channel sequence. Retry that newer draw even when both GPU slots had
        // been occupied when it arrived.
        if self.drawRevision != drawing { self.view.setNeedsDisplay() }
      }
    }
    command.present(drawable); command.commit()
  }
}
#endif
