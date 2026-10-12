import CoreMedia
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
  private var lifecycle = 0
  private var lastStatus: String?
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
    if recovery.noteAudio(rms: rms, now: ProcessInfo.processInfo.systemUptime) { startSegment() }
    guard let request else { return }
    // Apple accepts CMSampleBuffer directly; no conversion, new microphone
    // tap or session mutation is necessary beside the movie capture output.
    StudioCaptureSpeechAudioRoute.append(sampleBuffer,
      enabled: requestedEnabled && running && state.token != nil,
      receive: { request.appendAudioSampleBuffer($0) })
  }

  private func status(_ value: String, code: String? = nil) {
    guard lastStatus != value || code != nil else { return }
    lastStatus = value
    var payload: [String: Any] = ["type": "status", "status": value]
    if let code { payload["code"] = code }
    onEvent?(state.event(payload))
  }

  private func stopTask() {
    // Invalidate first: cancel/endAudio can synchronously enqueue callbacks.
    lifecycle += 1; state.invalidate()
    rotation?.cancel(); rotation = nil; retry?.cancel(); retry = nil
    let previousRequest = request; request = nil
    let previousTask = task; task = nil
    recognizer = nil
    previousRequest?.endAudio(); previousTask?.cancel()
  }

  private func startSegment() {
    guard requestedEnabled, running, audioAvailable, state.enabled, !recovery.terminal else { return }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      status("denied", code: "speech_permission_required"); return
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)), recognizer.isAvailable else {
      status("unavailable", code: "speech_locale_unavailable"); return
    }
    // Never silently upload live audio. Unsupported languages/devices retain
    // the recorder normally and report an explicit auxiliary-reader status.
    guard recognizer.supportsOnDeviceRecognition else {
      status("unavailable", code: "on_device_unavailable"); return
    }
    guard let token = state.beginSegment() else { return }
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
      let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty {
        recovery.noteResult()
        onEvent?(state.event(["type": "result", "transcript": text, "isFinal": result.isFinal]))
      }
      if result.isFinal {
        stopTask()
        if text.isEmpty && recovery.waitAfterEmptyFinal(now: ProcessInfo.processInfo.systemUptime) {
          status("paused", code: "awaiting_speech")
        } else { startSegment() }
        return
      }
    }
    guard let error else { return }
    stopTask()
    let retryDelay: Double
    let nativeError = error as NSError
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
    let expectedLifecycle = lifecycle
    let retry = DispatchWorkItem { [weak self] in
      guard let self, self.lifecycle == expectedLifecycle, self.state.sessionId == token.sessionId,
        self.state.generation == token.generation, self.requestedEnabled, self.running else { return }
      self.retry = nil; self.startSegment()
    }
    self.retry = retry
    queue.asyncAfter(deadline: .now() + retryDelay, execute: retry)
  }
}
