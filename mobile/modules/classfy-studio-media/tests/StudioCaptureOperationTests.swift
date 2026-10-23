import Foundation

@main struct StudioCaptureOperationTests {
  static func main() {
    let url = URL(fileURLWithPath: "/tmp/classfy-capture-operation-fixture.mov")
    var callbacks = 0
    let first = StudioCaptureOperation(id: "first", fileURL: url, generation: 1, sourceKind: "standard") { _ in callbacks += 1 }
    assert(first.phase == .preparing)
    assert(first.requestStop())
    assert(first.requestStop()) // Repeated STOP is safe before native start.
    assert(first.phase == .stopping && first.stopRequested)
    assert(first.didStart()) // The late native acknowledgement consumes STOP.
    assert(first.phase == .stopping)
    assert(first.finish(.success(["uri": url.absoluteString])))
    assert(!first.finish(.success([:])))
    assert(callbacks == 1 && first.completion == nil)
    assert(!first.didStart() && !first.requestStop())

    let second = StudioCaptureOperation(id: "second", fileURL: url.appendingPathExtension("second"), generation: 2, sourceKind: "standard") { _ in callbacks += 1 }
    assert(!second.didStart())
    assert(second.phase == .recording && !second.stopRequested)
    assert(!first.didStart()) // A late event on the finished take stays local.
    assert(second.phase == .recording && !second.stopRequested)
    let watchdog = DispatchWorkItem {}
    second.startupWatchdog = watchdog
    assert(!second.didStart())
    assert(watchdog.isCancelled && second.startupWatchdog == nil)
    assert(second.requestStop())
    assert(second.phase == .stopping)
    assert(second.finish(.failure(NSError(domain: "test", code: 1))))
    assert(callbacks == 2 && second.phase == .finished)
    print("StudioCaptureOperation: 6 regressões passaram")

    // Native wall time and actual file duration remain separate. An OS finish
    // at 66s cannot be relabelled by a browser STOP arriving 96s later.
    let early = StudioCaptureOperation(id: "early", fileURL: url, generation: 3, sourceKind: "standard",
      freeDiskBytes: 10_000_000, thermalState: "nominal", requestedAtEpochMs: 1_000) { _ in }
    assert(!early.didStart(atEpochMs: 2_000, uptime: 100))
    assert(early.didFinish(mediaDurationSeconds: 66.153333, freeDiskBytes: 9_000_000,
      thermalState: "fair", atEpochMs: 68_000, uptime: 166))
    assert(!early.requestStop(atEpochMs: 164_000))
    assert(!early.didStart(atEpochMs: 164_000, uptime: 262))
    assert(!early.didFinish(atEpochMs: 164_000, uptime: 262))
    let earlyReceipt = early.captureReceipt()!
    assert(earlyReceipt["stopReason"] as? String == "native_finished")
    assert(earlyReceipt["interrupted"] as? Bool == true)
    assert(earlyReceipt["wallDurationSeconds"] as? Double == 66)
    assert(earlyReceipt["mediaDurationSeconds"] as? Double == 66.153333)
    assert(earlyReceipt["finishedAtEpochMs"] as? Double == 68_000)
    assert(earlyReceipt["requestedStopReason"] == nil)
    assert(earlyReceipt["freeDiskBytesAtStart"] as? Int64 == 10_000_000)
    assert(earlyReceipt["thermalStateAtEnd"] as? String == "fair")

    let intentional = StudioCaptureOperation(id: "intentional", fileURL: url, generation: 4, sourceKind: "standard") { _ in }
    assert(!intentional.didStart(atEpochMs: 2_000, uptime: 20))
    assert(intentional.requestStop(atEpochMs: 4_000))
    assert(intentional.requestStop(reason: .disposed, atEpochMs: 9_000))
    // Wall-clock corrections do not change elapsed capture time.
    assert(intentional.didFinish(mediaDurationSeconds: 3, atEpochMs: 1_000, uptime: 23))
    let normal = intentional.captureReceipt()!
    assert(normal["stopReason"] as? String == "user_stop")
    assert(normal["requestedStopReason"] as? String == "user_stop")
    assert(normal["stopRequestedAtEpochMs"] as? Double == 4_000)
    assert(normal["interrupted"] as? Bool == false)
    assert(normal["wallDurationSeconds"] as? Double == 3)

    let interrupted = StudioCaptureOperation(id: "interrupted", fileURL: url, generation: 5, sourceKind: "standard") { _ in }
    assert(!interrupted.didStart())
    assert(interrupted.requestStop())
    interrupted.noteInterruption(reason: 2)
    assert(interrupted.requestStop(reason: .captureInterrupted))
    let privateError = NSError(domain: "AVFoundationErrorDomain", code: -11818,
      userInfo: [NSLocalizedDescriptionKey: "private file:///secret/source.mov?token=do-not-persist"])
    assert(interrupted.didFinish(error: privateError, successfullyFinished: false))
    let interruptedReceipt = interrupted.captureReceipt(mediaDurationSeconds: 12)!
    assert(interruptedReceipt["requestedStopReason"] as? String == "user_stop")
    assert(interruptedReceipt["stopReason"] as? String == "capture_interrupted")
    assert(interruptedReceipt["interruptionReason"] as? Int == 2)
    assert(interruptedReceipt["interrupted"] as? Bool == true)
    let errorReceipt = interruptedReceipt["nativeError"] as! [String: Any]
    assert(errorReceipt["domain"] as? String == "AVFoundationErrorDomain")
    assert(errorReceipt["code"] as? Int == -11818)
    assert(errorReceipt["recordingSuccessfullyFinished"] as? Bool == false)
    let encodedReceipt = String(data: try! JSONSerialization.data(withJSONObject: interruptedReceipt), encoding: .utf8)!
    assert(!encodedReceipt.contains("secret") && !encodedReceipt.contains("token") && !encodedReceipt.contains("file:"))

    let failure = StudioCaptureOperation(id: "failure", fileURL: url, generation: 6, sourceKind: "standard") { _ in }
    assert(!failure.didStart())
    assert(failure.requestStop())
    failure.noteRuntimeError(privateError)
    assert(failure.didFinish())
    assert(failure.captureReceipt()!["stopReason"] as? String == "runtime_error")
    let successfulWarning = StudioCaptureOperation(id: "warning", fileURL: url, generation: 7, sourceKind: "standard") { _ in }
    assert(!successfulWarning.didStart())
    assert(successfulWarning.requestStop())
    assert(successfulWarning.didFinish(error: privateError, successfullyFinished: true))
    assert(successfulWarning.captureReceipt()!["interrupted"] as? Bool == false)

    for reason in [StudioCaptureOperation.StopReason.appBackground, .viewInactive, .disposed, .startupTimeout] {
      let lifecycle = StudioCaptureOperation(id: reason.rawValue, fileURL: url, generation: 8, sourceKind: "standard") { _ in }
      assert(lifecycle.requestStop(reason: reason))
      assert(lifecycle.didFinish())
      assert(lifecycle.captureReceipt()!["stopReason"] as? String == reason.rawValue)
      assert(lifecycle.captureReceipt()!["interrupted"] as? Bool == true)
    }

    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let original = directory.appendingPathComponent("receipt-fixture.mov")
    let originalBytes = Data("original-is-preserved".utf8)
    try! originalBytes.write(to: original)
    let persisted = StudioCaptureOperation(id: "persisted", fileURL: original, generation: 9, sourceKind: "standard") { _ in }
    assert(!persisted.didStart(uptime: 100))
    assert(persisted.didFinish(mediaDurationSeconds: 8, uptime: 108))
    try! persisted.persistReceipt()
    let receiptURL = original.appendingPathExtension("capture.json")
    var saved = try! JSONSerialization.jsonObject(with: Data(contentsOf: receiptURL)) as! [String: Any]
    assert(saved["stopReason"] as? String == "native_finished")
    assert(saved["mediaDurationSeconds"] as? Double == 8)
    try! persisted.persistReceipt(mediaDurationSeconds: 8.033333)
    saved = try! JSONSerialization.jsonObject(with: Data(contentsOf: receiptURL)) as! [String: Any]
    assert(saved["mediaDurationSeconds"] as? Double == 8.033333)
    assert(try! Data(contentsOf: original) == originalBytes)
    print("StudioCaptureOperation receipts: 9 regressões passaram")

    let minimumBytes = StudioCaptureStoragePolicy.minimumStartBytes
    let reserveBytes = StudioCaptureStoragePolicy.finalizationReserveBytes
    assert(minimumBytes == 1_073_741_824 && reserveBytes == 536_870_912)
    assert(!StudioCaptureStoragePolicy.canStart(availableBytes: nil))
    assert(!StudioCaptureStoragePolicy.canStart(availableBytes: -1))
    assert(!StudioCaptureStoragePolicy.canStart(availableBytes: 0))
    assert(!StudioCaptureStoragePolicy.canStart(availableBytes: minimumBytes - 1))
    assert(StudioCaptureStoragePolicy.canStart(availableBytes: minimumBytes))
    assert(StudioCaptureStoragePolicy.canStart(availableBytes: minimumBytes + 1))
    assert(StudioCaptureStoragePolicy.estimatedRemainingSeconds(availableBytes: minimumBytes,
      recordedBytes: 10_000_000, recordedSeconds: 2.9) == nil)
    assert(StudioCaptureStoragePolicy.estimatedRemainingSeconds(availableBytes: nil,
      recordedBytes: 10_000_000, recordedSeconds: 3) == nil)
    assert(StudioCaptureStoragePolicy.estimatedRemainingSeconds(availableBytes: minimumBytes,
      recordedBytes: 0, recordedSeconds: 3) == nil)
    assert(StudioCaptureStoragePolicy.estimatedRemainingSeconds(availableBytes: minimumBytes,
      recordedBytes: 10_000_000, recordedSeconds: .infinity) == nil)
    assert(StudioCaptureStoragePolicy.estimatedRemainingSeconds(availableBytes: reserveBytes + 20_000_000,
      recordedBytes: 10_000_000, recordedSeconds: 5) == 10)
    assert(StudioCaptureStoragePolicy.estimatedRemainingSeconds(availableBytes: reserveBytes - 1,
      recordedBytes: 10_000_000, recordedSeconds: 5) == 0)
    assert(try! Data(contentsOf: original) == originalBytes) // No cleanup is part of a space check.
    print("StudioCaptureStoragePolicy: 6 regressões passaram")

    let grade = StudioCaptureEffectConfirmation(revision: 3, generation: 7)
    assert(!grade.acceptFrame(revision: 2, generation: 7)) // Old preset still on the GPU.
    assert(!grade.acceptFrame(revision: 3, generation: 6)) // Same recipe, obsolete format.
    assert(!grade.settled)
    assert(grade.acceptFrame(revision: 3, generation: 7))
    assert(!grade.acceptFrame(revision: 3, generation: 7)) // Confirm exactly once.
    let replaced = StudioCaptureEffectConfirmation(revision: 4, generation: 7)
    assert(replaced.cancel())
    assert(!replaced.acceptFrame(revision: 4, generation: 7)) // Timeout/blur wins late completion.
    assert(!replaced.cancel())
    let nextFormat = StudioCaptureEffectConfirmation(revision: 5, generation: 8)
    assert(!nextFormat.acceptFrame(revision: 5, generation: 7))
    assert(nextFormat.acceptFrame(revision: 5, generation: 8))
    print("StudioCaptureEffectConfirmation: 6 regressões passaram")
    for remoteFirst in [true, false] {
      let both = StudioCaptureEffectConfirmation(revision: 9, generation: 10, requiresRemote: true)
      assert(!both.acceptFrame(revision: 9, generation: 10, remote: remoteFirst))
      assert(!both.settled)
      assert(both.acceptFrame(revision: 9, generation: 10, remote: !remoteFirst))
      assert(!both.acceptFrame(revision: 9, generation: 10))
    }
    let staleRemote = StudioCaptureEffectConfirmation(revision: 10, generation: 11, requiresRemote: true)
    assert(!staleRemote.acceptFrame(revision: 10, generation: 11))
    assert(!staleRemote.acceptFrame(revision: 9, generation: 11, remote: true))
    assert(!staleRemote.acceptFrame(revision: 10, generation: 10, remote: true))
    assert(staleRemote.cancel())
    assert(!staleRemote.acceptFrame(revision: 10, generation: 11, remote: true))
    print("StudioCaptureEffectConfirmation remote: 3 regressões passaram")
  }
}
