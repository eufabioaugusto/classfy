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
