import AVFoundation
import Foundation

@main
struct StudioTranscriptionTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw StudioRecipeError.invalid("Teste de transcrição: \(message)") }
  }
  static func main() async {
    do { try await run() }
    catch {
      let error = error as NSError
      let detail = "FALHA Speech: \(error.domain) code=\(error.code) \(error.localizedDescription)\n"
      FileHandle.standardError.write(Data(detail.utf8))
      exit(1)
    }
  }
  static func run() async throws {
    let service = StudioTranscription()
    var capabilities = await service.capabilities()
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
    let environment = ProcessInfo.processInfo.environment
    if environment["STUDIO_TRANSCRIPTION_RUN_REAL"] == "1" {
      try require(environment["STUDIO_TRANSCRIPTION_FIXTURE"].map { FileManager.default.fileExists(atPath: $0) } == true
        && environment["STUDIO_TRANSCRIPTION_EXPECTED_TEXT"].map { words($0).count >= 8 } == true,
        "execução real exige arquivo existente e referência com ao menos oito palavras antes da instalação")
    }
    if environment["STUDIO_TRANSCRIPTION_INSTALL_MODEL"] == "1" {
      try require(environment["STUDIO_TRANSCRIPTION_RUN_REAL"] == "1"
        && environment["STUDIO_TRANSCRIPTION_FIXTURE"] != nil
        && environment["STUDIO_TRANSCRIPTION_EXPECTED_TEXT"] != nil,
        "download exige opt-in separado, arquivo e texto esperado explícitos")
      try require(capabilities["available"] as? Bool == true, "pt-BR disponível para instalar neste Mac")
      let installProbe = StudioSpeechProgressProbe()
      _ = try await service.installModel(requestId: "explicit-model-install", progress: { stage, ratio in
        installProbe.report(stage, ratio)
      })
      try require(installProbe.valid, "progresso de instalação finito e limitado")
      capabilities = await service.capabilities()
      try require(capabilities["installed"] as? Bool == true, "instalação explícita confirmada pelo sistema")
    }
    if environment["STUDIO_TRANSCRIPTION_RUN_REAL"] == "1" {
      try require(capabilities["installed"] as? Bool == true,
        "modelo local ausente: autorize STUDIO_TRANSCRIPTION_INSTALL_MODEL=1 para instalar explicitamente")
    }
    if let input = environment["STUDIO_TRANSCRIPTION_FIXTURE"],
       capabilities["installed"] as? Bool == true {
      let expected = environment["STUDIO_TRANSCRIPTION_EXPECTED_TEXT"]
      if environment["STUDIO_TRANSCRIPTION_RUN_REAL"] == "1" {
        try require(expected?.isEmpty == false, "execução real exige texto de referência")
      }
      let originalURL = URL(fileURLWithPath: input)
      let originalBytes = try Data(contentsOf: originalURL)
      let inputAsset = AVURLAsset(url: originalURL)
      let duration = try await inputAsset.load(.duration).seconds
      let audioTracks = try await inputAsset.loadTracks(withMediaType: .audio)
      try require(duration.isFinite && duration > 0 && !audioTracks.isEmpty,
        "fixture tem áudio com duração válida")
      let begin = Date()
      let transcriptionProbe = StudioSpeechProgressProbe()
      let result = try await service.transcribe(requestId: "fixture", uri: URL(fileURLWithPath: input).absoluteString,
        progress: { stage, ratio in transcriptionProbe.report(stage, ratio) })
      let segments = result["segments"] as? [[String: Any]] ?? []
      try require(!segments.isEmpty && result["onDevice"] as? Bool == true, "voz real produz transcrição local")
      try require((result["locale"] as? String)?.hasPrefix("pt") == true && transcriptionProbe.valid,
        "idioma português e progresso válido")
      var previousStart = 0.0, timedWords = 0
      for segment in segments {
        let start = segment["startSeconds"] as? Double ?? .nan
        let end = segment["endSeconds"] as? Double ?? .nan
        try require(start.isFinite && end.isFinite && start >= 0 && end > start
          && end <= duration + 0.05 && start >= previousStart - 0.05,
          "segmentos ordenados com intervalos dentro do áudio")
        previousStart = start
        for word in segment["words"] as? [[String: Any]] ?? [] {
          let wordStart = word["startSeconds"] as? Double ?? .nan
          let wordEnd = word["endSeconds"] as? Double ?? .nan
          try require(wordStart.isFinite && wordEnd.isFinite && wordEnd > wordStart
            && wordStart >= start - 0.05 && wordEnd <= end + 0.05,
            "palavras têm tempos locais reais dentro do segmento")
          timedWords += 1
        }
      }
      try require(timedWords > 0, "SpeechAnalyzer entrega palavras temporizadas")
      let actual = segments.compactMap { $0["text"] as? String }.joined(separator: " ")
      var metrics: [String: Any] = [:]
      if let expected {
        let referenceWords = words(expected), recognizedWords = words(actual)
        try require(referenceWords.count >= 8, "referência tem fala suficiente para comparação")
        let referenceSet = Set(referenceWords)
        let recall = Double(referenceSet.intersection(Set(recognizedWords)).count) / Double(referenceSet.count)
        let wordErrorRate = Double(editDistance(referenceWords, recognizedWords)) / Double(referenceWords.count)
        try require(recall >= 0.72 && wordErrorRate <= 0.4,
          "texto aproximado corresponde ao português esperado; recall=\(recall), WER=\(wordErrorRate)")
        metrics = ["wordRecall": recall, "wordErrorRate": wordErrorRate]
      }
      let elapsed = Date().timeIntervalSince(begin)
      var benchmark: [String: Any] = ["locale": result["locale"] ?? "pt-BR", "onDevice": true,
        "fixtureKind": environment["STUDIO_TRANSCRIPTION_FIXTURE_KIND"] ?? "explicit-audio",
        "runDate": ISO8601DateFormatter().string(from: Date()),
        "operatingSystem": ProcessInfo.processInfo.operatingSystemVersionString,
        "audioSeconds": duration, "elapsedSeconds": elapsed, "segmentCount": segments.count,
        "timedWordCount": timedWords, "text": actual, "metrics": metrics,
        "segments": segments, "modelDownloadExplicit": environment["STUDIO_TRANSCRIPTION_INSTALL_MODEL"] == "1"]
      if let destination = environment["STUDIO_TRANSCRIPTION_BENCHMARK"] {
        let file = URL(fileURLWithPath: destination)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: benchmark, options: [.prettyPrinted, .sortedKeys]).write(to: file, options: .atomic)
      }
      print("Transcrição local: \(segments.count) segmentos, \(timedWords) palavras temporizadas, áudio \(duration)s, processamento \(elapsed)s; \(metrics).")
      print("Texto reconhecido: \(actual)")
      if environment["STUDIO_TRANSCRIPTION_RUN_REAL"] == "1" {
        let cancelProbe = StudioSpeechProgressProbe()
        let cancellationBegin = Date()
        var cancelled = false
        var cancellationError: [String: Any] = [:]
        do {
          _ = try await service.transcribe(requestId: "cancel-processing", uri: originalURL.absoluteString,
            progress: { stage, ratio in
              cancelProbe.report(stage, ratio)
              guard stage == "transcribing" else { return }
              if ratio > 0 && ratio < 1 && cancelProbe.requestCancellation(origin: "result-progress") {
                service.cancel("cancel-processing")
              } else if ratio == 0 {
                Task {
                  try? await Task.sleep(nanoseconds: 200_000_000)
                  if cancelProbe.requestCancellation(origin: "after-analysis-start-200ms") { service.cancel("cancel-processing") }
                }
              }
            })
        } catch {
          cancelled = true
          let detail = error as NSError
          cancellationError = ["domain": detail.domain, "code": detail.code]
          print("Cancelamento durante análise: \(detail.domain) code=\(detail.code) \(detail.localizedDescription)")
        }
        cancelProbe.complete()
        let cancellationElapsed = Date().timeIntervalSince(cancellationBegin)
        try require(cancelled && cancelProbe.cancellationRequested && cancellationElapsed < 15,
          "cancelamento de análise real termina com erro em tempo limitado")
        // Reusing the request id confirms cleanup of the cancelled job and
        // analyzer, rather than accepting a hung or still-running recognizer.
        let retryBegin = Date()
        let retry = try await service.transcribe(requestId: "cancel-processing", uri: originalURL.absoluteString,
          progress: { _, _ in })
        try require(!(retry["segments"] as? [[String: Any]] ?? []).isEmpty,
          "análise pode reiniciar depois do cancelamento")
        benchmark["cancellation"] = ["passed": true, "origin": cancelProbe.cancellationOrigin,
          "elapsedSeconds": cancellationElapsed, "error": cancellationError,
          "retryPassed": true, "retryElapsedSeconds": Date().timeIntervalSince(retryBegin)]
      }
      try require(try Data(contentsOf: originalURL) == originalBytes, "reconhecimento e cancelamento preservam a origem")
      benchmark["originalPreserved"] = true
      if let destination = environment["STUDIO_TRANSCRIPTION_BENCHMARK"] {
        try JSONSerialization.data(withJSONObject: benchmark, options: [.prettyPrinted, .sortedKeys])
          .write(to: URL(fileURLWithPath: destination), options: .atomic)
      }
    } else {
      print("Reconhecimento de voz real não executado: precisa de fixture explícita e modelo já instalado; nenhum modelo foi baixado pelo teste.")
    }
    print("OK: capacidade pt-BR \(capabilities); idioma inválido, arquivo remoto e cancelamento seguro.")
  }

  static func words(_ value: String) -> [String] {
    value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt-BR"))
      .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
  }
  static func editDistance(_ left: [String], _ right: [String]) -> Int {
    var row = Array(0...right.count)
    for (index, word) in left.enumerated() {
      var next = [index + 1]
      for (column, other) in right.enumerated() {
        next.append(min(row[column + 1] + 1, next[column] + 1, row[column] + (word == other ? 0 : 1)))
      }
      row = next
    }
    return row[right.count]
  }
}

final class StudioSpeechProgressProbe: @unchecked Sendable {
  private let lock = NSLock()
  private var finite = true
  private var lastPercent: [String: Int] = [:]
  private var cancelled = false
  private var origin = "none"
  private var finished = false
  var valid: Bool { lock.lock(); defer { lock.unlock() }; return finite }
  var cancellationRequested: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
  var cancellationOrigin: String { lock.lock(); defer { lock.unlock() }; return origin }
  func report(_ stage: String, _ ratio: Double) {
    lock.lock(); defer { lock.unlock() }
    finite = finite && ratio.isFinite && (0...1).contains(ratio)
    guard ratio.isFinite else { return }
    let percent = Int((ratio * 100).rounded(.down))
    if lastPercent[stage] == nil || percent == 100 || percent >= (lastPercent[stage] ?? 0) + 10 {
      lastPercent[stage] = percent
      print("Speech \(stage): \(percent)%")
      fflush(stdout)
    }
  }
  func requestCancellation(origin: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard !finished, !cancelled else { return false }
    cancelled = true; self.origin = origin; return true
  }
  func complete() { lock.lock(); finished = true; lock.unlock() }
}
