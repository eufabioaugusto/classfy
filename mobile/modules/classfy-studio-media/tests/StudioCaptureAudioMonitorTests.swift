import AudioToolbox
import CoreMedia
import Foundation

enum AudioMonitorTestError: Error { case failure(String) }
func check(_ value: @autoclosure () -> Bool, _ message: String) throws {
  if !value() { throw AudioMonitorTestError.failure(message) }
}
func close(_ actual: Double, _ expected: Double, _ message: String, tolerance: Double = 0.001) throws {
  try check(abs(actual - expected) <= tolerance, "\(message): \(actual) != \(expected)")
}

func pcm(_ values: [[Double]], bits: Int = 32, float: Bool = true, noninterleaved: Bool = false,
         bigEndian: Bool = false) throws -> CMSampleBuffer {
  let channels = values.count, frames = values.first!.count, bytes = bits / 8
  var data = Data()
  func append(_ value: Double) {
    let encoded: UInt64
    if float { encoded = bits == 32 ? UInt64(Float(value).bitPattern) : value.bitPattern }
    else { encoded = UInt64(bitPattern: Int64((value * Double(UInt64(1) << (bits - 1))).rounded())) }
    for byte in 0..<bytes { data.append(UInt8(truncatingIfNeeded: encoded >> ((bigEndian ? bytes - byte - 1 : byte) * 8))) }
  }
  if noninterleaved { for channel in values { for value in channel { append(value) } } }
  else { for frame in 0..<frames { for channel in values { append(channel[frame]) } } }
  var format = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: (float ? kAudioFormatFlagIsFloat : kAudioFormatFlagIsSignedInteger) | kAudioFormatFlagIsPacked
      | (noninterleaved ? kAudioFormatFlagIsNonInterleaved : 0) | (bigEndian ? kAudioFormatFlagIsBigEndian : 0),
    mBytesPerPacket: UInt32(bytes * (noninterleaved ? 1 : channels)), mFramesPerPacket: 1,
    mBytesPerFrame: UInt32(bytes * (noninterleaved ? 1 : channels)), mChannelsPerFrame: UInt32(channels),
    mBitsPerChannel: UInt32(bits), mReserved: 0)
  var description: CMAudioFormatDescription?
  try check(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &format, layoutSize: 0, layout: nil,
    magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description) == noErr, "format fixture")
  var block: CMBlockBuffer?
  try check(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: data.count,
    blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0, dataLength: data.count, flags: 0,
    blockBufferOut: &block) == noErr, "block fixture")
  try check(data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: data.count) } == noErr, "PCM fixture")
  var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48_000), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
  var sample: CMSampleBuffer?
  try check(CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: description,
    sampleCount: frames, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0,
    sampleSizeArray: nil, sampleBufferOut: &sample) == noErr, "sample fixture")
  return sample!
}

@main
struct StudioCaptureAudioMonitorTests {
  static func main() throws {
    let clock = CMClockGetHostTimeClock(), input = ["id": "usb-1", "name": "USB microphone", "type": "USBAudio"]
    let monitor = StudioCaptureAudioMonitor()
    func reset(_ generation: Int = 1, _ route: [String: String]? = input, reason: String = "preparing", now: Double = 20) {
      monitor.reset(generation: generation, revision: generation, input: route, enabled: true, clock: clock, reason: reason, now: now)
    }
    func levels(_ value: [String: Any]) -> [[String: Double]] { value["channels"] as! [[String: Double]] }
    var cases = 0
    func passed(_ name: String) { cases += 1; print("PASS \(name)") }

    reset()
    let sine = (0..<480).map { sin(Double($0) * 2 * .pi / 48) * 0.5 }
    let measured = StudioCaptureAudioPCM.measure(try pcm([sine]))!
    try check(monitor.receive(measured, ticket: monitor.ticket()!, hostPTS: 20.02, now: 20.03), "fresh real PCM")
    var state = monitor.snapshot(now: 20.04, unixMs: 100_000)
    try check(state["active"] as? Bool == true && state["channelCount"] as? Int == 1, "mono is not invented stereo")
    try close(levels(state)[0]["averageDb"]!, -9.03089987, "sine RMS dBFS")
    try close(levels(state)[0]["peakDb"]!, -6.02059991, "sine peak dBFS")
    try close(state["timestampMs"] as! Double, 99_980, "sample timestamp detects JS backlog")
    try check((state["input"] as? [String: String]) == input, "route name comes from supplied currentRoute")
    passed("mono PCM RMS/peak, sample timestamp and current-route identity")

    for format in [(32, true, false, false), (64, true, true, false), (16, false, false, false), (24, false, true, true), (32, false, false, true)] {
      reset()
      let pair = StudioCaptureAudioPCM.measure(try pcm([Array(repeating: 0.5, count: 32), Array(repeating: -0.25, count: 32)],
        bits: format.0, float: format.1, noninterleaved: format.2, bigEndian: format.3))!
      try check(monitor.receive(pair, ticket: monitor.ticket()!, hostPTS: 20.01, now: 20.02), "stereo receive")
      state = monitor.snapshot(now: 20.02)
      try check(levels(state).count == 2, "two actual channels")
      try close(levels(state)[0]["averageDb"]!, -6.02059991, "left \(format)")
      try close(levels(state)[1]["averageDb"]!, -12.04119983, "right \(format)")
    }
    passed("float32/64 and signed16/24/32; interleaved/planar and both endianness")

    reset()
    let quiet = StudioCaptureAudioPCM.measure(try pcm([Array(repeating: 0, count: 32)]))!
    try check(monitor.receive(quiet, ticket: monitor.ticket()!, hostPTS: 20.01, now: 20.02), "silence is a valid audio sample")
    state = monitor.snapshot(now: 20.02)
    try check(state["active"] as? Bool == true && levels(state)[0]["averageDb"] == -120 && levels(state)[0]["peakDb"] == -120, "silence has floor, not simulated activity")
    passed("actual silence stays fresh at -120dBFS")

    reset()
    let hot = StudioCaptureAudioPCM.measure(try pcm([[1, -1, 2, -2]]))!
    try check(monitor.receive(hot, ticket: monitor.ticket()!, hostPTS: 20.01, now: 20.02), "hot PCM")
    state = monitor.snapshot(now: 20.02); try check(levels(state)[0]["peakDb"] == 0, "full scale bounded at 0dBFS")
    let corrupt = try pcm([[Double.nan, 0]]), multichannel = try pcm(Array(repeating: [0.5], count: 9))
    try check(StudioCaptureAudioPCM.measure(corrupt) == nil, "corrupt non-finite PCM is rejected")
    try check(StudioCaptureAudioPCM.measure(multichannel) == nil, "unsupported nine-channel input is not silently made stereo")
    passed("full scale, corrupt PCM and bounded channel decoding")

    reset()
    let ticket = monitor.ticket()!
    try check(monitor.receive(measured, ticket: ticket, hostPTS: 20.05, now: 20.06), "first window")
    state = monitor.snapshot(now: 20.06); let firstSequence = state["sequence"] as! Int
    state = monitor.snapshot(now: 20.50)
    try check(state["active"] as? Bool == false && levels(state).isEmpty && state["ageMs"] is NSNull, "expired audio does not show frozen levels")
    try check(state["sequence"] as! Int > firstSequence, "global sequence advances")
    passed("freshness expiry clears levels and age, monotonic event sequence")

    let oldTicket = ticket
    let builtIn = ["id": "phone", "name": "iPhone Microphone", "type": "MicrophoneBuiltIn"]
    reset(1, builtIn, reason: "inputLost", now: 21)
    state = monitor.snapshot(now: 21, unixMs: 200_000)
    try check(state["reason"] as? String == "inputLost" && levels(state).isEmpty, "route loss clears old levels")
    try check(!monitor.receive(measured, ticket: oldTicket, hostPTS: 21.01, now: 21.02), "old queued route callback rejected")
    let newTicket = monitor.ticket()!
    try check(!monitor.receive(measured, ticket: newTicket, hostPTS: 20.99, now: 21.02), "old source PTS delivered after route change rejected")
    try check(monitor.receive(quiet, ticket: newTicket, hostPTS: 21.01, now: 21.02), "new actual route PCM accepted")
    state = monitor.snapshot(now: 21.02)
    try check((state["input"] as? [String: String]) == builtIn && levels(state)[0]["averageDb"] == -120, "new mic never shows previous USB level")
    passed("input loss, old queue ticket and pre-route source timestamp rejection")

    reset(2, input, now: 22)
    try check(!monitor.receive(measured, ticket: newTicket, hostPTS: 22.01, now: 22.02), "old format generation rejected")
    let configuredTicket = monitor.ticket()!
    monitor.reset(generation: 2, revision: 2, input: nil, enabled: false, clock: nil, reason: "interrupted", now: 23)
    try check(monitor.ticket() == nil && !monitor.receive(measured, ticket: configuredTicket, hostPTS: 23.01, now: 23.02), "background/interruption invalidates queued worker")
    state = monitor.snapshot(now: 23.02)
    try check(state["input"] is NSNull && levels(state).isEmpty && state["reason"] as? String == "interrupted", "no mic/levels after interruption")
    passed("format generation, background/dispose and queued worker cancellation")

    reset(3, nil, now: 24)
    try check(monitor.ticket() == nil && monitor.snapshot(now: 24)["active"] as? Bool == false, "enabled graph with no currentRoute is not an active mic")
    reset(3, input, now: 24)
    let valid = monitor.ticket()!; monitor.unsupported(valid)
    state = monitor.snapshot(now: 24.01)
    try check(state["reason"] as? String == "unavailable" && levels(state).isEmpty, "unsupported PCM honestly unavailable")
    try check(monitor.receive(measured, ticket: valid, hostPTS: 24.02, now: 24.03), "valid new format recovers")
    passed("missing route/unsupported format and actual recovery")

    print("\(cases)/\(cases) native audio-monitor fixture cases passed (synthetic CMSampleBuffer, no camera/USB/Bluetooth hardware).")
  }
}
