import CoreMedia
import CoreVideo
import Foundation
import LiveKitWebRTC
import livekit_react_native_webrtc

/// A video-only track fed by Studio's existing AVCaptureVideoDataOutput.
/// Never creates a capturer/session, opens an input or touches AVAudioSession.
final class StudioCameraRemotePreview {
  private let module: WebRTCModule
  private let source: LKRTCVideoSource
  private let capturer: LKRTCVideoCapturer
  private let track: LKRTCVideoTrack
  private let stream: LKRTCMediaStream
  private let lock = NSLock()
  private var closed = false
  private var lastTimestamp: Int64 = -1
  private(set) var width: Int
  private(set) var height: Int
  let fps: Int

  init(module: WebRTCModule, width: Int, height: Int, fps: Int) throws {
    guard [(1280, 720), (1920, 1080), (720, 1280), (1080, 1920)].contains(where: { $0.0 == width && $0.1 == height }), [15, 30].contains(fps) else {
      throw StudioCaptureError.unavailable("Atualize o aplicativo para conectar a câmera ao computador.")
    }
    self.module = module; self.width = width; self.height = height; self.fps = fps
    source = module.peerConnectionFactory.videoSource()
    source.adaptOutputFormat(toWidth: Int32(width), height: Int32(height), fps: Int32(fps))
    capturer = LKRTCVideoCapturer(delegate: source)
    track = module.peerConnectionFactory.videoTrack(with: source, trackId: UUID().uuidString)
    stream = module.peerConnectionFactory.mediaStream(withStreamId: UUID().uuidString)
    stream.addVideoTrack(track)
  }
  func setPortrait(_ portrait: Bool) {
    lock.lock(); defer { lock.unlock() }
    guard !closed else { return }
    let shortEdge = min(width, height), longEdge = max(width, height)
    width = portrait ? shortEdge : longEdge; height = portrait ? longEdge : shortEdge
    source.adaptOutputFormat(toWidth: Int32(width), height: Int32(height), fps: Int32(fps))
  }
  func register(_ completion: @escaping ([String: Any]) -> Void) {
    module.workerQueue.async {
      self.lock.lock(); let active = !self.closed; self.lock.unlock()
      guard active else { completion([:]); return }
      self.module.localTracks[self.track.trackId] = self.track
      self.module.localStreams[self.stream.streamId] = self.stream
      completion(["streamId": self.stream.streamId, "streamReactTag": self.stream.streamId,
        "tracks": [["id": self.track.trackId, "kind": "video", "remote": false, "enabled": true,
          "readyState": "live", "peerConnectionId": -1, "constraints": [:],
          "settings": ["width": self.width, "height": self.height, "frameRate": self.fps]]]])
    }
  }
  func receive(_ buffer: CVPixelBuffer, timestamp: CMTime) {
    guard timestamp.isNumeric else { return }
    let seconds = CMTimeGetSeconds(timestamp)
    guard seconds.isFinite, seconds >= 0, seconds < Double(Int64.max) / 1_000_000_000 else { return }
    lock.lock(); defer { lock.unlock() }
    guard !closed else { return }
    let time = max(lastTimestamp + 1, Int64(seconds * 1_000_000_000)); lastTimestamp = time
    let frame = LKRTCVideoFrame(buffer: LKRTCCVPixelBuffer(pixelBuffer: buffer), rotation: LKRTCVideoRotation(rawValue: 0)!, timeStampNs: time)
    source.capturer(capturer, didCapture: frame)
  }
  func dispose() {
    lock.lock(); guard !closed else { lock.unlock(); return }; closed = true; lock.unlock()
    module.workerQueue.async {
      self.track.isEnabled = false
      if let owned = self.module.localTracks[self.track.trackId] as? LKRTCVideoTrack, owned === self.track { self.module.localTracks.removeObject(forKey: self.track.trackId) }
      if let owned = self.module.localStreams[self.stream.streamId] as? LKRTCMediaStream, owned === self.stream { self.module.localStreams.removeObject(forKey: self.stream.streamId) }
    }
  }
}
