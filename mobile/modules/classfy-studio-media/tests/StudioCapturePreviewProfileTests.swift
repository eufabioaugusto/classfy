import Foundation

@main struct StudioCapturePreviewProfileTests {
  static func main() {
    let landscape = StudioCapturePreviewProfile.dimensions(sourceWidth: 3840, sourceHeight: 2160, portrait: false)
    assert(landscape.width == 1920 && landscape.height == 1080)
    let portrait = StudioCapturePreviewProfile.dimensions(sourceWidth: 3840, sourceHeight: 2160, portrait: true)
    assert(portrait.width == 1080 && portrait.height == 1920)
    let lower = StudioCapturePreviewProfile.dimensions(sourceWidth: 1280, sourceHeight: 720, portrait: false)
    assert(lower.width == 1280 && lower.height == 720)
    let lowerPortrait = StudioCapturePreviewProfile.dimensions(sourceWidth: 720, sourceHeight: 1280, portrait: true)
    assert(lowerPortrait.width == 720 && lowerPortrait.height == 1280)

    var mailbox = StudioRemotePreviewMailbox<Int>()
    for frame in 0..<10_000 { mailbox.replace(with: frame) }
    assert(mailbox.take() == 9_999 && mailbox.isEmpty)
    assert(mailbox.take() == nil)
    mailbox.replace(with: 123); mailbox.clear(); assert(mailbox.take() == nil)
    mailbox.replace(with: 456)
    let previousProfile = mailbox.takeTicket()!
    assert(mailbox.isCurrent(previousProfile.epoch))
    mailbox.clear() // A new profile invalidates even a frame already taken.
    assert(!mailbox.isCurrent(previousProfile.epoch))
    mailbox.replace(with: 789)
    let currentProfile = mailbox.takeTicket()!
    assert(currentProfile.frame == 789 && mailbox.isCurrent(currentProfile.epoch))
    mailbox.clear() // Disposal invalidates the current epoch as well.
    assert(!mailbox.isCurrent(currentProfile.epoch))

    var gate = StudioRemotePreviewFrameGate(fps: 30)
    var accepted = 0
    // A 60fps source is never forwarded at 60fps to a 30fps real-time encoder.
    for frame in 0..<60 {
      if gate.accept(Int64(frame) * 16_666_667) { accepted += 1 }
    }
    assert(accepted == 30)
    assert(!gate.accept(0)) // Older capture frames cannot extend the backlog.
    assert(!gate.accept(-1))
    gate.setFPS(30)
    assert(!gate.accept(0) && !gate.accept(966_666_686)) // Reconfigure keeps the clock domain.
    assert(gate.accept(1_000_000_021))
    gate.setFPS(24)
    assert(!gate.accept(0) && !gate.accept(1_000_000_021))
    assert(gate.accept(1_041_666_688))
    gate.setFPS(60)
    assert(!gate.accept(0) && !gate.accept(1_058_333_355)) // Still capped at 30.
    assert(gate.accept(1_075_000_022))
    var jitterGate = StudioRemotePreviewFrameGate(fps: 30)
    assert(jitterGate.accept(0) && jitterGate.accept(32_800_000)) // Small clock jitter.
    assert(!jitterGate.accept(32_800_000)) // Duplicate timestamp.
    assert(StudioCapturePreviewProfile.timestampNanoseconds(seconds: 1.25) == 1_250_000_000)
    for invalid in [Double.nan, Double.infinity, -Double.infinity, -1, Double(Int64.max)] {
      assert(StudioCapturePreviewProfile.timestampNanoseconds(seconds: invalid) == nil)
    }
    assert(StudioCapturePreviewProfile.timestampNanoseconds(seconds: Double(Int64.max) / 1_000_000_000) == nil)
    print("StudioCapturePreviewProfile: dimensões, mailbox de 10000 quadros, cadência e timestamps passaram")
  }
}
