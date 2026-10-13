import AVFoundation
import CoreImage
import Foundation

@main struct StudioSignatureTests {
  static let space=CGColorSpace(name:CGColorSpace.sRGB)!
  static func pixel(_ image:CIImage,_ renderer:StudioEffectRenderer,_ x:CGFloat,_ y:CGFloat)->[UInt8]{
    var p=[UInt8](repeating:0,count:4);renderer.context.render(image,toBitmap:&p,rowBytes:4,bounds:CGRect(x:x,y:y,width:1,height:1),format:.RGBA8,colorSpace:space);return p
  }
  static func tone(_ value:Double)->Double{
    let x=[0.0,0.12,0.25,0.5,0.75,1],y=[0.0,0.085,0.225,0.515,0.775,0.97],v=max(0,min(1,value))
    let i=v<0.12 ? 0:v<0.25 ? 1:v<0.5 ? 2:v<0.75 ? 3:4
    return y[i]+(y[i+1]-y[i])*(v-x[i])/(x[i+1]-x[i])
  }
  static func wanted(_ rgb:[Double],mask:Double,key:Double,look:StudioCinematicSignature)->[Double]{
    let k=key*mask,fg=rgb.enumerated().map{i,v in tone(v*pow(2,look.subjectExposure*(0.18+0.82*k))*(i==0 ? 1+look.temperature*0.05*k:i==2 ? 1-look.temperature*0.04*k:1))}
    let bg=rgb.enumerated().map{i,v in tone(v*pow(2,look.backgroundExposure)*(i==0 ? 0.99:i==2 ? 1.015:1))}
    func color(_ values:[Double],_ saturation:Double)->[Double]{let y=values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;return values.map{y+($0-y)*saturation}}
    let f=color(fg,0.97),b=color(bg,0.88)
    return rgb.enumerated().map{i,v in max(0,min(1,v+((b[i]*(1-mask)+f[i]*mask)-v)*look.strength))}
  }
  static func main()async throws{
    assert(StudioEffectRenderer.cinematicSignatureAvailable)
    // The face anchor selects the creator even when a larger, disconnected
    // vase/plant was misclassified. Connected arms and original soft hair
    // stay; no new alpha is painted into the background.
    var rawMatte=[UInt8](repeating:0,count:32*24)
    for y in 4..<20 { for x in 3..<12 { rawMatte[y*32+x]=230 } }
    for x in 12..<20 { rawMatte[15*32+x]=180 }
    for y in 1..<23 { for x in 24..<32 { rawMatte[y*32+x]=245 } }
    rawMatte[10*32+2]=40;rawMatte[10*32+1]=20;rawMatte[10*32]=10
    let creator=StudioSignatureMatte.principalPerson(rawMatte,width:32,height:24,face:CGRect(x:3.0/32,y:4.0/24,width:9.0/32,height:7.0/24))
    assert(creator[10*32+6]==230&&creator[15*32+19]==180,"Creator body and connected arm survive")
    assert(creator[10*32+28]==0,"Disconnected vase/plant cannot receive face treatment")
    assert(creator[10*32+2]==40&&creator[10*32+1]==20&&creator[10*32]==0,"Only two pixels of existing soft fringe survive")
    for i in creator.indices { assert(creator[i] <= rawMatte[i],"Cleanup cannot invent alpha or expand silhouette") }
    let noFace=StudioSignatureMatte.principalPerson(rawMatte,width:32,height:24,face:nil)
    assert(noFace[10*32+28]==245&&noFace[10*32+6]==0,"No-face policy selects largest connected component")
    let renderer=StudioEffectRenderer(),engine=StudioRecipeEngine(),extent=CGRect(x:0,y:0,width:256,height:128)
    func image(_ rgb:[CGFloat])->CIImage { CIImage(color:CIColor(cgColor:CGColor(colorSpace:space,components:rgb+[1])!)).cropped(to:extent) }
    let gray=image([0.5,0.5,0.5]),white=CIImage(color:.white).cropped(to:extent),black=CIImage(color:.black).cropped(to:extent)
    let look=StudioCinematicSignature(version:1,strength:0.85,subjectExposure:0.3,backgroundExposure:-1.2,backgroundBlur:0,temperature:0.18)
    let face=CGRect(x:64,y:16,width:128,height:96),cx=face.midX,cy=face.midY
    let subject=StudioSignatureMasks(person:white,face:white,faceBounds:face),background=StudioSignatureMasks(person:black,face:black,faceBounds:nil)
    for (masks,mask,key,x,y) in [(subject,1.0,0.88,cx,cy),(background,0.0,0.0,CGFloat(30),CGFloat(30))]{
      let treated=try renderer.cinematicSignature(gray,signature:look,masks:masks),p=pixel(treated,renderer,x,y),expected=wanted([0.5,0.5,0.5],mask:mask,key:key,look:look)
      for i in 0..<3{assert(abs(Double(p[i])/255-expected[i])<=2.0/255,"Shared signature math differs")}
    }
    let dark=try renderer.cinematicSignature(gray,signature:look,masks:background),bgPixel=pixel(dark,renderer,30,30)
    assert(bgPixel[0]<85,"Signature visibly darkens background; basic normalization cannot substitute it")
    let absent=try renderer.cinematicSignature(gray,signature:look,masks:nil)
    assert(pixel(absent,renderer,30,30)==bgPixel,"Creator leaving preserves background look, never a previous person mask")
    let disabled=StudioCinematicSignature(version:1,strength:0,subjectExposure:0.3,backgroundExposure:-1.2,backgroundBlur:0.7,temperature:0.18)
    let identity=try renderer.cinematicSignature(gray,signature:disabled,masks:subject)
    assert(pixel(identity,renderer,30,30)==pixel(gray,renderer,30,30))
    // Bright red person on gray background: normalization of the isolated blur
    // must prevent red pixels spilling into the background beside the subject.
    let box=CGRect(x:100,y:20,width:56,height:88),red=image([0.9,0.25,0.15]).cropped(to:box).composited(over:gray)
    let matte=CIImage(color:.white).cropped(to:box).composited(over:black)
    let refined=try renderer.refineSignatureMatte(gray,mask:matte,pixelSize:CGSize(width:4,height:4),faceBounds:nil)
    assert(pixel(refined,renderer,99,64)[0]==0,"Bilateral refinement cannot expand foreground into clean background")
    assert(pixel(refined,renderer,128,64)[0]==255,"Confident person core remains intact")
    let blurLook=StudioCinematicSignature(version:1,strength:1,subjectExposure:0.3,backgroundExposure:-1.2,backgroundBlur:0.6,temperature:0.18)
    let blurred=try renderer.cinematicSignature(red,signature:blurLook,masks:StudioSignatureMasks(person:matte,face:black,faceBounds:nil))
    let boundary=pixel(blurred,renderer,99,64);assert(abs(Int(boundary[0])-Int(boundary[2]))<8,"Foreground cannot leak into background blur")
    let center=pixel(blurred,renderer,128,64),redExpected=wanted([0.9,0.25,0.15],mask:1,key:0,look:blurLook)
    for i in 0..<3{assert(abs(Double(center[i])/255-redExpected[i])<=2.0/255,"Subject must stay sharp during blur")}
    let empty=try renderer.signatureMasks(in:gray)
    assert(empty==nil,"Uniform frame must not inherit a previous person's matte")
    let root=URL(fileURLWithPath:CommandLine.arguments[1]),source=root.appendingPathComponent("original.mp4"),original=try Data(contentsOf:source)
    var recipe:[String:Any]=["version":3,"requiredFeatures":["cinematic-signature-v1"],"timebase":120000,"durationTicks":30000,"mediaType":"video","canvas":["aspectRatio":"landscape","backgroundColor":"#000000"],"output":["profile":"standard","width":640,"height":360,"frameRateNumerator":24,"frameRateDenominator":1,"colorSpace":"rec709"],"assets":[["id":"v","kind":"video","uri":source.absoluteString,"durationTicks":30000,"hasAudio":true]],"clips":[["id":"v1","kind":"video","assetId":"v","startTicks":0,"durationTicks":30000,"sourceStartTicks":0,"sourceEndTicks":30000,"zIndex":0,"rect":["x":0,"y":0,"width":1,"height":1],"rotationDegrees":0,"fit":"contain","opacity":1,"gain":1,"fadeInTicks":0,"fadeOutTicks":0,"effect":"natural","signature":try JSONSerialization.jsonObject(with:JSONEncoder().encode(look))]]]
    func json(_ value:[String:Any])throws->String{String(data:try JSONSerialization.data(withJSONObject:value),encoding:.utf8)!}
    let valid=try json(recipe);_=try StudioRecipeEngine.decode(valid)
    recipe["version"]=2;do{_=try StudioRecipeEngine.decode(json(recipe));assertionFailure("Recipe2 cannot silently ignore signature")}catch{}
    recipe["version"]=3;recipe["requiredFeatures"]=["enhancement-v1"];do{_=try StudioRecipeEngine.decode(json(recipe));assertionFailure("Mismatched feature must fail")}catch{}
    // Text is composited after each source's selective treatments. Its solid
    // glyph edges must not be blurred/graded by the video's signature.
    var textRecipe=try JSONSerialization.jsonObject(with:Data(valid.utf8)) as! [String:Any]
    let title:[String:Any]=["id":"title","kind":"text","startTicks":0,"durationTicks":30000,"sourceStartTicks":0,"sourceEndTicks":0,"zIndex":1,"rect":["x":0.1,"y":0.25,"width":0.8,"height":0.4],"rotationDegrees":0,"fit":"contain","opacity":1,"gain":0,"fadeInTicks":0,"fadeOutTicks":0,"effect":"natural","text":["content":"IHAAA CLASSFY","fontFamily":"system","fontSize":0.15,"color":"#FFFFFF","backgroundColor":"#00000000","alignment":"center"]]
    var textClips=textRecipe["clips"] as! [[String:Any]];textClips.append(title);textRecipe["clips"]=textClips
    let withLook=try await engine.prepare(recipeJSON:json(textRecipe)),lookFrame=try await engine.frame(withLook,at:0.1)
    textClips[0].removeValue(forKey:"signature");textRecipe["clips"]=textClips;textRecipe["version"]=2;textRecipe.removeValue(forKey:"requiredFeatures")
    let cleanText=try await engine.prepare(recipeJSON:json(textRecipe)),cleanFrame=try await engine.frame(cleanText,at:0.1)
    func solidGlyphs(_ cg:CGImage)->[Bool]{
      let image=CIImage(cgImage:cg,options:[.colorSpace:StudioEffectRenderer.outputColorSpace]);var pixels=[UInt8](repeating:0,count:640*360*4)
      renderer.context.render(image,toBitmap:&pixels,rowBytes:640*4,bounds:CGRect(x:0,y:0,width:640,height:360),format:.RGBA8,colorSpace:space)
      return stride(from:0,to:pixels.count,by:4).map{pixels[$0]==255&&pixels[$0+1]==255&&pixels[$0+2]==255}
    }
    let glyphs=solidGlyphs(cleanFrame);assert(glyphs.filter{$0}.count>100,"Fixture contains actual opaque text glyphs")
    assert(glyphs==solidGlyphs(lookFrame),"Video signature cannot change or soften solid text edges")
    let path=root.appendingPathComponent("signature-no-person.mp4")
    _=try await engine.export(requestId:"signature-synthetic",recipeJSON:valid,outputUri:path.absoluteString,progress:{_ in})
    let encoded=AVURLAsset(url:path),audio=try await encoded.loadTracks(withMediaType:.audio),preserved=try Data(contentsOf:source)
    assert(audio.count==1&&preserved==original)
    if CommandLine.arguments.count>2{
      let reference=URL(fileURLWithPath:CommandLine.arguments[2]),raw=CIImage(contentsOf:reference,options:[.applyOrientationProperty:true])!
      let masks=try renderer.signatureMasks(in:raw);assert(masks != nil&&masks?.faceBounds != nil,"Actual provided reference must produce person+face")
      let analyzed=try await engine.analyzeScene(uri:reference.absoluteString,kind:"image",startSeconds:0,endSeconds:0,frameCount:1,signature:true)
      let frames=analyzed["samples"] as! [[String:Any]];assert(frames[0]["personPresent"] as? Bool==true&&frames[0]["facePresent"] as? Bool==true)
      assert(frames[0]["subject"] is [String:Double]&&frames[0]["background"] is [String:Double])
      try JSONSerialization.data(withJSONObject:analyzed).write(to:root.appendingPathComponent("actual-selective-samples.json"))
      let rendered=try renderer.cinematicSignature(raw,signature:look,masks:masks)
      try renderer.context.writePNGRepresentation(of:rendered,to:root.appendingPathComponent("reference-signature.png"),format:.RGBA8,colorSpace:space,options:[:])
      print("PASS Vision person+face on the user-provided reference; actual selective statistics and GPU image artifact")
    }
    print("PASS signature SDR math ≤2/255, face-anchored connected mask preserves hands/soft hair and excludes isolated objects, sharp text glyphs after signature, no red spill, zero identity/noperson background look, strict recipe3 and real MP4+audio/original preserved")
  }
}
