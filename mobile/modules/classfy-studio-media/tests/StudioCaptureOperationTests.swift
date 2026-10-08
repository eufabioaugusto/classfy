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
  }
}
