import type { StudioPortraitFace } from './portraitMask';
import type { StudioSceneSample } from '../../../../shared/studio/autoEnhance';
import { measureStudioScene } from '../../../../shared/studio/autoEnhance';
export type StudioSignatureFaceROI = { x:number; y:number; radiusX:number; radiusY:number };
export type StudioSignatureFaceBox = { x:number; y:number; width:number; height:number };
export type StudioSignatureFrame = { width:number; height:number; sourceWidth:number; sourceHeight:number; personAlpha:Float32Array; faceLandmarks:StudioPortraitFace; personPresent:boolean; facePresent:boolean };
export type StudioSignatureMeasurement = { subject:StudioSceneSample|null; background:StudioSceneSample|null; personPresent:boolean; facePresent:boolean };
const oval=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
export function studioSignatureAnalysisSize(width:number,height:number,max=512){
  if(![width,height].every(value=>Number.isFinite(value)&&value>0))throw new Error('O quadro da assinatura não é válido.');
  const scale=Math.min(1,max/Math.max(width,height));return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export function studioSignatureFaceBox(face:StudioPortraitFace):StudioSignatureFaceBox|null{
  if(face.length<468)return null;const points=oval.map(i=>face[i]);if(points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<-.15||p.x>1.15||p.y<-.15||p.y>1.15))return null;
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y)),width=right-left,height=bottom-top;
  if(width<.04||height<.05)return null;return{x:(left+right)/2,y:(top+bottom)/2,width,height};
}
/** Conservative face guard and luminance sample; the lighting key uses signatureLook's shared geometry. */
export function studioSignatureFaceROI(face:StudioPortraitFace):StudioSignatureFaceROI|null{
  const box=studioSignatureFaceBox(face);return box?{x:box.x-box.width*.06,y:box.y-box.height*.08,radiusX:box.width*.63,radiusY:box.height*.68}:null;
}
export function studioSignatureFaceWeight(roi:StudioSignatureFaceROI|null,x:number,y:number){return roi?Math.exp(-2.5*(((x-roi.x)/roi.radiusX)**2+((y-roi.y)/roi.radiusY)**2)):0;}
const smooth=(lo:number,hi:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));return t*t*(3-2*t);};
export function studioSignaturePersonWeight(alpha:number,roi:StudioSignatureFaceROI|null,x:number,y:number){return Math.max(Math.max(0,Math.min(1,alpha)),smooth(.35,.75,studioSignatureFaceWeight(roi,x,y)));}
export function validateStudioSignatureFrame(frame:StudioSignatureFrame,width:number,height:number){
  if(frame.sourceWidth!==width||frame.sourceHeight!==height||![frame.width,frame.height].every(value=>Number.isInteger(value)&&value>0&&value<=512)||frame.personAlpha.length!==frame.width*frame.height||frame.personAlpha.some(value=>!Number.isFinite(value)||value<0||value>1))throw new Error('A separação da pessoa neste quadro não foi confirmada. A assinatura não pode ser exportada.');
}
export function studioSignatureMaskPixel(frame:StudioSignatureFrame,x:number,y:number){
  const px=Math.max(0,Math.min(frame.width-1,x*frame.width-.5)),py=Math.max(0,Math.min(frame.height-1,y*frame.height-.5)),left=Math.floor(px),top=Math.floor(py),right=Math.min(frame.width-1,left+1),bottom=Math.min(frame.height-1,top+1),fx=px-left,fy=py-top;
  const a=frame.personAlpha[top*frame.width+left]*(1-fx)+frame.personAlpha[top*frame.width+right]*fx,b=frame.personAlpha[bottom*frame.width+left]*(1-fx)+frame.personAlpha[bottom*frame.width+right]*fx;return a*(1-fy)+b*fy;
}
export function measureStudioSignaturePixels(rgba:Uint8ClampedArray,width:number,height:number,frame:StudioSignatureFrame):StudioSignatureMeasurement{
  if(rgba.length!==width*height*4)throw new Error('A análise da assinatura não contém todos os pixels.');
  const roi=studioSignatureFaceROI(frame.faceLandmarks),subject=new Uint8ClampedArray(rgba.length),background=new Uint8ClampedArray(rgba.length);let subjects=0,backgrounds=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=(y*width+x)*4,nx=(x+.5)/width,ny=(y+.5)/height,alpha=studioSignaturePersonWeight(studioSignatureMaskPixel(frame,nx,ny),roi,nx,ny);
    const useSubject=roi?studioSignatureFaceWeight(roi,nx,ny)>.35&&alpha>.6:alpha>.85;
    if(useSubject&&rgba[index+3]>=128){subject.set(rgba.subarray(index,index+4),index);subjects++;}if(alpha<.12&&rgba[index+3]>=128){background.set(rgba.subarray(index,index+4),index);backgrounds++;}
  }
  return{subject:subjects>=12?measureStudioScene(subject):null,background:backgrounds>=12?measureStudioScene(background):null,personPresent:frame.personPresent||!!roi,facePresent:!!roi};
}
