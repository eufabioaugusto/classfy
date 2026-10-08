import AVFoundation
import Foundation
import Speech

// All recognition uses SpeechAnalyzer locally. A model download is explicit and
// reported separately; unsupported hardware/OS/locales never fall back online.
final class StudioTranscription {
  private struct Job { var cancelled = false; var task: Task<[String: Any], Error>? }
  private let lock = NSLock()
  private var jobs: [String: Job] = [:]

  func capabilities(localeIdentifier: String = "pt-BR") async -> [String: Any] {
    guard #available(iOS 26.0, macOS 26.0, *) else {
      return ["available": false, "installed": false, "requiresModelDownload": false,
              "locale": localeIdentifier, "reason": "A transcrição local precisa do iOS 26 ou superior."]
    }
    guard SpeechTranscriber.isAvailable else {
      return ["available": false, "installed": false, "requiresModelDownload": false,
              "locale": localeIdentifier, "reason": "Este aparelho não suporta a transcrição local."]
    }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeIdentifier)) else {
      return ["available": false, "installed": false, "requiresModelDownload": false,
              "locale": localeIdentifier, "reason": "O idioma escolhido não está disponível para transcrição local."]
    }
    let module = SpeechTranscriber(locale: locale, preset: .timeIndexedTranscriptionWithAlternatives)
    let installed = await AssetInventory.status(forModules: [module]) == .installed
    return ["available": true, "installed": installed, "requiresModelDownload": !installed,
            "locale": locale.identifier(.bcp47), "onDevice": true]
  }

  func cancel(_ requestId: String) {
    lock.lock()
    guard var job = jobs[requestId] else { lock.unlock(); return }
    job.cancelled = true; jobs[requestId] = job
    let task = job.task; lock.unlock(); task?.cancel()
  }
  func cancelAll() { lock.lock(); let ids = Array(jobs.keys); lock.unlock(); ids.forEach(cancel) }
  private func begin(_ id: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard !id.isEmpty, jobs[id] == nil else { throw StudioRecipeError.invalid("Esta transcrição já está em andamento.") }
    jobs[id] = Job()
  }
  private func attach(_ task: Task<[String: Any], Error>, id: String) {
    lock.lock()
    guard var job = jobs[id] else { lock.unlock(); task.cancel(); return }
    job.task = task; jobs[id] = job; let cancelled = job.cancelled
    lock.unlock(); if cancelled { task.cancel() }
  }
  private func finish(_ id: String) { lock.lock(); defer { lock.unlock() }; jobs.removeValue(forKey: id) }
  private func check(_ id: String) throws {
    try Task.checkCancellation()
    lock.lock(); defer { lock.unlock() }
    guard let job = jobs[id], !job.cancelled else { throw StudioRecipeError.cancelled }
  }
  private func run(_ id: String, operation: @escaping () async throws -> [String: Any]) async throws -> [String: Any] {
    try begin(id)
    defer { finish(id) }
    let task = Task { try self.check(id); return try await operation() }
    attach(task, id: id)
    return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { self.cancel(id) })
  }

  @available(iOS 26.0, macOS 26.0, *)
  private func module(_ localeIdentifier: String) async throws -> SpeechTranscriber {
    guard SpeechTranscriber.isAvailable,
          let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeIdentifier)) else {
      throw StudioRecipeError.invalid("A transcrição local neste idioma não está disponível neste aparelho.")
    }
    return SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
  }

  @available(iOS 26.0, macOS 26.0, *)
  private func download(_ module: SpeechTranscriber, id: String,
                        progress: @escaping (String, Double) -> Void) async throws {
    try check(id)
    if let locale = module.selectedLocales.first {
      let reserved = await AssetInventory.reservedLocales
      if !reserved.contains(locale) { _ = try await AssetInventory.reserve(locale: locale) }
    }
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
      let observation = request.progress.observe(\.fractionCompleted, options: [.initial, .new]) { [weak self] value, _ in
        guard let self, (try? self.check(id)) != nil else { return }
        progress("model", min(1, max(0, value.fractionCompleted)))
      }
      defer { observation.invalidate() }
      try await withTaskCancellationHandler(operation: { try await request.downloadAndInstall() }, onCancel: { request.progress.cancel() })
    }
    try check(id)
  }

  func installModel(requestId: String, localeIdentifier: String = "pt-BR",
                    progress: @escaping (String, Double) -> Void) async throws -> [String: Any] {
    guard #available(iOS 26.0, macOS 26.0, *) else { throw StudioRecipeError.invalid("A transcrição local precisa do iOS 26 ou superior.") }
    return try await run(requestId) {
      let module = try await self.module(localeIdentifier)
      progress("model", 0)
      try await self.download(module, id: requestId, progress: progress)
      guard await AssetInventory.status(forModules: [module]) == .installed else {
        throw StudioRecipeError.invalid("O modelo de transcrição ainda não está instalado. Tente instalar novamente.")
      }
      return await self.capabilities(localeIdentifier: localeIdentifier)
    }
  }

  func transcribe(requestId: String, uri: String, localeIdentifier: String = "pt-BR",
                  progress: @escaping (String, Double) -> Void) async throws -> [String: Any] {
    guard #available(iOS 26.0, macOS 26.0, *) else { throw StudioRecipeError.invalid("A transcrição local precisa do iOS 26 ou superior.") }
    guard let url = URL(string: uri), url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
      throw StudioRecipeError.invalid("O áudio deste take não está disponível neste aparelho.")
    }
    return try await run(requestId) {
      let module = try await self.module(localeIdentifier)
      guard await AssetInventory.status(forModules: [module]) == .installed else {
        throw StudioRecipeError.invalid("Instale o modelo deste idioma para transcrever localmente.")
      }
      try self.check(requestId)
      let audio = try await self.audioFile(url, id: requestId)
      defer { if audio.temporary { try? FileManager.default.removeItem(at: audio.url) } }
      let file = try AVAudioFile(forReading: audio.url)
      let duration = Double(file.length) / file.processingFormat.sampleRate
      guard duration.isFinite, duration > 0 else { throw StudioRecipeError.invalid("Este take não possui áudio para transcrever.") }
      let analyzer = SpeechAnalyzer(modules: [module])
      let results = Task { () throws -> [[String: Any]] in
        var segments: [[String: Any]] = []
        for try await result in module.results {
          try self.check(requestId)
          guard result.isFinal else { continue }
          let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
          guard !text.isEmpty, result.range.start.seconds.isFinite, result.range.end.seconds.isFinite else { continue }
          let start = min(duration, max(0, result.range.start.seconds))
          let end = min(duration, max(0, result.range.end.seconds))
          guard end > start else { continue }
          var words: [[String: Any]] = []
          for run in result.text.runs {
            guard let range = run.audioTimeRange, range.start.seconds.isFinite, range.end.seconds.isFinite else { continue }
            let value = String(result.text[run.range].characters).trimmingCharacters(in: .whitespacesAndNewlines)
            let wordStart = min(duration, max(0, range.start.seconds))
            let wordEnd = min(duration, max(0, range.end.seconds))
            if !value.isEmpty && wordEnd > wordStart { words.append(["text": value, "startSeconds": wordStart, "endSeconds": wordEnd]) }
          }
          segments.append(["text": text, "startSeconds": start, "endSeconds": end, "words": words])
          progress("transcribing", min(1, max(0, result.range.end.seconds / duration)))
        }
        return segments
      }
      progress("transcribing", 0)
      do {
        let segments = try await withTaskCancellationHandler(operation: {
          _ = try await analyzer.analyzeSequence(from: file)
          try self.check(requestId)
          try await analyzer.finalizeAndFinishThroughEndOfInput()
          return try await results.value
        }, onCancel: {
          results.cancel()
          Task { await analyzer.cancelAndFinishNow() }
        })
        try self.check(requestId)
        progress("transcribing", 1)
        return ["locale": module.selectedLocales.first?.identifier(.bcp47) ?? localeIdentifier,
                "segments": segments, "onDevice": true]
      } catch {
        results.cancel(); await analyzer.cancelAndFinishNow()
        throw error
      }
    }
  }

  private func audioFile(_ url: URL, id: String) async throws -> (url: URL, temporary: Bool) {
    if (try? AVAudioFile(forReading: url)) != nil { return (url, false) }
    // QuickTime/video containers may not be readable by CoreAudio directly.
    // Extract locally without changing the original, and delete only this copy.
    let asset = AVURLAsset(url: url)
    guard try await !asset.loadTracks(withMediaType: .audio).isEmpty,
          let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
      throw StudioRecipeError.invalid("Este take não possui áudio para transcrever.")
    }
    let output = FileManager.default.temporaryDirectory.appendingPathComponent("classfy-transcription-\(UUID().uuidString).m4a")
    exporter.outputURL = output; exporter.outputFileType = .m4a
    var finished = false
    defer { if !finished { try? FileManager.default.removeItem(at: output) } }
    await withTaskCancellationHandler(operation: {
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        exporter.exportAsynchronously { continuation.resume() }
      }
    }, onCancel: { exporter.cancelExport() })
    try check(id)
    guard exporter.status == .completed else { throw exporter.error ?? StudioRecipeError.invalid("Não foi possível ler o áudio deste take.") }
    finished = true
    return (output, true)
  }
}
