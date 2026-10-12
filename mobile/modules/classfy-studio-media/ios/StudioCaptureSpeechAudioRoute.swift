import AudioToolbox
import CoreMedia

/// Routes the original PCM sample to Speech without resampling, copying it,
/// starting another microphone, or changing the recorder's audio session.
enum StudioCaptureSpeechAudioRoute {
  @discardableResult
  static func append(_ sampleBuffer: CMSampleBuffer, enabled: Bool,
                     receive: (CMSampleBuffer) -> Void) -> Bool {
    guard enabled, CMSampleBufferIsValid(sampleBuffer), CMSampleBufferDataIsReady(sampleBuffer),
      CMSampleBufferGetNumSamples(sampleBuffer) > 0,
      let format = CMSampleBufferGetFormatDescription(sampleBuffer),
      CMFormatDescriptionGetMediaType(format) == kCMMediaType_Audio,
      CMFormatDescriptionGetMediaSubType(format) == kAudioFormatLinearPCM else { return false }
    receive(sampleBuffer)
    return true
  }
}
