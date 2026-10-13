import type { StudioSignature } from '../../../../shared/studio';
import { assertStudioActive, studioCanvas } from './media';
import { createStudioSignatureDetector, type StudioSignatureDetector } from './signatureClient';
import { measureStudioSignaturePixels, studioSignatureAnalysisSize, studioSignatureFaceBox, studioSignatureFaceROI, validateStudioSignatureFrame, type StudioSignatureFrame, type StudioSignatureMeasurement } from './signatureMask';

export type { StudioSignatureFrame, StudioSignatureMeasurement } from './signatureMask';
export type StudioSignatureSurface = {
  prepare(signal?: AbortSignal): Promise<void>;
  analyze(source: CanvasImageSource, width: number, height: number, signal?: AbortSignal): Promise<StudioSignatureFrame>;
  render(source: CanvasImageSource, width: number, height: number, signature: StudioSignature, signal?: AbortSignal, analysis?: StudioSignatureFrame): Promise<CanvasImageSource>;
  dispose(): void;
};
const vertex = 'attribute vec2 p; varying vec2 uv; void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}';
const header = `precision highp float; varying vec2 uv;
vec2 bounded(vec2 v){return clamp(v,vec2(0.),vec2(1.));}
vec4 framebufferPixel(sampler2D tex,vec2 at){return texture2D(tex,vec2(at.x,1.-at.y));}`;
const maskShader = `${header}
uniform sampler2D image,matte; uniform vec2 maskStep; uniform vec4 faceGuard;
void add(vec2 offset,float spatial,vec3 center,inout float sum,inout float weight){
  vec2 at=bounded(uv+offset); vec3 delta=texture2D(image,at).rgb-center;
  float guide=exp(-dot(delta,delta)/(2.*.09*.09)); float w=spatial*guide;
  sum+=texture2D(matte,at).r*w;weight+=w;
}
void main(){
  vec3 center=texture2D(image,uv).rgb;float original=texture2D(matte,uv).r;
  float sum=original,weight=1.;
  add(vec2(maskStep.x,0.),.75,center,sum,weight);add(vec2(-maskStep.x,0.),.75,center,sum,weight);
  add(vec2(0.,maskStep.y),.75,center,sum,weight);add(vec2(0.,-maskStep.y),.75,center,sum,weight);
  add(maskStep,.5,center,sum,weight);add(-maskStep,.5,center,sum,weight);
  add(vec2(maskStep.x,-maskStep.y),.5,center,sum,weight);add(vec2(-maskStep.x,maskStep.y),.5,center,sum,weight);
  float alpha=mix(original,sum/weight,.6);
  if(faceGuard.z>0.&&faceGuard.w>0.){vec2 d=(uv-faceGuard.xy)/faceGuard.zw;alpha=max(alpha,smoothstep(.35,.75,exp(-2.5*dot(d,d))));}
  gl_FragColor=vec4(vec3(clamp(alpha,0.,1.)),1.);
}`;
const horizontalShader = `${header}
uniform sampler2D image,person; uniform vec2 blurStep;
float linearChannel(float v){return v<=.04045?v/12.92:pow((v+.055)/1.055,2.4);}
vec3 linearRGB(vec3 c){return vec3(linearChannel(c.r),linearChannel(c.g),linearChannel(c.b));}
vec4 background(vec2 at){at=bounded(at);float weight=1.-framebufferPixel(person,at).r;return vec4(linearRGB(texture2D(image,at).rgb)*weight,weight);}
void main(){
  vec4 value=background(uv)*.20416369;
  value+=(background(uv+blurStep)+background(uv-blurStep))*.18017382;
  value+=(background(uv+blurStep*2.)+background(uv-blurStep*2.))*.12383154;
  value+=(background(uv+blurStep*3.)+background(uv-blurStep*3.))*.06628225;
  value+=(background(uv+blurStep*4.)+background(uv-blurStep*4.))*.02763055;
  gl_FragColor=value;
}`;
const outputShader = `${header}
uniform sampler2D image,person,blurred; uniform vec2 blurStep;
uniform vec4 faceBox;uniform float strength,subjectExposure,backgroundExposure,temperature;
float tone(float value){
  float v=clamp(value,0.,1.);
  if(v<.12)return v*(.085/.12);
  if(v<.25)return .085+(v-.12)*(.14/.13);
  if(v<.5)return .225+(v-.25)*(.29/.25);
  if(v<.75)return .515+(v-.5)*(.26/.25);
  return .775+(v-.75)*(.195/.25);
}
vec3 cinema(vec3 c){return vec3(tone(c.r),tone(c.g),tone(c.b));}
float encodedChannel(float v){return v<=.0031308?v*12.92:1.055*pow(max(0.,v),1./2.4)-.055;}
vec3 encodedRGB(vec3 c){return vec3(encodedChannel(c.r),encodedChannel(c.g),encodedChannel(c.b));}
vec3 saturation(vec3 c,float amount){float y=dot(c,vec3(.2126,.7152,.0722));return vec3(y)+(c-vec3(y))*amount;}
float faceKey(){
  if(faceBox.z<=0.||faceBox.w<=0.)return 0.;
  vec2 d=(uv-faceBox.xy)/(faceBox.zw*vec2(.6,.7));
  float t=clamp((length(d)-.55)/.57,0.,1.);float feather=1.-t*t*(3.-2.*t);
  float direction=clamp(.6-.22*d.x-.16*d.y,.18,1.);return feather*(.7+.3*direction);
}
void main(){
  vec4 original=texture2D(image,uv);float alpha=clamp(framebufferPixel(person,uv).r,0.,1.),key=faceKey()*alpha;
  vec4 background=framebufferPixel(blurred,uv)*.20416369;
  background+=(framebufferPixel(blurred,bounded(uv+blurStep))+framebufferPixel(blurred,bounded(uv-blurStep)))*.18017382;
  background+=(framebufferPixel(blurred,bounded(uv+blurStep*2.))+framebufferPixel(blurred,bounded(uv-blurStep*2.)))*.12383154;
  background+=(framebufferPixel(blurred,bounded(uv+blurStep*3.))+framebufferPixel(blurred,bounded(uv-blurStep*3.)))*.06628225;
  background+=(framebufferPixel(blurred,bounded(uv+blurStep*4.))+framebufferPixel(blurred,bounded(uv-blurStep*4.)))*.02763055;
  // Normalize only background contributions; sharp hair, hands and the face never bleed into the blur.
  vec3 bgRGB=background.a>.001?encodedRGB(background.rgb/background.a):original.rgb;
  vec3 fg=saturation(cinema(original.rgb*exp2(subjectExposure*(.18+.82*key))*vec3(1.+temperature*.05*key,1.,1.-temperature*.04*key)),.97);
  vec3 bg=saturation(cinema(bgRGB*exp2(backgroundExposure)*vec3(.99,1.,1.015)),.88);
  gl_FragColor=vec4(clamp(mix(original.rgb,mix(bg,fg,alpha),strength),0.,1.),original.a);
}`;
const abort = () => new DOMException('A assinatura foi encerrada.', 'AbortError');
function validateSignature(signature:StudioSignature) {
  const ranges:[number,number,number][]=[[signature.strength,0,1],[signature.subjectExposure,-.5,1],[signature.backgroundExposure,-2,0],[signature.backgroundBlur,0,1],[signature.temperature,-1,1]];
  if(signature.version!==1||ranges.some(([value,min,max])=>!Number.isFinite(value)||value<min||value>max))throw new Error('Os parâmetros da assinatura não foram confirmados.');
}
/** One worker and GPU per retained editor/export surface; analysis is stateless and never persists a frame. */
export function createStudioSignatureSurface():StudioSignatureSurface {
  const canvas=studioCanvas(1,1),analysis=studioCanvas(1,1);
  let detector:StudioSignatureDetector|null=null,gl:WebGLRenderingContext|null=null,closed=false,queue=Promise.resolve();
  let vertices:WebGLBuffer|null=null,sourceTexture:WebGLTexture|null=null,matteTexture:WebGLTexture|null=null;
  let maskTexture:WebGLTexture|null=null,blurTexture:WebGLTexture|null=null,maskFBO:WebGLFramebuffer|null=null,blurFBO:WebGLFramebuffer|null=null;
  let maskProgram:WebGLProgram|null=null,horizontalProgram:WebGLProgram|null=null,outputProgram:WebGLProgram|null=null,targetWidth=0,targetHeight=0,halfFloatType=0;
  const active=(signal?:AbortSignal)=>{assertStudioActive(signal);if(closed)throw abort();};
  function initializeGL(){
    if(gl)return;
    const context=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!context)throw new Error('Este navegador não oferece GPU para separar a pessoa e o fundo. A assinatura não foi aplicada.');
    gl=context;
    const shader=(type:number,code:string)=>{const result=context.createShader(type);if(!result)throw new Error('Não foi possível preparar a assinatura na GPU.');context.shaderSource(result,code);context.compileShader(result);if(!context.getShaderParameter(result,context.COMPILE_STATUS)){context.deleteShader(result);throw new Error('A GPU não compilou a assinatura.');}return result;};
    const program=(fragment:string)=>{const result=context.createProgram();if(!result)throw new Error('Não foi possível preparar a assinatura na GPU.');const v=shader(context.VERTEX_SHADER,vertex),f=shader(context.FRAGMENT_SHADER,fragment);context.attachShader(result,v);context.attachShader(result,f);context.linkProgram(result);context.deleteShader(v);context.deleteShader(f);if(!context.getProgramParameter(result,context.LINK_STATUS)){context.deleteProgram(result);throw new Error('A GPU não confirmou a assinatura.');}return result;};
    const texture=()=>{const result=context.createTexture();if(!result)throw new Error('A GPU não reservou os pixels da assinatura.');context.bindTexture(context.TEXTURE_2D,result);for(const parameter of[context.TEXTURE_MIN_FILTER,context.TEXTURE_MAG_FILTER])context.texParameteri(context.TEXTURE_2D,parameter,context.LINEAR);for(const parameter of[context.TEXTURE_WRAP_S,context.TEXTURE_WRAP_T])context.texParameteri(context.TEXTURE_2D,parameter,context.CLAMP_TO_EDGE);return result;};
    try{
      const half=context.getExtension('OES_texture_half_float');
      if(!half||!context.getExtension('OES_texture_half_float_linear')||!context.getExtension('EXT_color_buffer_half_float'))throw new Error('A GPU não suporta as camadas de luz da assinatura. A exportação foi interrompida.');
      halfFloatType=half.HALF_FLOAT_OES;
      maskProgram=program(maskShader);horizontalProgram=program(horizontalShader);outputProgram=program(outputShader);
      vertices=context.createBuffer();if(!vertices)throw new Error('A GPU não reservou a geometria da assinatura.');context.bindBuffer(context.ARRAY_BUFFER,vertices);context.bufferData(context.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),context.STATIC_DRAW);
      sourceTexture=texture();matteTexture=texture();maskTexture=texture();blurTexture=texture();maskFBO=context.createFramebuffer();blurFBO=context.createFramebuffer();if(!maskFBO||!blurFBO)throw new Error('A GPU não reservou as camadas da assinatura.');
    }catch(error){releaseGL();throw error;}
  }
  function releaseGL(){
    if(gl){for(const value of[sourceTexture,matteTexture,maskTexture,blurTexture])gl.deleteTexture(value);for(const value of[maskFBO,blurFBO])gl.deleteFramebuffer(value);for(const value of[maskProgram,horizontalProgram,outputProgram])gl.deleteProgram(value);gl.deleteBuffer(vertices);gl.getExtension('WEBGL_lose_context')?.loseContext();}
    gl=null;sourceTexture=matteTexture=maskTexture=blurTexture=null;maskFBO=blurFBO=null;maskProgram=horizontalProgram=outputProgram=null;vertices=null;targetWidth=targetHeight=0;
  }
  function bindPass(program:WebGLProgram,target:WebGLFramebuffer|null,width:number,height:number){
    const context=gl!;context.bindFramebuffer(context.FRAMEBUFFER,target);context.viewport(0,0,width,height);context.useProgram(program);context.bindBuffer(context.ARRAY_BUFFER,vertices);const location=context.getAttribLocation(program,'p');context.enableVertexAttribArray(location);context.vertexAttribPointer(location,2,context.FLOAT,false,0,0);
  }
  function bind(program:WebGLProgram,name:string,unit:number,texture:WebGLTexture){const context=gl!;context.activeTexture(context.TEXTURE0+unit);context.bindTexture(context.TEXTURE_2D,texture);context.uniform1i(context.getUniformLocation(program,name),unit);}
  function allocate(width:number,height:number){
    const context=gl!;if(width===targetWidth&&height===targetHeight)return;
    if(width>context.getParameter(context.MAX_TEXTURE_SIZE)||height>context.getParameter(context.MAX_TEXTURE_SIZE))throw new Error('A GPU não suporta a assinatura nesta resolução. Seus originais continuam preservados.');
    canvas.width=width;canvas.height=height;
    for(const[texture,fbo,type]of[[maskTexture!,maskFBO!,context.UNSIGNED_BYTE],[blurTexture!,blurFBO!,halfFloatType]]as const){context.bindTexture(context.TEXTURE_2D,texture);context.texImage2D(context.TEXTURE_2D,0,context.RGBA,width,height,0,context.RGBA,type,null);context.bindFramebuffer(context.FRAMEBUFFER,fbo);context.framebufferTexture2D(context.FRAMEBUFFER,context.COLOR_ATTACHMENT0,context.TEXTURE_2D,texture,0);if(context.checkFramebufferStatus(context.FRAMEBUFFER)!==context.FRAMEBUFFER_COMPLETE)throw new Error('A GPU não confirmou as camadas da assinatura nesta resolução.');}
    targetWidth=width;targetHeight=height;
  }
  function drawPass(){const context=gl!;context.drawArrays(context.TRIANGLE_STRIP,0,4);if(context.getError()!==context.NO_ERROR)throw new Error('A GPU não concluiu a assinatura deste quadro. A exportação foi interrompida.');}
  async function analyzeFrame(source:CanvasImageSource,width:number,height:number,signal?:AbortSignal):Promise<StudioSignatureFrame>{
    active(signal);const size=studioSignatureAnalysisSize(width,height);detector??=createStudioSignatureDetector();analysis.width=size.width;analysis.height=size.height;const context=analysis.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Não foi possível analisar a cena localmente.');context.drawImage(source,0,0,size.width,size.height);
    // Explicit bounded RGBA avoids different GPU-backed ImageBitmap conversions between seek and export.
    const bitmap=await createImageBitmap(context.getImageData(0,0,size.width,size.height));try{active(signal);}catch(error){bitmap.close();throw error;}
    const result=await detector.analyze(bitmap,signal);active(signal);
    if(!result.personAlpha||!result.width||!result.height)throw new Error('A separação da pessoa não entregou todos os pixels.');
    const faceLandmarks=result.faceLandmarks??[],facePresent=!!studioSignatureFaceBox(faceLandmarks),strong=result.personAlpha.reduce((count,value)=>count+(value>.6?1:0),0);
    const frame:StudioSignatureFrame={width:result.width,height:result.height,sourceWidth:width,sourceHeight:height,personAlpha:result.personAlpha,faceLandmarks,facePresent,personPresent:facePresent||strong>Math.max(12,result.personAlpha.length*.02)};validateStudioSignatureFrame(frame,width,height);return frame;
  }
  async function renderFrame(source:CanvasImageSource,width:number,height:number,signature:StudioSignature,signal?:AbortSignal,provided?:StudioSignatureFrame):Promise<CanvasImageSource>{
    active(signal);validateSignature(signature);studioSignatureAnalysisSize(width,height);if(signature.strength===0)return source;
    initializeGL();const frame=provided??await analyzeFrame(source,width,height,signal);active(signal);validateStudioSignatureFrame(frame,width,height);
    const context=gl!;if(context.isContextLost())throw new Error('A GPU interrompeu a assinatura. Reabra o editor para continuar.');allocate(width,height);
    context.activeTexture(context.TEXTURE0);context.bindTexture(context.TEXTURE_2D,sourceTexture);context.texImage2D(context.TEXTURE_2D,0,context.RGBA,context.RGBA,context.UNSIGNED_BYTE,source as TexImageSource);
    const mask=new Uint8Array(frame.personAlpha.length);for(let index=0;index<mask.length;index++)mask[index]=Math.round(frame.personAlpha[index]*255);
    context.activeTexture(context.TEXTURE1);context.bindTexture(context.TEXTURE_2D,matteTexture);context.pixelStorei(context.UNPACK_ALIGNMENT,1);context.texImage2D(context.TEXTURE_2D,0,context.LUMINANCE,frame.width,frame.height,0,context.LUMINANCE,context.UNSIGNED_BYTE,mask);
    const guard=studioSignatureFaceROI(frame.faceLandmarks),face=studioSignatureFaceBox(frame.faceLandmarks);
    bindPass(maskProgram!,maskFBO,width,height);bind(maskProgram!,'image',0,sourceTexture!);bind(maskProgram!,'matte',1,matteTexture!);context.uniform2f(context.getUniformLocation(maskProgram!,'maskStep'),1/frame.width,1/frame.height);context.uniform4f(context.getUniformLocation(maskProgram!,'faceGuard'),guard?.x??0,guard?.y??0,guard?.radiusX??0,guard?.radiusY??0);drawPass();
    // Nine normalized Gaussian taps, effective sigma = radius. The matte excludes subject colour in both passes.
    const radius=Math.min(width,height)*.035*signature.backgroundBlur,step=radius/1.851555;
    bindPass(horizontalProgram!,blurFBO,width,height);bind(horizontalProgram!,'image',0,sourceTexture!);bind(horizontalProgram!,'person',1,maskTexture!);context.uniform2f(context.getUniformLocation(horizontalProgram!,'blurStep'),step/width,0);drawPass();
    bindPass(outputProgram!,null,width,height);bind(outputProgram!,'image',0,sourceTexture!);bind(outputProgram!,'person',1,maskTexture!);bind(outputProgram!,'blurred',2,blurTexture!);context.uniform2f(context.getUniformLocation(outputProgram!,'blurStep'),0,step/height);context.uniform4f(context.getUniformLocation(outputProgram!,'faceBox'),face?.x??0,face?.y??0,face?.width??0,face?.height??0);
    for(const[name,value]of Object.entries({strength:signature.strength,subjectExposure:signature.subjectExposure,backgroundExposure:signature.backgroundExposure,temperature:signature.temperature}))context.uniform1f(context.getUniformLocation(outputProgram!,name),value);drawPass();active(signal);return canvas;
  }
  function run<T>(source:CanvasImageSource,signal:AbortSignal|undefined,work:(frame:ImageBitmap)=>Promise<T>):Promise<T>{
    try{active(signal);}catch(error){return Promise.reject(error);}const captured=createImageBitmap(source);void captured.catch(()=>undefined);
    const next=queue.then(async()=>{const frame=await captured;try{active(signal);return await work(frame);}finally{frame.close();}});queue=next.then(()=>undefined,()=>undefined);return next;
  }
  return{
    async prepare(signal){active(signal);initializeGL();detector??=createStudioSignatureDetector();await detector.prepare(signal);active(signal);},
    analyze(source,width,height,signal){return run(source,signal,frame=>analyzeFrame(frame,width,height,signal));},
    render(source,width,height,signature,signal,provided){try{validateSignature(signature);active(signal);}catch(error){return Promise.reject(error);}if(signature.strength===0)return Promise.resolve(source);return run(source,signal,frame=>renderFrame(frame,width,height,signature,signal,provided));},
    dispose(){if(closed)return;closed=true;detector?.dispose();detector=null;releaseGL();canvas.width=canvas.height=analysis.width=analysis.height=1;},
  };
}
/** Measure original face/person/background separately; no frame or mask survives the call. */
export async function measureStudioSignature(source:CanvasImageSource,width:number,height:number,signal?:AbortSignal,supplied?:StudioSignatureSurface):Promise<StudioSignatureMeasurement>{
  assertStudioActive(signal);const surface=supplied??createStudioSignatureSurface();let snapshot:ImageBitmap|undefined;
  try{snapshot=await createImageBitmap(source);assertStudioActive(signal);const frame=await surface.analyze(snapshot,width,height,signal);assertStudioActive(signal);const size=studioSignatureAnalysisSize(width,height,256),sample=studioCanvas(size.width,size.height),context=sample.getContext('2d');if(!context)throw new Error('A luz da pessoa e do fundo não pôde ser medida.');context.drawImage(snapshot,0,0,size.width,size.height);const result=measureStudioSignaturePixels(context.getImageData(0,0,size.width,size.height).data,size.width,size.height,frame);sample.width=sample.height=1;return result;}finally{snapshot?.close();if(!supplied)surface.dispose();}
}
