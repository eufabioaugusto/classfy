import AudioToolbox
import CoreMedia
import Foundation

enum SpeechCaptureTestError: Error { case failure(String) }
func requireSpeech(_ value: @autoclosure () -> Bool, _ message: String) throws {
  if !value() { throw SpeechCaptureTestError.failure(message) }
}

func speechPCM(_ values: [Float], ready: Bool = true) throws -> CMSampleBuffer {
  var format = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
    mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1,
    mBitsPerChannel: 32, mReserved: 0)
  var description: CMAudioFormatDescription?
  try requireSpeech(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &format,
    layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil,
    formatDescriptionOut: &description) == noErr, "PCM format")
  let data = values.withUnsafeBufferPointer { Data(buffer: $0) }
  var block: CMBlockBuffer?
  try requireSpeech(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
    blockLength: data.count, blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
    offsetToData: 0, dataLength: data.count, flags: 0, blockBufferOut: &block) == noErr, "PCM block")
  try requireSpeech(data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!,
    blockBuffer: block!, offsetIntoDestination: 0, dataLength: data.count) } == noErr, "PCM bytes")
  var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48_000),
    presentationTimeStamp: CMTime(value: 48_000, timescale: 48_000), decodeTimeStamp: .invalid)
  var sample: CMSampleBuffer?
  try requireSpeech(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: block,
    dataReady: ready, makeDataReadyCallback: nil, refcon: nil, formatDescription: description,
    sampleCount: values.count, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
    sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sample) == noErr, "PCM sample")
  return sample!
}

@main
struct StudioCaptureSpeechStateTests {
  static func main() throws {
    var state = StudioCaptureSpeechState(), cases = 0
    func passed(_ name: String) { cases += 1; print("PASS \(name)") }
    try requireSpeech(state.beginSegment() == nil, "disabled state cannot create a task")
    state.configure(sessionId: "reader-a", generation: 2, enabled: true)
    let first = state.beginSegment()!
    try requireSpeech(state.accepts(first) && first.segmentId == 1, "first exact task token")
    let event = state.event(["type": "result", "transcript": "Olá"])
    try requireSpeech(event["sessionId"] as? String == "reader-a" && event["generation"] as? Int == 2
      && event["sequence"] as? Int == 1 && event["segmentId"] as? Int == 1, "immutable callback identity")
    passed("task tokens and event identity preserve reader and capture generation")

    state.invalidate()
    let second = state.beginSegment()!
    try requireSpeech(!state.accepts(first) && state.accepts(second) && second.segmentId == 2,
      "late cancelled result is not a new utterance")
    try requireSpeech(state.event(["type": "status"])["sequence"] as? Int == 2, "sequence continues across utterances")
    passed("final/rotation and pause/resume create new segment, keep monotonic sequence")

    state.configure(sessionId: "reader-a", generation: 3, enabled: true)
    let camera = state.beginSegment()!
    try requireSpeech(!state.accepts(second) && camera.generation == 3 && camera.segmentId == 1
      && state.event([:])["sequence"] as? Int == 1, "new camera resets generation scope")
    state.configure(sessionId: "reader-b", generation: 3, enabled: true)
    let nextReader = state.beginSegment()!
    try requireSpeech(!state.accepts(camera) && nextReader.sessionId == "reader-b", "new project/script rejects old task")
    state.configure(sessionId: "reader-b", generation: 3, enabled: false)
    try requireSpeech(!state.accepts(nextReader) && state.beginSegment() == nil, "disabled reader cancels callbacks")
    passed("camera, project and reader cancellation reject stale recognition")

    for identity in ["", String(repeating: "x", count: 129)] {
      state.configure(sessionId: identity, generation: 4, enabled: true)
      try requireSpeech(!state.enabled && state.beginSegment() == nil, "invalid reader scope")
    }
    passed("empty and unbounded reader identity cannot activate recognition")

    var recovery = StudioCaptureSpeechRecovery()
    for moment in [0.0, 60, 600, 3600] {
      try requireSpeech(recovery.failed(now: moment) == .awaitActivity, "silent task end is idle, not terminal")
      try requireSpeech(!recovery.noteAudio(rms: 0, now: moment + 1), "silence does not spin new tasks")
      try requireSpeech(!recovery.terminal && recovery.consecutiveFailures == 0, "long pause consumes no failure budget")
    }
    try requireSpeech(recovery.noteAudio(rms: 0.1, now: 3601), "fresh capture audio resumes after arbitrarily long pause")
    try requireSpeech(!recovery.noteAudio(rms: 0.1, now: 3601.1), "one audio window starts only one task")
    passed("long silence waits without busy-loop, fresh PCM resumes once")

    var noisyPause = StudioCaptureSpeechRecovery()
    for moment in [10.0, 70, 130, 190] {
      _ = noisyPause.noteAudio(rms: 0.1, now: moment)
      try requireSpeech(noisyPause.failed(now: moment + 0.1, noSpeech: true) == .awaitActivity,
        "documented no-speech is natural pause despite room noise")
      try requireSpeech(!noisyPause.noteAudio(rms: 0.1, now: moment + 0.5), "no-speech backs off instead of busy loop")
      try requireSpeech(noisyPause.noteAudio(rms: 0.1, now: moment + 1.2)
        && noisyPause.consecutiveFailures == 0 && !noisyPause.terminal, "voice can resume after repeated noisy pauses")
    }
    passed("documented no-speech during room noise cannot exhaust retry budget")

    try requireSpeech(recovery.failed(now: 3601.2) == .retry(after: 0.25), "first active failure is bounded backoff")
    try requireSpeech(recovery.failed(now: 3601.3) == .retry(after: 0.5), "second active failure backs off longer")
    try requireSpeech(recovery.failed(now: 3601.4) == .terminal, "real active failure cannot loop indefinitely")
    try requireSpeech(!recovery.noteAudio(rms: 0.1, now: 3601.5), "terminal failure cannot restart on noise")
    recovery.reset()
    _ = recovery.noteAudio(rms: 0.1, now: 3602)
    _ = recovery.failed(now: 3602.1)
    recovery.noteResult()
    try requireSpeech(recovery.failed(now: 3602.2) == .retry(after: 0.25), "actual transcript resets failure budget")
    try requireSpeech(recovery.waitAfterEmptyFinal(now: 3602.3), "empty final keeps a cooldown even with recent room noise")
    try requireSpeech(recovery.waitAfterEmptyFinal(now: 3610), "empty final after silence waits for fresh audio")
    try requireSpeech(!recovery.noteAudio(rms: 0.1, now: 3610.1)
      && recovery.noteAudio(rms: 0.1, now: 3610.4), "minimum wakeup cooldown prevents fast task loop")
    passed("active recognition failures remain bounded; result and explicit reset recover")

    var availability = StudioCaptureSpeechRecovery()
    availability.waitForAvailability(now: 20)
    try requireSpeech(availability.noteAudio(rms: 0.1, now: 20.6) && availability.awaitingActivity,
      "wake-up intent remains until a real task starts")
    try requireSpeech(availability.noteAudio(rms: 0.1, now: 20.9) && availability.awaitingActivity,
      "failed availability attempt cannot consume recovery intent")
    availability.started()
    try requireSpeech(!availability.awaitingActivity && !availability.noteAudio(rms: 0.1, now: 21.2),
      "successful task consumes intent once")
    passed("temporary availability retains intent until request creation")

    func timed(_ text: String, start: Double) -> [StudioCaptureSpeechTranscript.Segment] {
      let value = text as NSString
      var location = 0
      return text.split(separator: " ").enumerated().map { index, word in
        let range = value.range(of: String(word), options: [], range: NSRange(location: location, length: value.length - location))
        location = NSMaxRange(range)
        return .init(timestamp: start + Double(index) * 0.4, duration: 0.3, range: range)
      }
    }
    var rolling = StudioCaptureSpeechTranscript()
    let firstText = "Olá, creator com atenção."
    try requireSpeech(rolling.append(formattedString: firstText, segments: timed(firstText, start: 0)) == firstText,
      "UTF16 ranges preserve accents and punctuation")
    let secondText = "Depois aprendemos áudio."
    let secondProvisional = timed(secondText, start: 0).map {
      StudioCaptureSpeechTranscript.Segment(timestamp: 0, duration: 0, range: $0.range)
    }
    try requireSpeech(rolling.append(formattedString: secondText, segments: secondProvisional) == nil
      && rolling.heldResult && !rolling.timeUsable && rolling.fullWordCount == 4
      && rolling.currentResultWordCount == 3 && rolling.segmentCount == 4,
      "provisional second utterance holds publication and preserves trusted first paragraph")
    try requireSpeech(rolling.append(formattedString: secondText, segments: timed(secondText, start: 4)) == firstText + " " + secondText,
      "new utterance at later audio times preserves old prefix")
    let revisedText = "Depois cuidamos do áudio."
    try requireSpeech(rolling.append(formattedString: revisedText, segments: timed(revisedText, start: 4)) == firstText + " " + revisedText,
      "overlapping interim revision replaces instead of duplicating")
    let thirdText = "Finalizamos esta aula."
    try requireSpeech(rolling.append(formattedString: thirdText, segments: timed(thirdText, start: 8)) == firstText + " " + revisedText + " " + thirdText,
      "three utterances remain cumulative in the same task")
    passed("timestamped utterances preserve prefix and revise overlap without duplicate words")

    let provisional = timed("Hipótese provisória", start: 0).map {
      StudioCaptureSpeechTranscript.Segment(timestamp: 0, duration: 0, range: $0.range)
    }
    try requireSpeech(rolling.append(formattedString: "Hipótese provisória", segments: provisional) == nil
      && rolling.heldResult && !rolling.timeUsable && rolling.firstTimestamp == 0
      && rolling.fullWordCount == 11 && rolling.currentResultWordCount == 2,
      "all-zero provisional times hold output without erasing timed history")
    let rollback = "Correção mais antiga."
    try requireSpeech(rolling.append(formattedString: rollback, segments: timed(rollback, start: 1)) == "Olá, creator " + rollback
      && !rolling.heldResult, "valid earlier overlap replaces only the old overlapping span")
    rolling.reset()
    try requireSpeech(rolling.append(formattedString: secondText, segments: timed(secondText, start: 0)) == secondText,
      "a real new task cannot inherit the previous task transcript")
    passed("provisional timing holds history, valid timing replaces overlap, and new task resets history")

    let voice = try speechPCM((0..<480).map { sin(Float($0) * 2 * .pi / 48) * 0.5 })
    var received: [CMSampleBuffer] = []
    try requireSpeech(StudioCaptureSpeechAudioRoute.append(voice, enabled: true, receive: { received.append($0) }),
      "actual ready PCM sample can be appended")
    try requireSpeech(received.count == 1 && received[0] === voice, "same sample, no format copy or second microphone")
    let silence = try speechPCM(Array(repeating: 0, count: 480))
    try requireSpeech(StudioCaptureSpeechAudioRoute.append(silence, enabled: true, receive: { received.append($0) }),
      "silence is real audio, not reason to reset transcript")
    try requireSpeech(CMTimeCompare(CMSampleBufferGetPresentationTimeStamp(received[0]),
      CMSampleBufferGetPresentationTimeStamp(voice)) == 0, "timestamps remain from capture")
    passed("ready speech and silence use original PCM buffers and timestamps")

    let unready = try speechPCM([0.1, 0.2], ready: false)
    try requireSpeech(!StudioCaptureSpeechAudioRoute.append(unready, enabled: true, receive: { received.append($0) }),
      "incomplete samples cannot reach Speech")
    try requireSpeech(!StudioCaptureSpeechAudioRoute.append(voice, enabled: false, receive: { received.append($0) }),
      "paused/inactive task receives no queued audio")
    CMSampleBufferInvalidate(voice)
    try requireSpeech(!StudioCaptureSpeechAudioRoute.append(voice, enabled: true, receive: { received.append($0) }),
      "invalidated sample is rejected")
    try requireSpeech(received.count == 2, "blocked samples invoke no append callback")
    passed("pause, incomplete and invalid buffers never reach the recognition request")
    print("\(cases)/\(cases) native speech token/PCM fixture cases passed (no microphone or permission prompt).")
  }
}
