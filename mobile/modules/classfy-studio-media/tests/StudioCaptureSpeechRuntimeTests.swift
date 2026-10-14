import AudioToolbox
import CoreMedia
import Foundation

enum SpeechRuntimeFixtureError: Error { case failure(String) }
func runtimeRequire(_ value: @autoclosure () -> Bool, _ message: String) throws {
  if !value() { throw SpeechRuntimeFixtureError.failure(message) }
}
func runtimePCM(_ ordinal: Int) throws -> CMSampleBuffer {
  var format = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: 4, mFramesPerPacket: 1,
    mBytesPerFrame: 4, mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0)
  var description: CMAudioFormatDescription?
  try runtimeRequire(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &format, layoutSize: 0,
    layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description) == noErr, "format")
  let data = Array(repeating: Float(0.1), count: 480).withUnsafeBufferPointer { Data(buffer: $0) }
  var block: CMBlockBuffer?
  try runtimeRequire(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
    blockLength: data.count, blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0,
    dataLength: data.count, flags: 0, blockBufferOut: &block) == noErr, "block")
  try runtimeRequire(data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!,
    blockBuffer: block!, offsetIntoDestination: 0, dataLength: data.count) } == noErr, "bytes")
  var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48_000),
    presentationTimeStamp: CMTime(value: Int64(ordinal * 480), timescale: 48_000), decodeTimeStamp: .invalid)
  var sample: CMSampleBuffer?
  try runtimeRequire(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: block, dataReady: true,
    makeDataReadyCallback: nil, refcon: nil, formatDescription: description, sampleCount: 480,
    sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
    sampleBufferOut: &sample) == noErr, "sample")
  try runtimeRequire(CMSampleBufferGetTotalSampleSize(sample!) == 0 && CMBlockBufferGetDataLength(block!) == 1920,
    "valid PCM fixture exercises zero aggregate size with real block data")
  return sample!
}
func runtimeResult(_ text: String, start: Double = 0, final: Bool = false,
                   zeroTimes: Bool = false) -> SFSpeechRecognitionResult {
  let string = text as NSString
  let matches = try! NSRegularExpression(pattern: "\\S+").matches(in: text, range: NSRange(location: 0, length: string.length))
  let segments = matches.enumerated().map { index, match in
    SFTranscriptionSegment(substring: string.substring(with: match.range), substringRange: match.range,
      timestamp: zeroTimes ? 0 : start + Double(index) * 0.4, duration: zeroTimes ? 0 : 0.3)
  }
  return SFSpeechRecognitionResult(SFTranscription(formattedString: text, segments: segments), final: final)
}
final class SpeechRuntimeEvents: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [[String: Any]] = []
  func append(_ value: [String: Any]) { lock.lock(); defer { lock.unlock() }; values.append(value) }
  func all() -> [[String: Any]] { lock.lock(); defer { lock.unlock() }; return values }
  func results() -> [[String: Any]] { all().filter { $0["type"] as? String == "result" } }
}

@main
struct StudioCaptureSpeechRuntimeTests {
  static func wait(_ message: String, seconds: Double = 2.5, _ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(seconds)
    while !condition() {
      try runtimeRequire(Date() < deadline, message)
      try await Task.sleep(nanoseconds: 10_000_000)
    }
  }
  static func configure(_ speech: StudioCaptureSpeech, queue: DispatchQueue, generation: Int = 7, enabled: Bool = true) {
    queue.sync { speech.configure(enabled: enabled, sessionId: "same-reader", locale: "pt-BR",
      generation: generation, running: true, audioAvailable: true) }
  }
  @discardableResult static func feed(_ speech: StudioCaptureSpeech, queue: DispatchQueue, ordinal: Int) throws -> UInt {
    let sample = try runtimePCM(ordinal), measurement = StudioCaptureAudioPCM.measure(sample)
    try runtimeRequire(measurement != nil, "actual PCM monitor measures voice")
    queue.sync { speech.append(sample, measurement: measurement) }
    return UInt(bitPattern: Unmanaged.passUnretained(sample).toOpaque())
  }
  static func transcriptChecks() throws {
    var transcript = StudioCaptureSpeechTranscript()
    func append(_ text: String, _ start: Double) -> String? {
      let result = runtimeResult(text, start: start).bestTranscription
      return transcript.append(formattedString: text,
        segments: result.segments.map { .init(timestamp: $0.timestamp, duration: $0.duration, range: $0.substringRange) })
    }
    try runtimeRequire(append("Primeira frase.", 0) == "Primeira frase.", "initial utterance")
    try runtimeRequire(append("Segunda parcial", 2) == "Primeira frase. Segunda parcial", "later utterance preserves first")
    try runtimeRequire(append("Segunda correta.", 2) == "Primeira frase. Segunda correta.", "revision replaces overlap")
    try runtimeRequire(append("Olá 👋", 4) == "Primeira frase. Segunda correta. Olá 👋", "third utterance uses UTF16 ranges")
    try runtimeRequire(transcript.segmentCount == 6 && transcript.firstTimestamp == 0
      && abs((transcript.lastEnd ?? 0) - 4.7) < 0.0001, "bounded timing telemetry")
    let provisional = runtimeResult("Sem tempo ainda.", zeroTimes: true).bestTranscription
    try runtimeRequire(transcript.append(formattedString: provisional.formattedString,
      segments: provisional.segments.map { .init(timestamp: $0.timestamp, duration: $0.duration, range: $0.substringRange) }) == nil,
      "provisional times cannot emit reduced text after trusted paragraphs")
    try runtimeRequire(transcript.heldResult && !transcript.timeUsable && transcript.currentResultWordCount == 3
      && transcript.fullWordCount == 6 && transcript.segmentCount == 6,
      "held provisional result exposes new count while preserving trusted word history")
    try runtimeRequire(append("Retomada válida.", 6) == "Primeira frase. Segunda correta. Olá 👋 Retomada válida."
      && transcript.timeUsable && !transcript.heldResult && transcript.firstTimestamp == 0,
      "valid timing after provisional hold preserves the trusted prefix")
    try runtimeRequire(append("Palavra", 0) == nil && transcript.heldResult && !transcript.timeUsable
      && transcript.currentResultWordCount == 1 && transcript.fullWordCount == 8,
      "single segment at zero is held without replacing trusted history")
    try runtimeRequire(append("Tempo restaurado.", 7) == "Primeira frase. Segunda correta. Olá 👋 Retomada válida. Tempo restaurado."
      && transcript.timeUsable, "trusted timing after single-word hold keeps all paragraphs")
    transcript.reset()
    try runtimeRequire(transcript.append(formattedString: provisional.formattedString,
      segments: provisional.segments.map { .init(timestamp: $0.timestamp, duration: $0.duration, range: $0.substringRange) }) == "Sem tempo ainda."
      && !transcript.heldResult && !transcript.timeUsable && transcript.currentResultWordCount == 3,
      "all-zero initial task retains raw current text when no trusted prefix exists")
    try runtimeRequire(append("Novo trecho", 0) == "Novo trecho" && transcript.segmentCount == 2, "new task resets history")
    print("PASS real transcript helper: trusted prefix survives provisional hold; initial raw fallback, correction, UTF16 and reset")
  }
  static func availabilityAndTranscriptChecks() async throws {
    let fake = FakeSpeechHarness.shared; fake.reset()
    let queue = DispatchQueue(label: "fixture.speech.availability"), speech = StudioCaptureSpeech(queue: queue)
    let events = SpeechRuntimeEvents(); speech.onEvent = { events.append($0) }
    configure(speech, queue: queue)
    defer { configure(speech, queue: queue, enabled: false) }
    try runtimeRequire(fake.allTasks().count == 1, "one initial task")
    let first = fake.allTasks()[0]
    first.emit(runtimeResult("Primeira frase.", start: 0)); queue.sync {}
    let trustedCount = events.results().count
    first.emit(runtimeResult("Segunda parcial", zeroTimes: true)); queue.sync {}
    try runtimeRequire(events.results().count == trustedCount
      && events.results().last?["transcript"] as? String == "Primeira frase." && fake.allTasks().count == 1,
      "actual receive holds transient p2 zero timing without reduced result or task rollover")
    first.emit(runtimeResult("Segunda parcial", start: 2)); queue.sync {}
    first.emit(runtimeResult("Segunda correta.", start: 2)); queue.sync {}
    first.emit(runtimeResult("Terceira frase.", start: 4)); queue.sync {}
    try runtimeRequire(events.results().last?["transcript"] as? String == "Primeira frase. Segunda correta. Terceira frase.",
      "actual receive accumulates same-task utterances and replaces current overlap")
    fake.setAvailable(false)
    first.emit(runtimeResult("Terceira frase.", start: 4, final: true)); queue.sync {}
    try runtimeRequire(fake.allTasks().count == 1 && events.all().contains { $0["code"] as? String == "awaiting_speech_service" },
      "final plus unavailable enters recoverable pause")
    let sameTaskResults = events.results()
    try runtimeRequire(sameTaskResults.count == 5 && sameTaskResults.allSatisfy {
      $0["segmentId"] as? Int == 1 && $0["generation"] as? Int == 7 && $0["sessionId"] as? String == "same-reader"
    }, "all same-task paragraphs and final preserve immutable native token scope")
    let emission: [String: Any] = ["passed": true, "sourceSHA256": fixtureProductionSpeechSHA256,
      "scope": "production Speech.receive with synthetic framework results; unchanged native body",
      "script": "Primeira frase. Segunda correta. Terceira frase.", "segmentId": 1, "generation": 7,
      "heldProvisionalSameTask": true, "frameworkInputCount": 6, "emittedResultCount": sameTaskResults.count,
      "events": events.all()]
    let emissionData = try JSONSerialization.data(withJSONObject: emission, options: [.prettyPrinted, .sortedKeys])
    try emissionData.write(to: URL(fileURLWithPath: "/tmp/classfy-speech-native-fix-events.json"), options: .atomic)
    print("PASS native same-task event artifact /tmp/classfy-speech-native-fix-events.json")
    var sentIdentities: [UInt] = []
    for ordinal in 1...300 { sentIdentities.append(try feed(speech, queue: queue, ordinal: ordinal)) }
    try runtimeRequire(fake.allTasks().count == 1, "voice while unavailable does not spin tasks")
    fake.setAvailable(true)
    try await wait("availability recovery creates task B without configure/REC restart") { fake.allTasks().count == 2 }
    let second = fake.allTasks()[1], replay = second.request.receivedPTS()
    try runtimeRequire(!replay.isEmpty && replay.count <= 125 && Set(replay).count == replay.count,
      "pending PCM is bounded to1.25s and replayed once")
    let sent = (1...300).map { Double($0) / 100 }
    try runtimeRequire(replay == Array(sent.suffix(replay.count)), "replay preserves latest actual PCM order/PTS")
    try runtimeRequire(second.request.receivedIdentities() == Array(sentIdentities.suffix(replay.count)),
      "replay forwards the exact original sample objects without resampling/copy")
    try feed(speech, queue: queue, ordinal: 301)
    try runtimeRequire(second.request.receivedPTS().count == replay.count + 1
      && Set(second.request.receivedPTS()).count == second.request.receivedPTS().count, "next live PCM is appended once")
    let before = events.results().count
    first.emit(runtimeResult("Evento antigo", final: true)); queue.sync {}
    try runtimeRequire(events.results().count == before && fake.allTasks().count == 2, "stale callback cannot publish or cancel B")
    second.emit(runtimeResult("Leitura provisória.", zeroTimes: true)); queue.sync {}
    try runtimeRequire(events.results().last?["transcript"] as? String == "Leitura provisória.",
      "actual new task permits raw all-zero initial text without old trusted prefix")
    second.emit(runtimeResult("Novo parágrafo.", start: 0)); queue.sync {}
    let result = events.results().last!
    try runtimeRequire(result["transcript"] as? String == "Novo parágrafo." && result["sessionId"] as? String == "same-reader"
      && result["generation"] as? Int == 7 && result["segmentId"] as? Int == 2, "B resets transcript and preserves owner/generation")
    try runtimeRequire(!events.all().contains { $0["status"] as? String == "unavailable" || $0["status"] as? String == "error" },
      "transient availability does not become terminal")
    try runtimeRequire(fake.promptCount() == 0 && fake.allTasks().allSatisfy {
      $0.request.requiresOnDeviceRecognition && $0.request.shouldReportPartialResults
    }, "no prompt and every request requires local recognition")
    print("PASS exact Speech body: final A → unavailable → voice/ring → available retry → B; scoped transcript/PCM/local mode")
  }
  static func cancellationChecks() async throws {
    for changedGeneration in [false, true] {
      let fake = FakeSpeechHarness.shared; fake.reset()
      let queue = DispatchQueue(label: "fixture.speech.scope"), speech = StudioCaptureSpeech(queue: queue)
      let events = SpeechRuntimeEvents(); speech.onEvent = { events.append($0) }
      configure(speech, queue: queue)
      let old = fake.allTasks()[0]
      fake.setAvailable(false); old.emit(runtimeResult("Final antigo", final: true)); queue.sync {}
      try feed(speech, queue: queue, ordinal: 1)
      configure(speech, queue: queue, generation: changedGeneration ? 8 : 7, enabled: changedGeneration)
      fake.setAvailable(true)
      if changedGeneration {
        try await wait("new generation owns its retry") { fake.allTasks().count == 2 }
        try runtimeRequire(fake.allTasks()[1].request.receivedPTS().isEmpty, "new generation discards pending PCM")
        fake.allTasks()[1].emit(runtimeResult("Geração nova")); queue.sync {}
        try runtimeRequire(events.results().last?["generation"] as? Int == 8, "new event owns new generation")
      } else {
        try await Task.sleep(nanoseconds: 650_000_000)
        try runtimeRequire(fake.allTasks().count == 1, "disabled lifecycle cancels availability retry")
      }
      let before = events.results().count
      old.emit(runtimeResult("Callback atrasado", final: true)); queue.sync {}
      try runtimeRequire(events.results().count == before, "old final discarded after disable/generation change")
      configure(speech, queue: queue, generation: changedGeneration ? 8 : 7, enabled: false)
    }
    print("PASS exact Speech lifecycle: disable/generation discard retry, pending PCM and stale callbacks")
  }
  static func main() async {
    do {
      try transcriptChecks()
      try await availabilityAndTranscriptChecks()
      try await cancellationChecks()
      print("OK source-real Speech runtime fixtures: no microphone, prompt or live SDK recognition")
    } catch {
      fputs("FAIL source-real Speech runtime fixture: \(error)\n", stderr)
      exit(1)
    }
  }
}
