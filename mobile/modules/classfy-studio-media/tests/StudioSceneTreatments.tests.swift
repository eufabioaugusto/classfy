import AVFoundation
import CoreImage
import Foundation

@main struct StudioSceneTreatmentsTests {
  static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
  static func pixel(_ image: CIImage, _ renderer: StudioEffectRenderer, x: CGFloat = 16, y: CGFloat = 16) -> [UInt8] {
    var result = [UInt8](repeating: 0, count: 4)
    renderer.context.render(image, toBitmap: &result, rowBytes: 4, bounds: CGRect(x: x, y: y, width: 1, height: 1), format: .RGBA8, colorSpace: sRGB)
    return result
  }
  static func expected(_ rgb: [Double], _ e: StudioSceneEnhancement) -> [Double] {
    func clamp(_ x: Double, _ lo: Double = 0, _ hi: Double = 1) -> Double { min(hi,max(lo,x)) }
    func smooth(_ lo: Double, _ hi: Double, _ x: Double) -> Double { let t=clamp((x-lo)/(hi-lo)); return t*t*(3-2*t) }
    let weights=[0.2126,0.7152,0.0722], gains=[1+e.temperature*0.08,1+e.tint*0.06,1-e.temperature*0.08]
    let exposed=zip(rgb,gains).map { $0*$1*pow(2,e.exposure) }
    let y=zip(exposed,weights).map(*).reduce(0,+)
    let lift=e.shadows*0.14*(1-smooth(0.05,0.65,y))+e.highlights*0.14*smooth(0.5,1,y)
    let corrected=exposed.map { ($0+lift-0.42)*(1+e.contrast*0.25)+0.42 }
    let luma=zip(corrected,weights).map(*).reduce(0,+)
    return zip(rgb,corrected).map { clamp($0+(luma+($1-luma)*(1+e.saturation*0.4)-$0)*e.strength) }
  }
  static func main() async throws {
    precondition(StudioEffectRenderer.editorTreatmentsAvailable)
    let renderer=StudioEffectRenderer(), engine=StudioRecipeEngine()
    let enhancement=StudioSceneEnhancement(version:1,strength:0.8,exposure:0.45,contrast:0.17,saturation:-0.12,temperature:0.3,tint:-0.1,shadows:0.2,highlights:-0.25,analyzedFrames:3)
    let colors: [[Double]] = [[0.08,0.13,0.2],[0.4,0.45,0.38],[0.88,0.73,0.65]]
    for rgb in colors {
      let input=CIImage(color:CIColor(cgColor:CGColor(colorSpace:sRGB,components:(rgb+[1]).map { CGFloat($0) })!)).cropped(to:CGRect(x:0,y:0,width:64,height:64))
      let treated=try renderer.editorImage(input,enhancement:enhancement)
      let actual=pixel(treated,renderer), wanted=expected(rgb,enhancement)
      for index in 0..<3 { assert(abs(Double(actual[index])/255-wanted[index]) <= 2.0/255, "Shared SDR pixel equations differ") }
      let disabled=StudioSceneEnhancement(version:1,strength:0,exposure:0.45,contrast:0.17,saturation:-0.12,temperature:0.3,tint:-0.1,shadows:0.2,highlights:-0.25,analyzedFrames:3)
      let unchanged=try renderer.editorImage(input,enhancement:disabled)
      assert(pixel(unchanged,renderer)==pixel(input,renderer))
      // Synthetic constant colors contain no faces; no stale mask is reused.
      assert(renderer.portraitGeometry(in:input).isEmpty)
      let absentFace=try renderer.editorImage(input,portrait:StudioNaturalPortrait(version:1,strength:1))
      assert(pixel(absentFace,renderer)==pixel(input,renderer))
    }
    let rectangle=CGRect(x:0,y:0,width:200,height:200)
    let feature=[CGPoint(x:0.3,y:0.55),CGPoint(x:0.45,y:0.55),CGPoint(x:0.45,y:0.65),CGPoint(x:0.3,y:0.65)]
    let geometry=StudioPortraitGeometry(bounds:CGRect(x:0.15,y:0.1,width:0.7,height:0.8),protectedFeatures:[feature])
    let mask=renderer.portraitMask(extent:rectangle,faces:[geometry])!
    assert(pixel(mask,renderer,x:74,y:120)[0]==0, "Eyes/mouth exclusions must remain black")
    assert(pixel(mask,renderer,x:5,y:100)[0]==0, "Background/silhouette must stay untouched")
    assert(pixel(mask,renderer,x:100,y:80)[0]>240, "Visible cheek remains eligible")
    assert(renderer.portraitMask(extent:rectangle,faces:[])==nil)
    let v2Mask=renderer.portraitMask(extent:rectangle,faces:[geometry],version:2)!
    assert(pixel(v2Mask,renderer,x:33,y:100)[0]==0,"V2 feather cannot leave the contracted face contour")
    assert(pixel(v2Mask,renderer,x:74,y:120)[0]==0,"V2 applies protected-feature cutouts after its feather")
    var skin=[UInt8](repeating:255,count:200*200*4)
    for index in stride(from:0,to:skin.count,by:4) { skin[index]=140; skin[index+1]=110; skin[index+2]=90 }
    for (x,y) in [(100,80),(74,120),(5,100)] { let i=((199-y)*200+x)*4;skin[i]=146;skin[i+1]=116;skin[i+2]=96 }
    let synthetic=CIImage(bitmapData:Data(skin),bytesPerRow:200*4,size:CGSize(width:200,height:200),format:.RGBA8,colorSpace:sRGB)
    let retouched=try renderer.naturalPortrait(synthetic,strength:1,geometry:[geometry])
    let baseCheek=pixel(synthetic,renderer,x:100,y:80), smoothCheek=pixel(retouched,renderer,x:100,y:80)
    FileHandle.standardError.write(Data("Retouch bounded sample \(baseCheek)/\(smoothCheek)\n".utf8))
    assert(baseCheek != smoothCheek && zip(baseCheek.prefix(3),smoothCheek.prefix(3)).allSatisfy { abs(Int($0)-Int($1)) <= 4 }, "Natural retouch is active and bounded")
    assert(pixel(synthetic,renderer,x:74,y:120)==pixel(retouched,renderer,x:74,y:120), "Eye features cannot be softened")
    assert(pixel(synthetic,renderer,x:5,y:100)==pixel(retouched,renderer,x:5,y:100), "Background cannot be softened")
    let afterNoFace=try renderer.naturalPortrait(synthetic,strength:1,geometry:[])
    assert(pixel(afterNoFace,renderer,x:100,y:80)==baseCheek, "No earlier mask survives the current frame")
    assert(StudioEffectRenderer.portraitV2Available,"New ABI must compile its actual GPU kernel")
    var textured=skin
    let pore=((199-80)*200+100)*4
    textured[pore]=108;textured[pore+1]=78;textured[pore+2]=58
    let texture=CIImage(bitmapData:Data(textured),bytesPerRow:200*4,size:CGSize(width:200,height:200),format:.RGBA8,colorSpace:sRGB)
    let originalPore=pixel(texture,renderer,x:100,y:80)
    let legacy=try renderer.naturalPortrait(texture,strength:1,version:1,geometry:[geometry])
    let natural=try renderer.naturalPortrait(texture,strength:0.35,version:2,geometry:[geometry])
    let stronger=try renderer.naturalPortrait(texture,strength:1,version:2,geometry:[geometry])
    let oldPixel=pixel(legacy,renderer,x:100,y:80),naturalPixel=pixel(natural,renderer,x:100,y:80),strongPixel=pixel(stronger,renderer,x:100,y:80)
    assert(abs(Int(strongPixel[0])-Int(originalPore[0]))>abs(Int(oldPixel[0])-Int(originalPore[0]))+5,"Maximum v2 visibly exceeds conservative v1")
    assert(abs(Int(naturalPixel[0])-Int(originalPore[0]))<abs(Int(strongPixel[0])-Int(originalPore[0]))/2,"Low v2 intensity remains natural")
    for i in 0..<3 { assert(abs(Int(strongPixel[i])-Int(originalPore[i]))<=36,"Maximum v2 remains bounded") }
    assert(strongPixel[3]==originalPore[3],"Alpha survives")
    assert(pixel(texture,renderer,x:74,y:120)==pixel(stronger,renderer,x:74,y:120),"V2 preserves protected face features")
    assert(pixel(texture,renderer,x:5,y:100)==pixel(stronger,renderer,x:5,y:100),"V2 never smooths background/silhouette")
    do { _=try renderer.naturalPortrait(texture,strength:1,version:3,geometry:[geometry]);assertionFailure("Unknown portrait cannot silently render") } catch {}
    let neutral=CIImage(color:CIColor(cgColor:CGColor(colorSpace:sRGB,components:[0.4,0.4,0.4,1])!)).cropped(to:rectangle)
    let stats=try engine.measureScene(neutral)
    assert(abs(stats["p50"]!-0.4)<1.0/255 && stats["neutralFraction"]==1 && stats["saturation"]!<0.01)
    let transparent=CIImage(color:.clear).cropped(to:rectangle)
    do { _=try engine.measureScene(transparent); assertionFailure("Invisible source cannot be analyzed") } catch {}

    let root=URL(fileURLWithPath:CommandLine.arguments[1]), source=root.appendingPathComponent("original.mp4"), original=try Data(contentsOf:source)
    var recipe:[String:Any]=["version":3,"requiredFeatures":["enhancement-v1","portrait-v1"],"timebase":120000,"durationTicks":60000,"mediaType":"video",
      "canvas":["aspectRatio":"landscape","backgroundColor":"#000000"],
      "output":["profile":"standard","width":640,"height":360,"frameRateNumerator":24,"frameRateDenominator":1,"colorSpace":"rec709"],
      "assets":[["id":"source","kind":"video","uri":source.absoluteString,"durationTicks":60000,"hasAudio":true]],
      "clips":[["id":"main","kind":"video","assetId":"source","startTicks":0,"durationTicks":60000,"sourceStartTicks":0,"sourceEndTicks":60000,"zIndex":0,"rect":["x":0,"y":0,"width":1,"height":1],"rotationDegrees":0,"fit":"contain","opacity":1,"gain":1,"fadeInTicks":0,"fadeOutTicks":0,"effect":"natural",
        "enhancement":try JSONSerialization.jsonObject(with:JSONEncoder().encode(enhancement)),"portrait":["version":1,"strength":0.4]]]]
    func json(_ value:[String:Any]) throws -> String { String(data:try JSONSerialization.data(withJSONObject:value),encoding:.utf8)! }
    let validJSON=try json(recipe)
    _=try StudioRecipeEngine.decode(validJSON)
    var v2Recipe=recipe,v2Clips=recipe["clips"] as! [[String:Any]]
    v2Clips[0]["portrait"]=["version":2,"strength":0.45];v2Recipe["clips"]=v2Clips;v2Recipe["requiredFeatures"]=["enhancement-v1","portrait-v2"]
    _=try StudioRecipeEngine.decode(json(v2Recipe))
    v2Recipe["requiredFeatures"]=["enhancement-v1","portrait-v1"]
    do { _=try StudioRecipeEngine.decode(json(v2Recipe));assertionFailure("V2 must explicitly require portrait-v2") } catch {}
    for features in [[],["unknown-v1"],["enhancement-v1"],["enhancement-v1","portrait-v1","portrait-v1"]] {
      recipe["requiredFeatures"]=features
      do { _=try StudioRecipeEngine.decode(json(recipe)); assertionFailure("Missing/unknown/duplicate features must fail closed") } catch {}
    }
    recipe["requiredFeatures"]=["enhancement-v1","portrait-v1"]; recipe["version"]=2
    do { _=try StudioRecipeEngine.decode(json(recipe)); assertionFailure("Recipe2 cannot silently drop active treatments") } catch {}
    let samples=try await engine.analyzeScene(uri:source.absoluteString,kind:"video",startSeconds:0.05,endSeconds:0.45,frameCount:3)
    assert((samples["samples"] as? [[String:Double]])?.count==3)
    do { _=try await engine.analyzeScene(uri:source.absoluteString,kind:"video",startSeconds:0,endSeconds:1,frameCount:3); assertionFailure("Outside range must fail") } catch {}
    do { _=try await engine.analyzeScene(uri:source.absoluteString,kind:"video",startSeconds:0,endSeconds:0.4,frameCount:13); assertionFailure("Bound analysis") } catch {}
    let prepared=try await engine.prepare(recipeJSON:validJSON)
    let inspected=try await engine.frame(prepared,at:0.25)
    let previewGenerator=AVAssetImageGenerator(asset:prepared.composition)
    previewGenerator.videoComposition=prepared.videoComposition
    previewGenerator.appliesPreferredTrackTransform=true
    let playerFrame=try await previewGenerator.image(at:CMTime(seconds:0.25,preferredTimescale:120000)).image
    let target=root.appendingPathComponent("enhanced.mp4")
    _=try await engine.export(requestId:"synthetic-treatments",recipeJSON:validJSON,outputUri:target.absoluteString,progress:{_ in})
    let encoded=AVURLAsset(url:target), generator=AVAssetImageGenerator(asset:encoded)
    generator.appliesPreferredTrackTransform=true; generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
    let decoded=try await generator.image(at:CMTime(seconds:0.25,preferredTimescale:120000)).image
    let preview=pixel(CIImage(cgImage:playerFrame),renderer,x:200,y:150), output=pixel(CIImage(cgImage:decoded,options:[.colorSpace:StudioEffectRenderer.outputColorSpace]),renderer,x:200,y:150)
    // AVAssetImageGenerator's CG profile is HDTV. Normalize it to the actual
    // encoded Rec709 contract before measuring, as the production CV pipeline
    // does. Comparing different transfer profiles would measure metadata.
    let video=try await encoded.loadTracks(withMediaType:.video).first!
    let descriptions=try await video.load(.formatDescriptions)
    let extensions=CMFormatDescriptionGetExtensions(descriptions[0])! as NSDictionary
    assert(extensions[kCMFormatDescriptionExtension_TransferFunction] as? String == kCMFormatDescriptionTransferFunction_ITU_R_709_2 as String)
    assert(zip(preview.prefix(3),pixel(CIImage(cgImage:inspected),renderer,x:200,y:150).prefix(3)).allSatisfy { abs(Int($0)-Int($1))<=2 }, "Inspection and player agree")
    assert(zip(preview.prefix(3),output.prefix(3)).allSatisfy { abs(Int($0)-Int($1))<=8 }, "Preview and export differ: \(preview)/\(output)")
    let audio=try await encoded.loadTracks(withMediaType:.audio), preserved=try Data(contentsOf:source)
    assert(audio.count==1); assert(preserved==original)
    print("PASS shared SDR math ≤2/255, v1 preserved, v2 natural low/visible maximum/bounded, zero-strength/noface unchanged, protected features/background masks")
    print("PASS bounded original analysis, recipe3 strict capability contract, real MP4+audio preview/export ≤8/255, original bytes preserved")
  }
}
