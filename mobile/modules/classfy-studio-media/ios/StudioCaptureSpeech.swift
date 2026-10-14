import CoreMedia
import AudioToolbox
import Foundation
import Speech

/// A read-only branch of AVCaptureAudioDataOutput. It never owns a microphone,
/// an AVAudioEngine, the AVAudioSession or MovieFileOutput. All lifecycle,
/// buffers and callbacks are serialized on the SAME capture audio queue.
final class StudioCaptureSpeech: @unchecked Sendable {
  private let queue: DispatchQueue
  private var state = StudioCaptureSpeechState()
  private var localeIdentifier = "pt-BR"
  private var requestedEnabled = false
  private var running = false
  private var audioAvailable = false
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var rotation: DispatchWorkItem?
  private var retry: DispatchWorkItem?
  private var recovery = StudioCaptureSpeechRecovery()
  private var transcript = StudioCaptureSpeechTranscript()
  private var availabilityRetries = 0
  private var pendingAudio: [(sample: CMSampleBuffer, duration: Double, bytes: Int)] = []
  private var pendingAudioDuration = 0.0, pendingAudioBytes = 0
  private var lifecycle = 0
  private var lastStatus: String?
  #if DEBUG
  private var diagnosticTrace: [[String: Any]] = []
  private var diagnosticLastWrite = 0.0
  private let diagnosticStartedAt = ProcessInfo.processInfo.systemUptime
  private var diagnosticTaskStarts = 0, diagnosticResults = 0, diagnosticReplayedBuffers = 0
  private static let diagnosticQueue = DispatchQueue(label: "classfy.studio.speech.diagnostic", qos: .utility)
  #endif
  var onEvent: (([String: Any]) -> Void)?

  init(queue: DispatchQueue) { self.queue = queue }
  deinit { rotation?.cancel(); retry?.cancel(); request?.endAudio(); task?.cancel() }

  static func requestPermission(_ completion: @escaping ([String: Any]) -> Void) {
    let permission = SFSpeechRecognizer.authorizationStatus()
    let result: (SFSpeechRecognizerAuthorizationStatus) -> [String: Any] = { value in
      ["granted": value == .authorized, "canAskAgain": value == .notDetermined || value == .authorized]
    }
    // The only place that can show the system prompt. Native view props and
    // recording delegates merely inspect permission and never request it.
    guard permission == .notDetermined else { completion(result(permission)); return }
    guard Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") is String else {
      completion(["granted": false, "canAskAgain": false]); return
    }
    SFSpeechRecognizer.requestAuthorization { completion(result($0)) }
  }

  func configure(enabled: Bool, sessionId: String, locale: String, generation: Int,
                 running: Bool, audioAvailable: Bool) {
    let identityChanged = state.sessionId != sessionId || state.generation != generation || localeIdentifier != locale
    let activationChanged = requestedEnabled != enabled || self.running != running || self.audioAvailable != audioAvailable
    guard identityChanged || activationChanged else { return }
    stopTask()
    clearPendingAudio(); transcript.reset(); availabilityRetries = 0
    if localeIdentifier != locale { recognizer = nil }
    self.requestedEnabled = enabled; self.running = running; self.audioAvailable = audioAvailable
    localeIdentifier = locale; recovery.reset(); lastStatus = nil
    state.configure(sessionId: sessionId, generation: generation, enabled: enabled)
    guard enabled, state.enabled else { if !sessionId.isEmpty { status("paused", code: "disabled") }; return }
    guard running else { status("paused", code: "capture_inactive"); return }
    guard audioAvailable else { status("unavailable", code: "capture_audio_unavailable"); return }
    startSegment()
  }

  func append(_ sampleBuffer: CMSampleBuffer, measurement: StudioCaptureAudioMeasurement?) {
    guard requestedEnabled, running, audioAvailable, state.enabled else { return }
    let rms = measurement?.channels.filter { $0.count > 0 }.map { sqrt($0.squaredSum / Double($0.count)) }.max()
    let hadRequest = request != nil
    let shouldWake = recovery.noteAudio(rms: rms, now: ProcessInfo.processInfo.systemUptime)
    if request == nil, !recovery.terminal { retainPendingAudio(sampleBuffer) }
    if shouldWake, request == nil, retry == nil { startSegment() }
    // A newly started request drains the ring, including this exact sample.
    // Do not append it again after replaying it.
    if !hadRequest, request != nil { return }
    guard let request else { return }
    // Apple accepts CMSampleBuffer directly; no conversion, new microphone
    // tap or session mutation is necessary beside the movie capture output.
    StudioCaptureSpeechAudioRoute.append(sampleBuffer,
      enabled: requestedEnabled && running && state.token != nil,
      receive: { request.appendAudioSampleBuffer($0) })
  }

  private func status(_ value: String, code: String? = nil) {
    if ["denied", "unavailable", "error"].contains(value) { clearPendingAudio() }
    guard lastStatus != value || code != nil else { return }
    lastStatus = value
    var payload: [String: Any] = ["type": "status", "status": value]
    if let code { payload["code"] = code }
    trace(reason: code ?? value, status: value)
    onEvent?(state.event(payload))
  }

  private func stopTask() {
    // Invalidate first: cancel/endAudio can synchronously enqueue callbacks.
    lifecycle += 1; state.invalidate()
    rotation?.cancel(); rotation = nil; retry?.cancel(); retry = nil
    let previousRequest = request; request = nil
    let previousTask = task; task = nil
    previousRequest?.endAudio(); previousTask?.cancel()
  }

  private func clearPendingAudio() {
    pendingAudio = []; pendingAudioDuration = 0; pendingAudioBytes = 0
  }
  private func retainPendingAudio(_ sample: CMSampleBuffer) {
    StudioCaptureSpeechAudioRoute.append(sample, enabled: true) { sample in
      guard let format = CMSampleBufferGetFormatDescription(sample),
        let audio = CMAudioFormatDescriptionGetStreamBasicDescription(format), audio.pointee.mSampleRate > 0,
        audio.pointee.mSampleRate.isFinite else { return }
      let duration = Double(CMSampleBufferGetNumSamples(sample)) / audio.pointee.mSampleRate
      // Ready PCM samples need not have a per-sample size array. Their real
      // block still owns the audio bytes (including capture's native buffers).
      let declaredBytes = CMSampleBufferGetTotalSampleSize(sample)
      let bytes = declaredBytes > 0 ? declaredBytes
        : CMSampleBufferGetDataBuffer(sample).map { CMBlockBufferGetDataLength($0) } ?? 0
      guard duration.isFinite, duration > 0, duration <= 1.25, bytes > 0, bytes <= 786_432 else { return }
      pendingAudio.append((sample, duration, bytes)); pendingAudioDuration += duration; pendingAudioBytes += bytes
      while pendingAudioDuration > 1.25 || pendingAudioBytes > 786_432 || pendingAudio.count > 256 {
        let removed = pendingAudio.removeFirst(); pendingAudioDuration -= removed.duration; pendingAudioBytes -= removed.bytes
      }
    }
  }
  private func scheduleRestart(after delay: Double) {
    guard retry == nil else { return }
    let expectedLifecycle = lifecycle, sessionId = state.sessionId, generation = state.generation
    let retry = DispatchWorkItem { [weak self] in
      guard let self, self.lifecycle == expectedLifecycle, self.state.sessionId == sessionId,
        self.state.generation == generation, self.requestedEnabled, self.running, self.audioAvailable,
        self.state.enabled, self.request == nil else { return }
      self.retry = nil; self.startSegment()
    }
    self.retry = retry
    queue.asyncAfter(deadline: .now() + delay, execute: retry)
  }

  private func trace(reason: String, status: String? = nil, error: NSError? = nil) {
    #if DEBUG
    let now = ProcessInfo.processInfo.systemUptime
    var entry: [String: Any] = ["reason": reason, "elapsedSeconds": max(0, now - diagnosticStartedAt),
      "segmentId": state.segmentId, "wordCount": transcript.fullWordCount,
      "currentResultWordCount": transcript.currentResultWordCount, "fullWordCount": transcript.fullWordCount,
      "timeUsable": transcript.timeUsable, "timingFallback": transcript.fallbackReason as Any? ?? NSNull(),
      "heldResult": transcript.heldResult,
      "currentFirstTimestamp": transcript.currentFirstTimestamp as Any? ?? NSNull(),
      "currentLastEnd": transcript.currentLastEnd as Any? ?? NSNull(),
      "firstTimestamp": transcript.firstTimestamp as Any? ?? NSNull(), "lastEnd": transcript.lastEnd as Any? ?? NSNull(),
      "taskPresent": task != nil, "requestPresent": request != nil, "awaitingActivity": recovery.awaitingActivity,
      "terminal": recovery.terminal, "available": recognizer?.isAvailable as Any? ?? NSNull(),
      "taskStarts": diagnosticTaskStarts, "results": diagnosticResults, "replayedBuffers": diagnosticReplayedBuffers,
      "pendingBufferCount": pendingAudio.count, "pendingAudioSeconds": pendingAudioDuration,
      "pendingAudioBytes": pendingAudioBytes]
    if let status { entry["status"] = status }
    if let error {
      entry["errorCode"] = error.code
      entry["errorDomain"] = ["kLSRErrorDomain", "kAFAssistantErrorDomain"].contains(error.domain) ? error.domain : "other"
    }
    diagnosticTrace.append(entry)
    if diagnosticTrace.count > 80 { diagnosticTrace.removeFirst(diagnosticTrace.count - 80) }
    // Bounded, development-only metadata. Never retain transcript/PCM in the
    // file or emit reader identities. At most one cache write per second.
    if now - diagnosticLastWrite >= 1,
      let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
      let data = try? JSONSerialization.data(withJSONObject: ["version": 1, "trace": diagnosticTrace]) {
      Self.diagnosticQueue.async {
        try? data.write(to: cache.appendingPathComponent("classfy-studio-native-speech-trace.json"), options: .atomic)
      }
      diagnosticLastWrite = now
    }
    #endif
  }

  private func startSegment() {
    guard requestedEnabled, running, audioAvailable, state.enabled, !recovery.terminal, request == nil, task == nil else { return }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      status("denied", code: "speech_permission_required"); return
    }
    guard let recognizer = self.recognizer ?? SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)) else {
      status("unavailable", code: "speech_locale_unavailable"); return
    }
    self.recognizer = recognizer
    // Never silently upload live audio. Unsupported languages/devices retain
    // the recorder normally and report an explicit auxiliary-reader status.
    guard recognizer.supportsOnDeviceRecognition else {
      status("unavailable", code: "on_device_unavailable"); return
    }
    guard recognizer.isAvailable else {
      availabilityRetries = min(4, availabilityRetries + 1)
      recovery.waitForAvailability(now: ProcessInfo.processInfo.systemUptime)
      status("paused", code: "awaiting_speech_service")
      scheduleRestart(after: min(2, 0.5 * Double(availabilityRetries)))
      return
    }
    retry?.cancel(); retry = nil; availabilityRetries = 0
    guard let token = state.beginSegment() else { return }
    transcript.reset()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = true
    request.taskHint = .dictation
    self.recognizer = recognizer; self.request = request
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      // Framework callback queues are not capture queues. Return to the
      // owner before touching the request or checking its immutable token.
      self?.queue.async { [weak self] in self?.receive(result: result, error: error, token: token) }
    }
    recovery.started()
    for pending in pendingAudio {
      StudioCaptureSpeechAudioRoute.append(pending.sample, enabled: true, receive: { request.appendAudioSampleBuffer($0) })
    }
    #if DEBUG
    diagnosticTaskStarts += 1; diagnosticReplayedBuffers += pendingAudio.count
    #endif
    clearPendingAudio()
    lastStatus = nil; status("listening")
    // Recognition tasks are finite. Rotate before the documented one-minute
    // limit; segmentId makes the transcript reset explicit to the matcher.
    let rotation = DispatchWorkItem { [weak self] in
      guard let self, self.state.accepts(token) else { return }
      self.stopTask(); self.startSegment()
    }
    self.rotation = rotation
    queue.asyncAfter(deadline: .now() + 50, execute: rotation)
  }

  private func receive(result: SFSpeechRecognitionResult?, error: Error?, token: StudioCaptureSpeechToken) {
    guard state.accepts(token), requestedEnabled, running else { return }
    if let result {
      let current = result.bestTranscription
      let currentText = current.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
      let text = transcript.append(formattedString: current.formattedString,
        segments: current.segments.map { .init(timestamp: $0.timestamp, duration: $0.duration, range: $0.substringRange) })
      if !currentText.isEmpty {
        recovery.noteResult()
        #if DEBUG
        diagnosticResults += 1
        #endif
      }
      if let text, !currentText.isEmpty {
        trace(reason: result.isFinal ? "final_result" : "partial_result")
        onEvent?(state.event(["type": "result", "transcript": text, "isFinal": result.isFinal]))
      } else if !currentText.isEmpty {
        trace(reason: transcript.heldResult ? "held_transcription_timing" : "invalid_transcription_timing")
      }
      if result.isFinal {
        stopTask()
        if currentText.isEmpty && recovery.waitAfterEmptyFinal(now: ProcessInfo.processInfo.systemUptime) {
          status("paused", code: "awaiting_speech")
        } else { startSegment() }
        return
      }
    }
    guard let error else { return }
    stopTask()
    let retryDelay: Double
    let nativeError = error as NSError
    trace(reason: "recognition_error", error: nativeError)
    // Missing assets / disabled dictation are not natural silence, and an
    // authorization error must never silently reactivate the recognizer.
    if nativeError.domain == "kLSRErrorDomain", [102, 201].contains(nativeError.code) {
      status("unavailable", code: "on_device_unavailable"); return
    }
    if nativeError.domain == "kAFAssistantErrorDomain", nativeError.code == 1700 {
      status("denied", code: "speech_permission_required"); return
    }
    // Apple documents this domain/code in SFSpeechRecognitionTask.h. Treat it
    // as a pause, including when room noise happens to exceed the RMS floor.
    let noSpeech = nativeError.domain == "kAFAssistantErrorDomain" && nativeError.code == 1110
    switch recovery.failed(now: ProcessInfo.processInfo.systemUptime, noSpeech: noSpeech) {
    case .awaitActivity:
      status("paused", code: "awaiting_speech"); return
    case .terminal:
      status("error", code: "speech_engine_\(nativeError.code)"); return
    case .retry(let after): retryDelay = after
    }
    // No-speech/end-of-utterance failures can be transient. Bounded retries
    // recover without restarting REC or creating a second live audio owner.
    scheduleRestart(after: retryDelay)
  }
}
