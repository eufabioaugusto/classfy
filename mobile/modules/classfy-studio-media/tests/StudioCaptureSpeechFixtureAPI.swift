import CoreMedia
import Foundation

// Replaces only "import Speech" in a temporary copy of the production source.
// No framework permission, microphone or recognizer is opened by this fixture.
enum SFSpeechRecognizerAuthorizationStatus { case notDetermined, restricted, denied, authorized }
enum SFSpeechRecognitionTaskHint { case unspecified, dictation, search, confirmation }
enum SFSpeechRecognitionTaskState { case starting, running, finishing, canceling, completed }
protocol SFSpeechRecognizerDelegate: AnyObject {
  func speechRecognizer(_ recognizer: SFSpeechRecognizer, availabilityDidChange available: Bool)
}
extension SFSpeechRecognizerDelegate {
  func speechRecognizer(_ recognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {}
}
struct SFTranscriptionSegment: Sendable {
  let substring: String
  let substringRange: NSRange
  let timestamp: Double
  let duration: Double
}
struct SFTranscription: Sendable {
  let formattedString: String
  let segments: [SFTranscriptionSegment]
}
final class SFSpeechRecognitionResult: @unchecked Sendable {
  let bestTranscription: SFTranscription
  let isFinal: Bool
  init(_ transcription: SFTranscription, final: Bool) { bestTranscription = transcription; isFinal = final }
}
class SFSpeechRecognitionRequest: @unchecked Sendable {
  var shouldReportPartialResults = false
  var requiresOnDeviceRecognition = false
  var taskHint = SFSpeechRecognitionTaskHint.unspecified
}
final class SFSpeechAudioBufferRecognitionRequest: SFSpeechRecognitionRequest, @unchecked Sendable {
  private let lock = NSLock()
  private var timestamps: [Double] = []
  private var identities: [UInt] = []
  private(set) var ended = false
  func appendAudioSampleBuffer(_ sample: CMSampleBuffer) {
    lock.lock(); defer { lock.unlock() }
    timestamps.append(CMSampleBufferGetPresentationTimeStamp(sample).seconds)
    identities.append(UInt(bitPattern: Unmanaged.passUnretained(sample).toOpaque()))
  }
  func receivedPTS() -> [Double] { lock.lock(); defer { lock.unlock() }; return timestamps }
  func receivedIdentities() -> [UInt] { lock.lock(); defer { lock.unlock() }; return identities }
  func endAudio() { ended = true }
}
final class SFSpeechRecognitionTask: @unchecked Sendable {
  let request: SFSpeechAudioBufferRecognitionRequest
  let callback: (SFSpeechRecognitionResult?, Error?) -> Void
  var state = SFSpeechRecognitionTaskState.running
  var error: Error?
  init(request: SFSpeechAudioBufferRecognitionRequest, callback: @escaping (SFSpeechRecognitionResult?, Error?) -> Void) {
    self.request = request; self.callback = callback
  }
  func cancel() { state = .completed }
  func finish() { state = .finishing }
  // Keep the callback after cancel: stale framework delivery must be rejected
  // by the actual production lifecycle/token checks.
  func emit(_ result: SFSpeechRecognitionResult?, error: Error? = nil) { self.error = error; callback(result, error) }
}
final class FakeSpeechHarness: @unchecked Sendable {
  static let shared = FakeSpeechHarness()
  private let lock = NSLock()
  private var available = true
  private var tasks: [SFSpeechRecognitionTask] = []
  private var recognizers: [SFSpeechRecognizer] = []
  private var prompts = 0
  func reset() { lock.lock(); defer { lock.unlock() }; available = true; tasks = []; recognizers = []; prompts = 0 }
  func isAvailable() -> Bool { lock.lock(); defer { lock.unlock() }; return available }
  func setAvailable(_ value: Bool) {
    lock.lock(); available = value; let current = recognizers; lock.unlock()
    for recognizer in current { recognizer.delegate?.speechRecognizer(recognizer, availabilityDidChange: value) }
  }
  func add(_ recognizer: SFSpeechRecognizer) { lock.lock(); defer { lock.unlock() }; recognizers.append(recognizer) }
  func add(_ task: SFSpeechRecognitionTask) { lock.lock(); defer { lock.unlock() }; tasks.append(task) }
  func allTasks() -> [SFSpeechRecognitionTask] { lock.lock(); defer { lock.unlock() }; return tasks }
  func prompt() { lock.lock(); defer { lock.unlock() }; prompts += 1 }
  func promptCount() -> Int { lock.lock(); defer { lock.unlock() }; return prompts }
}
final class SFSpeechRecognizer: NSObject, @unchecked Sendable {
  weak var delegate: SFSpeechRecognizerDelegate?
  let locale: Locale
  init?(locale: Locale) { self.locale = locale; super.init(); FakeSpeechHarness.shared.add(self) }
  var isAvailable: Bool { FakeSpeechHarness.shared.isAvailable() }
  var supportsOnDeviceRecognition: Bool { true }
  static func authorizationStatus() -> SFSpeechRecognizerAuthorizationStatus { .authorized }
  static func requestAuthorization(_ handler: @escaping (SFSpeechRecognizerAuthorizationStatus) -> Void) {
    FakeSpeechHarness.shared.prompt(); handler(.authorized)
  }
  func recognitionTask(with request: SFSpeechRecognitionRequest,
                       resultHandler: @escaping (SFSpeechRecognitionResult?, Error?) -> Void) -> SFSpeechRecognitionTask {
    let task = SFSpeechRecognitionTask(request: request as! SFSpeechAudioBufferRecognitionRequest, callback: resultHandler)
    FakeSpeechHarness.shared.add(task); return task
  }
}
