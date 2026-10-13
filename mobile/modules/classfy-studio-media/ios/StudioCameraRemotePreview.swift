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
  private let deliveryQueue = DispatchQueue(label: "br.com.classfy.studio.remote-preview", qos: .userInteractive)
  private var mailbox = StudioRemotePreviewMailbox<(buffer: CVPixelBuffer, timestamp: Int64, generation: Int, cinematic: Bool)>()
  private var pendingProfile: (width: Int, height: Int, fps: Int, epoch: Int)?
  private var deliveryScheduled = false
  private var frameGate: StudioRemotePreviewFrameGate
  private var closed = false
  private let renderer = StudioRemoteFrameRenderer()
  private var grade = StudioImageGrade.identity
  private var gradeRevision = 0
  private var generation = 0
  private var renderFailed = false
  var onRendered: ((Int, Int) -> Void)?
  var onFailure: (() -> Void)?
  private(set) var width: Int
  private(set) var height: Int
  private(set) var fps: Int

  init(module: WebRTCModule, width: Int, height: Int, fps: Int) throws {
    guard [(1280, 720), (1920, 1080), (720, 1280), (1080, 1920)].contains(where: { $0.0 == width && $0.1 == height }), [15, 24, 30].contains(fps) else {
      throw StudioCaptureError.unavailable("Este formato não oferece prévia remota. Escolha um formato compatível.")
    }
    self.module = module; self.width = width; self.height = height; self.fps = fps
    frameGate = StudioRemotePreviewFrameGate(fps: fps)
    source = module.peerConnectionFactory.videoSource()
    source.adaptOutputFormat(toWidth: Int32(width), height: Int32(height), fps: Int32(fps))
    capturer = LKRTCVideoCapturer(delegate: source)
    track = module.peerConnectionFactory.videoTrack(with: source, trackId: UUID().uuidString)
    stream = module.peerConnectionFactory.mediaStream(withStreamId: UUID().uuidString)
    stream.addVideoTrack(track)
  }
  func setProfile(sourceWidth: Int, sourceHeight: Int, portrait: Bool, fps: Int, generation: Int) {
    lock.lock()
    guard !closed else { lock.unlock(); return }
    let dimensions = StudioCapturePreviewProfile.dimensions(sourceWidth: sourceWidth, sourceHeight: sourceHeight, portrait: portrait)
    width = dimensions.width; height = dimensions.height
    self.fps = max(1, min(StudioCapturePreviewProfile.maxFPS, fps))
    self.generation = generation
    renderFailed = false
    frameGate.setFPS(self.fps); mailbox.clear()
    pendingProfile = (width, height, self.fps, mailbox.epoch)
    let schedule = !deliveryScheduled; deliveryScheduled = true
    lock.unlock()
    if schedule { deliveryQueue.async { [weak self] in self?.deliverLatestFrame() } }
  }
  func setGrade(_ grade: StudioImageGrade, revision: Int, generation: Int) {
    lock.lock(); defer { lock.unlock() }
    guard !closed, grade.isValid else { return }
    self.grade = grade; gradeRevision = revision; self.generation = generation
    renderFailed = false
    mailbox.clear()
  }
  func register(_ completion: @escaping ([String: Any]) -> Void) {
    module.workerQueue.async {
      self.lock.lock()
      let active = !self.closed
      let dimensions = (self.width, self.height, self.fps)
      self.lock.unlock()
      guard active else { completion([:]); return }
      self.module.localTracks[self.track.trackId] = self.track
      self.module.localStreams[self.stream.streamId] = self.stream
      completion(["streamId": self.stream.streamId, "streamReactTag": self.stream.streamId,
        "tracks": [["id": self.track.trackId, "kind": "video", "remote": false, "enabled": true,
          "readyState": "live", "peerConnectionId": -1, "constraints": [:],
          "settings": ["width": dimensions.0, "height": dimensions.1, "frameRate": dimensions.2]]]])
    }
  }
  func receive(_ buffer: CVPixelBuffer, timestamp: CMTime, generation: Int, cinematic: Bool) {
    guard timestamp.isNumeric else { return }
    guard let time = StudioCapturePreviewProfile.timestampNanoseconds(seconds: CMTimeGetSeconds(timestamp)) else { return }
    lock.lock()
    guard !closed, !renderFailed, self.generation == generation else { lock.unlock(); return }
    mailbox.replace(with: (buffer, time, generation, cinematic))
    let schedule = !deliveryScheduled; deliveryScheduled = true
    lock.unlock()
    if schedule { deliveryQueue.async { [weak self] in self?.deliverLatestFrame() } }
  }
  private func deliverLatestFrame() {
    lock.lock()
    guard !closed else {
      mailbox.clear(); pendingProfile = nil; deliveryScheduled = false; lock.unlock(); return
    }
    let profile = pendingProfile; pendingProfile = nil
    let epoch = mailbox.epoch
    lock.unlock()
    // Adaptation and delivery share one queue. An already delivering frame
    // finishes before the next profile is applied; queued old frames are gone.
    // Neither source operation holds the lock used by AVCapture's delegate.
    if let profile {
      source.adaptOutputFormat(toWidth: Int32(profile.width), height: Int32(profile.height), fps: Int32(profile.fps))
    }
    lock.lock()
    let latest = !closed && mailbox.isCurrent(epoch) ? mailbox.takeTicket() : nil
    let accepted = latest.map { mailbox.isCurrent($0.epoch) && frameGate.accept($0.frame.timestamp) } ?? false
    let recipe = (grade, gradeRevision, generation, width, height)
    lock.unlock()
    // Source adaptation/encoding cannot hold up AVCapture's video delegate.
    if accepted, let latest {
      do {
        let rendered = try renderer.render(latest.frame.buffer, grade: recipe.0, width: recipe.3, height: recipe.4,
          sourceStage: latest.frame.cinematic ? .cinematicRendered : .standard)
        lock.lock()
        let current = !closed && mailbox.isCurrent(latest.epoch) && recipe.1 == gradeRevision && recipe.2 == generation
        lock.unlock()
        if current {
          let frame = LKRTCVideoFrame(buffer: LKRTCCVPixelBuffer(pixelBuffer: rendered), rotation: LKRTCVideoRotation(rawValue: 0)!, timeStampNs: latest.frame.timestamp)
          source.capturer(capturer, didCapture: frame)
          onRendered?(recipe.1, recipe.2)
        }
      } catch StudioRemoteFrameRenderError.busy {
        // Bounded pool is still owned by WebRTC; skip instead of allocating.
      } catch {
        lock.lock()
        let current = !closed && recipe.1 == gradeRevision && recipe.2 == generation && !renderFailed
        if current { renderFailed = true; mailbox.clear() }
        lock.unlock()
        if current { onFailure?() }
      }
    }
    lock.lock()
    let pending = !closed && (!mailbox.isEmpty || pendingProfile != nil)
    if !pending { deliveryScheduled = false }
    lock.unlock()
    if pending { deliveryQueue.async { [weak self] in self?.deliverLatestFrame() } }
  }
  func dispose() {
    lock.lock(); guard !closed else { lock.unlock(); return }; closed = true
    mailbox.clear(); pendingProfile = nil; lock.unlock()
    // Teardown follows any in-flight source callback on the delivery queue.
    // Closed is immediate, so no pending frame or profile survives disposal.
    deliveryQueue.async {
      self.module.workerQueue.async {
        self.track.isEnabled = false
        if let owned = self.module.localTracks[self.track.trackId] as? LKRTCVideoTrack, owned === self.track { self.module.localTracks.removeObject(forKey: self.track.trackId) }
        if let owned = self.module.localStreams[self.stream.streamId] as? LKRTCMediaStream, owned === self.stream { self.module.localStreams.removeObject(forKey: self.stream.streamId) }
      }
    }
  }
}
