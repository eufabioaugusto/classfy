import Foundation

@main
struct StudioTranscriptionTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioRecipeError.invalid("Teste de transcrição: \(message)") }
  }
  static func main() async throws {
    let service = StudioTranscription()
    let capabilities = await service.capabilities()
    try require(capabilities["available"] is Bool && capabilities["installed"] is Bool,
      "capacidade e instalação são reais, não promessas de suporte")
    let unavailable = await service.capabilities(localeIdentifier: "zz-ZZ")
    try require(unavailable["available"] as? Bool == false, "idioma não suportado falha fechado")
    var refusedRemote = false
    do {
      _ = try await service.transcribe(requestId: "remote", uri: "https://example.invalid/audio.m4a", progress: { _, _ in })
    } catch { refusedRemote = true }
    try require(refusedRemote, "entrada remota é recusada antes de baixar um modelo")
    if capabilities["available"] as? Bool == true {
      var cancelled = false
      do {
        _ = try await service.installModel(requestId: "cancel-before-download", progress: { _, _ in
          service.cancel("cancel-before-download")
        })
      } catch { cancelled = true }
      try require(cancelled, "cancelamento inicial impede instalação")
    }
    if let input = ProcessInfo.processInfo.environment["STUDIO_TRANSCRIPTION_FIXTURE"],
       capabilities["installed"] as? Bool == true {
      let result = try await service.transcribe(requestId: "fixture", uri: URL(fileURLWithPath: input).absoluteString,
        progress: { _, _ in })
      let segments = result["segments"] as? [[String: Any]] ?? []
      try require(!segments.isEmpty && result["onDevice"] as? Bool == true, "voz real produz transcrição local")
      for segment in segments {
        let start = segment["startSeconds"] as? Double ?? .nan
        let end = segment["endSeconds"] as? Double ?? .nan
        try require(start.isFinite && end.isFinite && start >= 0 && end > start, "segmentos têm intervalos válidos")
      }
      print("Transcrição local real: \(segments.count) segmentos.")
    } else {
      print("Reconhecimento de voz real não executado: precisa de fixture explícita e modelo já instalado; nenhum modelo foi baixado pelo teste.")
    }
    print("OK: capacidade pt-BR \(capabilities); idioma inválido, arquivo remoto e cancelamento seguro.")
  }
}
