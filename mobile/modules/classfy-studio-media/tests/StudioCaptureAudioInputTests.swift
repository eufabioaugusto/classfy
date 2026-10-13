import Foundation

@main struct StudioCaptureAudioInputTests {
  static let builtIn = StudioCaptureAudioInputPort(id: "built-in", name: "Microfone do iPhone", type: "MicrophoneBuiltIn")
  static let usb = StudioCaptureAudioInputPort(id: "usb-receiver", name: "Receptor USB", type: "USBAudio")

  static func ready(_ selector: StudioCaptureAudioInputSelection, current: StudioCaptureAudioInputPort = builtIn,
                    preferred: String? = nil, generation: Int = 3, now: Double = 0) {
    selector.observe(available: [builtIn, usb], current: current, preferredId: preferred, active: true, generation: generation, now: now)
  }
  static func main() throws {
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector)
      let request = try selector.begin(inputId: usb.id, now: 10)
      ready(selector, preferred: usb.id)
      assert(selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10.01, now: 10.02))
      assert(!selector.confirmed(now: 10.02)); assert(!selector.finish(request.id, now: 10.02))
      assert(selector.snapshot(now: 10.02)["selecting"] as? Bool == true)
      ready(selector, current: usb, preferred: usb.id)
      assert(!selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10.04, now: 10.05))
      assert(selector.receivePCM(inputId: usb.id, generation: 3, hostPTS: 10.04, now: 10.05))
      assert(selector.finish(request.id, now: 10.05)); assert(!selector.finish(request.id, now: 10.05))
      assert(selector.snapshot(now: 10.05)["confirmed"] as? Bool == true)
    }
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector, current: usb, preferred: usb.id)
      assert(selector.receivePCM(inputId: usb.id, generation: 3, hostPTS: 9.99, now: 10))
      let request = try selector.begin(inputId: usb.id, now: 10)
      assert(!selector.confirmed(now: 10)); assert(!selector.receivePCM(inputId: usb.id, generation: 3, hostPTS: 9.99, now: 10.02))
      assert(selector.receivePCM(inputId: usb.id, generation: 3, hostPTS: 10.01, now: 10.02))
      assert(selector.finish(request.id, now: 10.02))
    }
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector, current: usb, preferred: usb.id)
      let request = try selector.begin(inputId: nil, now: 10)
      ready(selector)
      assert(!selector.finish(request.id, now: 10.02))
      assert(selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10.01, now: 10.02))
      assert(selector.finish(request.id, now: 10.02)); assert(selector.requestedId == nil)
      assert(selector.snapshot(now: 10.02)["preferredId"] is NSNull)
    }
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector)
      do { _ = try selector.begin(inputId: "unavailable-Mac-microphone", now: 10); assertionFailure("Unknown input accepted") }
      catch { assert(error is StudioCaptureAudioInputError) }
      assert(selector.pending == nil && !selector.hasSelection)
      let request = try selector.begin(inputId: usb.id, now: 10)
      do { _ = try selector.begin(inputId: nil, now: 10); assertionFailure("Concurrent input accepted") }
      catch { assert(error is StudioCaptureAudioInputError) }
      assert(selector.pending?.id == request.id)
    }
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector)
      let old = try selector.begin(inputId: usb.id, now: 10)
      assert(selector.fail(old.id, error: StudioCaptureAudioInputError.timeout))
      assert(!selector.fail(old.id, error: StudioCaptureAudioInputError.cancelled))
      let next = try selector.begin(inputId: nil, now: 11)
      assert(next.id != old.id)
      assert(!selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10.99, now: 11.01))
      assert(selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 11.01, now: 11.02))
      assert(!selector.finish(old.id, now: 11.02)); assert(selector.finish(next.id, now: 11.02))
    }
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector, current: usb, preferred: usb.id)
      let request = try selector.begin(inputId: usb.id, now: 10)
      assert(selector.receivePCM(inputId: usb.id, generation: 3, hostPTS: 10.01, now: 10.02))
      assert(selector.finish(request.id, now: 10.02))
      ready(selector, current: builtIn, preferred: usb.id)
      assert(!selector.confirmed(now: 10.03))
      assert(selector.snapshot(now: 10.03)["warning"] as? String != nil)
      selector.observe(available: [builtIn], current: builtIn, preferredId: nil, active: true, generation: 3, now: 10.03, reason: "inputLost")
      assert(selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10.04, now: 10.05))
      assert(!selector.confirmed(now: 10.05))
      assert(selector.snapshot(now: 10.05)["warning"] as? String != nil)
      let automatic = try selector.begin(inputId: nil, now: 10.06)
      assert(selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10.07, now: 10.08))
      assert(selector.finish(automatic.id, now: 10.08)); assert(selector.snapshot(now: 10.08)["warning"] is NSNull)
    }
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector)
      let old = try selector.begin(inputId: usb.id, now: 10)
      selector.invalidate(); assert(!selector.confirmed(now: 10.1)); assert(selector.pending == nil)
      ready(selector, generation: 4)
      let next = try selector.begin(inputId: nil, now: 11)
      assert(!selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 11.01, now: 11.02))
      assert(selector.receivePCM(inputId: builtIn.id, generation: 4, hostPTS: 11.01, now: 11.02))
      assert(!selector.finish(old.id, now: 11.02)); assert(selector.finish(next.id, now: 11.02))
    }
    do {
      let selector = StudioCaptureAudioInputSelection()
      do { _ = try selector.begin(inputId: nil, now: 10); assertionFailure("Inactive input accepted") }
      catch { assert(error is StudioCaptureAudioInputError) }
      ready(selector)
      assert(!selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: .nan, now: 10))
      assert(!selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10.2, now: 10))
      assert(!selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 9.5, now: 10))
      assert(selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 10, now: 10))
      assert(!selector.receivePCM(inputId: builtIn.id, generation: 3, hostPTS: 9.99, now: 10.01))
      assert(selector.confirmed(now: 10.1)); assert(!selector.confirmed(now: 10.4))
    }
    do {
      let selector = StudioCaptureAudioInputSelection(); ready(selector, now: 10)
      let request = try selector.begin(inputId: usb.id, now: 10.01)
      // PCM captured between the request and route observation may still be
      // from the old physical microphone, despite carrying the new UID.
      ready(selector, current: usb, preferred: usb.id, now: 10.10)
      assert(!selector.receivePCM(inputId: usb.id, generation: 3, hostPTS: 10.06, now: 10.12))
      assert(!selector.finish(request.id, now: 10.12))
      // Re-reading the same route must not perpetually postpone the barrier.
      ready(selector, current: usb, preferred: usb.id, now: 10.13)
      assert(selector.receivePCM(inputId: usb.id, generation: 3, hostPTS: 10.11, now: 10.14))
      assert(selector.finish(request.id, now: 10.14))
    }
    print("StudioCaptureAudioInputSelection: 9 jornadas de confirmação, troca, cancelamento, timeout e perda de USB passaram")
  }
}
