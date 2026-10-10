import AudioToolbox
import CoreMedia
import Foundation

struct StudioCaptureAudioMeasurement {
  struct Channel {
    var squaredSum: Double
    var peak: Double
    var count: Int
  }
  var channels: [Channel]
  var sampleRate: Double
}

/// Reads the buffers already supplied by AVCaptureAudioDataOutput. No recorder,
/// resampling, gain changes, retained PCM or playback is created for metering.
enum StudioCaptureAudioPCM {
  static func measure(_ sample: CMSampleBuffer) -> StudioCaptureAudioMeasurement? {
    guard CMSampleBufferDataIsReady(sample), let description = CMSampleBufferGetFormatDescription(sample),
      let pointer = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return nil }
    let format = pointer.pointee
    guard format.mFormatID == kAudioFormatLinearPCM, format.mSampleRate.isFinite, format.mSampleRate > 0,
      format.mChannelsPerFrame > 0, format.mChannelsPerFrame <= 8 else { return nil }
    let noninterleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
    let floating = format.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let signed = format.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0
    let bigEndian = format.mFormatFlags & kAudioFormatFlagIsBigEndian != 0
    let alignedHigh = format.mFormatFlags & kAudioFormatFlagIsAlignedHigh != 0
    let bits = Int(format.mBitsPerChannel), channels = Int(format.mChannelsPerFrame)
    let stride = Int(format.mBytesPerFrame), bytes = stride / (noninterleaved ? 1 : channels)
    guard stride > 0, bytes > 0, bytes <= 8,
      floating ? [32, 64].contains(bits) && bytes * 8 == bits : signed && bits > 0 && bits <= 32 && bits <= bytes * 8 else { return nil }
    var listSize = 0
    _ = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: &listSize,
      bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: nil)
    guard listSize >= MemoryLayout<AudioBufferList>.size else { return nil }
    let storage = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { storage.deallocate() }
    let list = storage.assumingMemoryBound(to: AudioBufferList.self)
    var retained: CMBlockBuffer?
    guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: nil,
      bufferListOut: list, bufferListSize: listSize, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
      flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &retained) == noErr else { return nil }
    defer { withExtendedLifetime(retained) {} }
    let buffers = UnsafeMutableAudioBufferListPointer(list)
    guard noninterleaved ? buffers.count == channels : buffers.count == 1 else { return nil }
    let frames = CMSampleBufferGetNumSamples(sample)
    guard frames > 0, frames <= 131_072 else { return nil }
    var result = Array(repeating: StudioCaptureAudioMeasurement.Channel(squaredSum: 0, peak: 0, count: 0), count: channels)
    for channel in 0..<channels {
      let buffer = buffers[noninterleaved ? channel : 0]
      guard let raw = buffer.mData, buffer.mNumberChannels == (noninterleaved ? 1 : UInt32(channels)),
        Int(buffer.mDataByteSize) >= frames * stride else { return nil }
      let data = raw.assumingMemoryBound(to: UInt8.self)
      for frame in 0..<frames {
        let offset = frame * stride + (noninterleaved ? 0 : channel * bytes)
        var encoded: UInt64 = 0
        for byte in 0..<bytes { encoded |= UInt64(data[offset + byte]) << ((bigEndian ? bytes - byte - 1 : byte) * 8) }
        let value: Double
        if floating { value = bits == 32 ? Double(Float(bitPattern: UInt32(encoded))) : Double(bitPattern: encoded) }
        else {
          if alignedHigh { encoded >>= bytes * 8 - bits }
          let mask = (UInt64(1) << bits) - 1, sign = UInt64(1) << (bits - 1)
          let rawValue = encoded & mask
          let integer = rawValue & sign == 0 ? Int64(rawValue) : Int64(rawValue) - Int64(UInt64(1) << bits)
          value = Double(integer) / Double(sign)
        }
        guard value.isFinite else { return nil }
        let normalized = min(1, max(-1, value))
        result[channel].squaredSum += normalized * normalized
        result[channel].peak = max(result[channel].peak, abs(normalized)); result[channel].count += 1
      }
    }
    return StudioCaptureAudioMeasurement(channels: result, sampleRate: format.mSampleRate)
  }
}

/// A bounded mailbox. Tickets reject samples crossing a route/configuration
/// change; host-clock PTS rejects older samples delivered after that change.
final class StudioCaptureAudioMonitor: @unchecked Sendable {
  struct Ticket {
    let epoch: Int
    let clock: CMClock
    let after: Double
  }
  private let lock = NSLock()
  private var epoch = 0, generation = 0, revision = 0, sequence = 0
  private var input: [String: String]?
  private var clock: CMClock?
  private var enabled = false, after = 0.0
  private var reason: String?
  private var window: StudioCaptureAudioMeasurement?
  private var previous: StudioCaptureAudioMeasurement?
  private var sampleTime: Double?
  static let freshnessSeconds = 0.35

  static func now() -> Double { CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())) }

  func reset(generation: Int, revision: Int, input: [String: String]?, enabled: Bool, clock: CMClock?,
             reason: String?, now: Double = StudioCaptureAudioMonitor.now()) {
    lock.lock(); defer { lock.unlock() }
    epoch += 1; self.generation = generation; self.revision = revision; self.input = input
    self.enabled = enabled; self.clock = clock; self.reason = reason; after = now
    window = nil; previous = nil; sampleTime = nil
  }

  func ticket() -> Ticket? {
    lock.lock(); defer { lock.unlock() }
    guard enabled, input != nil, let clock else { return nil }
    return Ticket(epoch: epoch, clock: clock, after: after)
  }

  func unsupported(_ ticket: Ticket) {
    lock.lock(); defer { lock.unlock() }
    guard enabled, ticket.epoch == epoch else { return }
    window = nil; previous = nil; sampleTime = nil; reason = "unavailable"
  }

  @discardableResult
  func receive(_ measurement: StudioCaptureAudioMeasurement, ticket: Ticket, hostPTS: Double,
               now: Double = StudioCaptureAudioMonitor.now()) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard enabled, ticket.epoch == epoch, hostPTS.isFinite, now.isFinite,
      hostPTS >= after, hostPTS <= now + 0.05, now - hostPTS <= Self.freshnessSeconds,
      !measurement.channels.isEmpty, measurement.channels.count <= 8, measurement.sampleRate.isFinite, measurement.sampleRate > 0,
      sampleTime.map({ hostPTS >= $0 }) != false,
      measurement.channels.allSatisfy({ $0.count > 0 && $0.squaredSum.isFinite && $0.squaredSum >= 0 && $0.peak.isFinite && $0.peak >= 0 }) else { return false }
    if let existing = window, existing.channels.count == measurement.channels.count, existing.sampleRate == measurement.sampleRate {
      window = StudioCaptureAudioMeasurement(channels: zip(existing.channels, measurement.channels).map {
        .init(squaredSum: $0.squaredSum + $1.squaredSum, peak: max($0.peak, $1.peak), count: $0.count + $1.count)
      }, sampleRate: measurement.sampleRate)
    } else { window = measurement }
    sampleTime = hostPTS; reason = nil; return true
  }

  func snapshot(now: Double = StudioCaptureAudioMonitor.now(), unixMs: Double = Date().timeIntervalSince1970 * 1000) -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    sequence += 1
    if let window { previous = window; self.window = nil }
    let age = sampleTime.map { max(0, now - $0) }
    let active = enabled && input != nil && previous != nil && age.map { $0 <= Self.freshnessSeconds } == true
    let levels: [[String: Double]] = active ? previous!.channels.map {
      ["averageDb": max(-120, min(0, 10 * log10(max(1e-12, $0.squaredSum / Double($0.count))))),
       "peakDb": max(-120, min(0, 20 * log10(max(1e-6, $0.peak))))]
    } : []
    var result: [String: Any] = ["version": 1, "generation": generation, "revision": revision, "sequence": sequence,
      "active": active, "input": input as Any? ?? NSNull(), "channels": levels,
      "sampleRate": active ? previous!.sampleRate as Any : NSNull(), "channelCount": active ? levels.count : 0,
      "ageMs": active ? age! * 1000 as Any : NSNull(), "timestampMs": unixMs - (active ? age! * 1000 : 0)]
    if let reason { result["reason"] = reason }
    else if !active { result["reason"] = enabled ? "preparing" : "inactive" }
    return result
  }
}
