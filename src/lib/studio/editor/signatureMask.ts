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
  const box=studioSignatureFaceBox(face);return box?{x:box.x,y:box.y,radiusX:box.width*.5,radiusY:box.height*.55}:null;
}
export function studioSignatureFaceWeight(roi:StudioSignatureFaceROI|null,x:number,y:number){return roi?Math.exp(-2.5*(((x-roi.x)/roi.radiusX)**2+((y-roi.y)/roi.radiusY)**2)):0;}
const smooth=(lo:number,hi:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));return t*t*(3-2*t);};
export function studioSignaturePersonWeight(alpha:number,roi:StudioSignatureFaceROI|null,x:number,y:number){return Math.max(Math.max(0,Math.min(1,alpha)),smooth(.35,.75,studioSignatureFaceWeight(roi,x,y)));}
/** Official multiclass semantics: objects/accessories (others) and background are not human skin/hair/clothes. */
export function studioSignatureMulticlassPerson(masks:readonly Float32Array[],width:number,height:number,labels:readonly string[]):Float32Array{
  const expected=['background','hair','body-skin','face-skin','clothes','others'];
  if(labels.length!==6||labels.some((label,index)=>label!==expected[index])||masks.length!==6||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||masks.some(mask=>mask.length!==width*height))throw new Error('O modelo não confirmou as classes da pessoa.');
  const person=new Float32Array(width*height);
  for(let index=0;index<masks.length;index++)for(let pixel=0;pixel<person.length;pixel++){
    const value=masks[index][pixel];if(!Number.isFinite(value)||value<0||value>1)throw new Error('A confiança da separação da pessoa não foi confirmada.');
    if(index>=1&&index<=4)person[pixel]+=value;
  }
  for(let pixel=0;pixel<person.length;pixel++)person[pixel]=Math.max(0,Math.min(1,person[pixel]));return person;
}
/** Keep the creator attached to the current face, not furniture/plant islands. No history or alpha dilation. */
export function studioSignaturePrincipalPerson(alpha:Float32Array,width:number,height:number,face:StudioPortraitFace):Float32Array{
  if(alpha.length!==width*height||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||alpha.some(value=>!Number.isFinite(value)||value<0||value>1))throw new Error('A máscara da pessoa está incompleta.');
  const labels=new Int32Array(alpha.length),queue=new Int32Array(alpha.length),box=studioSignatureFaceBox(face),components:{size:number;faceOverlap:number}[]=[{size:0,faceOverlap:0}];
  let serial=0;
  for(let start=0;start<alpha.length;start++){
    if(labels[start]||alpha[start]<.25)continue;
    const id=++serial,stats={size:0,faceOverlap:0};components.push(stats);let first=0,last=1;queue[0]=start;labels[start]=id;
    while(first<last){
      const index=queue[first++],x=index%width,y=Math.floor(index/width);stats.size++;
      if(box){const dx=((x+.5)/width-box.x)/(box.width*.45),dy=((y+.5)/height-box.y)/(box.height*.45);if(dx*dx+dy*dy<=1)stats.faceOverlap+=alpha[index];}
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;const neighbor=ny*width+nx;
        if(!labels[neighbor]&&alpha[neighbor]>=.25){labels[neighbor]=id;queue[last++]=neighbor;}
      }
    }
  }
  const result=new Float32Array(alpha.length);if(!serial)return result;
  let principal=1;
  for(let id=2;id<=serial;id++){const own=components[id],chosen=components[principal];if(own.faceOverlap>chosen.faceOverlap||own.faceOverlap===chosen.faceOverlap&&own.size>chosen.size)principal=id;}
  // Only existing soft pixels within two mask pixels of the selected component are retained.
  // This protects strands/antialiasing without retaining an entire detached object or filling a hole.
  for(let index=0;index<alpha.length;index++){
    if(labels[index]===principal){result[index]=alpha[index];continue;}if(alpha[index]<=0)continue;
    const x=index%width,y=Math.floor(index/width);let near=false;
    for(let dy=-2;dy<=2&&!near;dy++)for(let dx=-2;dx<=2;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<width&&ny>=0&&ny<height&&labels[ny*width+nx]===principal){near=true;break;}}
    if(near)result[index]=alpha[index];
  }
  return result;
}
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
