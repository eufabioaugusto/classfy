import AVFoundation
import Foundation

private final class ExportProgressProbe {
  private let lock = NSLock()
  private var observed: Double?
  private var failure: Error?
  private var values: [Double] = []
  private var prematureCompletion = false
  func onceDuringEncoding(_ value: Double, action: () throws -> Void) {
    lock.lock()
    let first = value > 0 && value < 1 && observed == nil
    if first { observed = value }
    lock.unlock()
    if first {
      do { try action() } catch { lock.lock(); failure = error; lock.unlock() }
    }
  }
  var encodingProgress: Double? {
    lock.lock(); defer { lock.unlock() }; return observed
  }
  var injectionError: Error? {
    lock.lock(); defer { lock.unlock() }; return failure
  }
  func record(_ value: Double, output: URL) {
    lock.lock(); defer { lock.unlock() }
    values.append(value)
    if value == 1 && !FileManager.default.fileExists(atPath: output.path) { prematureCompletion = true }
  }
  var progression: (values: [Double], prematureCompletion: Bool) {
    lock.lock(); defer { lock.unlock() }; return (values, prematureCompletion)
  }
}

@main
struct StudioExportRecoveryTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioRecipeError.invalid("Teste de recuperação: \(message)") }
  }
  static func main() async throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let source = root.appendingPathComponent("source.mp4")
    let original = try Data(contentsOf: source)
    let engine = StudioRecipeEngine()
    func recipe(repeats: Int) throws -> String {
      let clips: [[String: Any]] = (0..<repeats).map { index in
        ["id": "take-\(index)", "kind": "video", "assetId": "source", "zIndex": 0,
         "startTicks": index * 240_000, "durationTicks": 240_000,
         "sourceStartTicks": 0, "sourceEndTicks": 240_000,
         "rect": ["x": 0, "y": 0, "width": 1, "height": 1],
         "rotationDegrees": 0, "fit": "contain", "opacity": 1, "gain": 1,
         "fadeInTicks": 0, "fadeOutTicks": 0, "effect": "natural"]
      }
      let value: [String: Any] = [
        "version": 2, "timebase": 120_000, "durationTicks": repeats * 240_000, "mediaType": "video",
        "canvas": ["aspectRatio": "landscape", "backgroundColor": "#000000"],
        "output": ["profile": "standard", "width": 1920, "height": 1080,
                   "frameRateNumerator": 30, "frameRateDenominator": 1, "colorSpace": "rec709"],
        "assets": [["id": "source", "kind": "video", "uri": source.absoluteString,
                    "durationTicks": 240_000, "sourceStage": "standard"]], "clips": clips
      ]
      return String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8)!
    }
    let shortRecipe = try recipe(repeats: 1)
    let longRecipe = try recipe(repeats: 20)
    let sentinel = Data("arquivo existente que não pertence a esta exportação".utf8)
    func noPartials() throws {
      let files = try FileManager.default.contentsOfDirectory(atPath: root.path)
      try require(!files.contains { $0.hasPrefix(".classfy-export-") }, "nenhuma saída temporária abandonada")
      try require(try Data(contentsOf: source) == original, "original preservado byte a byte")
    }

    let existing = root.appendingPathComponent("existing.mp4")
    try sentinel.write(to: existing)
    var existingRejected = false
    do {
      _ = try await engine.export(requestId: "existing", recipeJSON: shortRecipe,
        outputUri: existing.absoluteString, progress: { _ in })
    } catch { existingRejected = true }
    try require(existingRejected, "destino existente recusado")
    try require(FileManager.default.fileExists(atPath: existing.path), "recusa não apaga destino existente")
    try require(try Data(contentsOf: existing) == sentinel, "recusa não altera destino existente")
    try noPartials()

    let cancelled = root.appendingPathComponent("cancelled.mp4")
    let cancellation = ExportProgressProbe()
    var wasCancelled = false
    do {
      _ = try await engine.export(requestId: "recovery", recipeJSON: longRecipe,
        outputUri: cancelled.absoluteString, progress: { value in
          cancellation.onceDuringEncoding(value) { engine.cancel("recovery") }
        })
    } catch StudioRecipeError.cancelled { wasCancelled = true }
    try require(cancellation.encodingProgress != nil, "cancelamento aconteceu após progresso real, antes de 100%")
    try require(wasCancelled && !FileManager.default.fileExists(atPath: cancelled.path), "cancelamento durante encoding não publica saída parcial")
    try noPartials()
    print("Cancelamento durante encoding: progresso \(cancellation.encodingProgress!), origem intacta, sem saída parcial.")

    // Deterministic I/O failure: the parent is a file, never a disk/permission
    // change to the user's computer. The same request ID must be usable again.
    let blockedParent = root.appendingPathComponent("blocked-parent")
    try sentinel.write(to: blockedParent)
    var failedWrite = false
    do {
      _ = try await engine.export(requestId: "recovery", recipeJSON: shortRecipe,
        outputUri: blockedParent.appendingPathComponent("output.mp4").absoluteString, progress: { _ in })
    } catch { failedWrite = true }
    try require(failedWrite && (try Data(contentsOf: blockedParent)) == sentinel, "falha de escrita preserva arquivo alheio")
    try noPartials()

    // Simulate another writer claiming the destination after export started.
    // It must survive; cleanup may remove only this operation's temporary file.
    let raced = root.appendingPathComponent("raced.mp4")
    let collision = ExportProgressProbe()
    var collisionRejected = false
    do {
      _ = try await engine.export(requestId: "collision", recipeJSON: shortRecipe,
        outputUri: raced.absoluteString, progress: { value in
          collision.onceDuringEncoding(value) { try sentinel.write(to: raced, options: .atomic) }
        })
    } catch { collisionRejected = true }
    try require(collision.encodingProgress != nil && collision.injectionError == nil && collisionRejected, "colisão durante encoding é recusada")
    try require(FileManager.default.fileExists(atPath: raced.path), "colisão tardia não apaga outro arquivo")
    try require(try Data(contentsOf: raced) == sentinel, "colisão tardia não apaga nem substitui outro arquivo")
    try noPartials()

    let retry = root.appendingPathComponent("retry.mp4")
    let completion = ExportProgressProbe()
    let result = try await engine.export(requestId: "recovery", recipeJSON: shortRecipe,
      outputUri: retry.absoluteString, progress: { value in
        completion.record(value, output: retry)
        if value == 1 { engine.cancel("recovery") }
      })
    try require(URL(string: result["uri"] as? String ?? "")?.standardizedFileURL == retry.standardizedFileURL, "resultado aponta para destino confirmado")
    try require(result["hasAudio"] as? Bool == true && result["hasVideo"] as? Bool == true, "nova tentativa conserva voz e vídeo")
    try require(abs((result["duration"] as? Double ?? 0) - 2) < 0.04, "nova tentativa tem duração completa")
    try require((result["fileSize"] as? Double ?? 0) > 0 && FileManager.default.fileExists(atPath: retry.path), "sucesso somente após arquivo real")
    try require(try Data(contentsOf: retry).count > 0, "cancelamento posterior ao commit não apaga exportação confirmada")
    let progression = completion.progression
    try require(progression.values.first == 0 && progression.values.last == 1 && progression.values.filter { $0 == 1 }.count == 1,
      "progresso tem uma única conclusão")
    try require(!progression.prematureCompletion && zip(progression.values, progression.values.dropFirst()).allSatisfy { $0 <= $1 },
      "progresso contínuo sem 100% antes do arquivo confirmado")
    try noPartials()
    print("OK: destino existente/colisão tardia preservados; cancelamento em encoding e falha I/O liberam sessão; nova exportação válida com voz e vídeo.")
  }
}
