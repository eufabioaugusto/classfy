import ExpoModulesCore

struct StudioClipRecord: Record {
  @Field var uri: String = ""
  @Field var startSeconds: Double = 0
  @Field var endSeconds: Double = 0
}

struct StudioExportRecord: Record {
  @Field var requestId: String = ""
  @Field var clips: [StudioClipRecord] = []
  @Field var outputUri: String = ""
  @Field var mediaType: String = "video"
  @Field var aspectRatio: String = "landscape"
}

public final class ClassfyStudioMediaModule: Module {
  private let engine = StudioMediaEngine()

  public func definition() -> ModuleDefinition {
    Name("ClassfyStudioMedia")
    Events("onExportProgress")

    AsyncFunction("getMediaInfoAsync") { (uri: String) async throws -> [String: Any] in
      try await self.engine.mediaInfo(uri)
    }
    AsyncFunction("generateThumbnailAsync") { (uri: String, outputUri: String, timeSeconds: Double) async throws -> [String: Any] in
      try await self.engine.thumbnail(uri, outputUri: outputUri, timeSeconds: timeSeconds)
    }
    AsyncFunction("exportTimelineAsync") { (options: StudioExportRecord) async throws -> [String: Any] in
      try await self.engine.export(
        requestId: options.requestId,
        clips: options.clips.map { StudioClip(uri: $0.uri, startSeconds: $0.startSeconds, endSeconds: $0.endSeconds) },
        outputUri: options.outputUri,
        mediaType: options.mediaType,
        aspectRatio: options.aspectRatio,
        progress: { [weak self] value in
          self?.sendEvent("onExportProgress", ["requestId": options.requestId, "progress": value])
        })
    }
    AsyncFunction("cancelExportAsync") { (requestId: String) in
      self.engine.cancel(requestId)
    }
    OnDestroy { self.engine.cancelAll() }
  }
}
