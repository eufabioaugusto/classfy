import AVFoundation
import CoreImage
import CoreVideo
import Foundation

enum StudioVideoRenderGeometry {
  // AVFoundation describes renderTransform in top-left coordinates, including
  // scale, pixel aspect and edge padding. CoreImage uses bottom-left. The
  // destination flip uses the real pool buffer height, not the recipe height.
  static func coreImageTransform(canvasSize: CGSize, destinationSize: CGSize,
                                  renderTransform: CGAffineTransform) throws -> CGAffineTransform {
    guard [canvasSize.width, canvasSize.height, destinationSize.width, destinationSize.height]
      .allSatisfy({ $0.isFinite && $0 > 0 }),
      [renderTransform.a, renderTransform.b, renderTransform.c, renderTransform.d,
       renderTransform.tx, renderTransform.ty].allSatisfy(\.isFinite),
      abs(renderTransform.a * renderTransform.d - renderTransform.b * renderTransform.c) > 0 else {
      throw StudioRecipeError.invalid("Não foi possível calcular o tamanho desta prévia.")
    }
    let sourceFlip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: canvasSize.height)
    let destinationFlip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: destinationSize.height)
    return sourceFlip.concatenating(renderTransform).concatenating(destinationFlip)
  }

  static func render(_ image: CIImage, canvasSize: CGSize,
                     context: AVVideoCompositionRenderContext, buffer: CVPixelBuffer,
                     renderer: StudioEffectRenderer) throws {
    let size = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
    let bounds = CGRect(origin: .zero, size: size)
    let transform = try coreImageTransform(canvasSize: canvasSize, destinationSize: size,
      renderTransform: context.renderTransform)
    let padded = image.transformed(by: transform)
      .composited(over: CIImage(color: .black).cropped(to: bounds)).cropped(to: bounds)
    renderer.render(padded, to: buffer, bounds: bounds)
  }
}
