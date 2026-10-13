import { describe, expect, it } from 'vitest';
import { drawStudioPortraitMask, studioPortraitAnalysisSize, studioPortraitRegions, studioPortraitFaceWidth, type StudioPortraitFace } from './portraitMask';
import { studioPortraitPixel } from './portraitRender';
function face(): StudioPortraitFace {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  oval.forEach((index, i) => { const angle = Math.PI * 2 * i / oval.length; points[index] = { x: .5 + Math.sin(angle) * .3, y: .5 - Math.cos(angle) * .4 }; });
  for (const [indices, x, y] of [[[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246], .38, .42], [[362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398], .62, .42], [[70,63,105,66,107,55,65,52,53,46], .38, .33], [[336,296,334,293,300,276,283,282,295,285], .62, .33], [[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185], .5, .68]] as [number[], number, number][]) indices.forEach((index, i) => { const angle = Math.PI * 2 * i / indices.length; points[index] = { x: x + Math.cos(angle) * .06, y: y + Math.sin(angle) * .02 }; });
  return points;
}
describe('geometria e tratamento natural do retrato', () => {
  it('4K landscape/portrait analisam apenas640px sem alterar proporção ou ampliar fonte pequena', () => {
    expect(studioPortraitAnalysisSize(3840,2160)).toEqual({ width:640,height:360 }); expect(studioPortraitAnalysisSize(2160,3840)).toEqual({ width:360,height:640 }); expect(studioPortraitAnalysisSize(320,180)).toEqual({ width:320,height:180 });
    expect(() => studioPortraitAnalysisSize(NaN,720)).toThrow('quadro');
  });
  it('contrai contorno e exclui olhos, lábios e sobrancelhas com margem', () => {
    const original = face(), regions = studioPortraitRegions(original); expect(regions).toHaveLength(6); expect(regions.filter(region => region.protected)).toHaveLength(5);
    expect(studioPortraitFaceWidth(original)).toBeLessThan(.6); expect(studioPortraitFaceWidth(original)).toBeGreaterThan(.5);
    expect(regions[1].points[0].x).toBeGreaterThan(original[33].x); expect(regions[5].points[0].x).toBeGreaterThan(original[61].x);
    expect(original).toEqual(face());
  });
  it('ausência, pontos corrompidos ou rosto distante não produzem máscara', () => {
    expect(studioPortraitRegions([])).toEqual([]); const value=face(); value[33].x=NaN; expect(studioPortraitRegions(value)).toEqual([]);
    expect(studioPortraitRegions(face().map(point => ({ x:.5+(point.x-.5)*.01, y:.5+(point.y-.5)*.01 })))).toEqual([]);
  });
  it('força zero e regiões protegidas são identidade, inclusive pele clara/escura', () => {
    for(const rgb of [[.04,.02,.01],[.7,.5,.3],[.99,.96,.94]]) { expect(studioPortraitPixel(rgb,.5,1,0)).toEqual(rgb); expect(studioPortraitPixel(rgb,.5,0,1)).toEqual(rgb); }
  });
  it('reduz microcontraste com envelope bounded e conserva diferenças cromáticas', () => {
    const rgb=[.4,.3,.2], treated=studioPortraitPixel(rgb,.6,1,1); expect(treated[0]-rgb[0]).toBeCloseTo(.0135);
    expect(treated[0]-treated[1]).toBeCloseTo(rgb[0]-rgb[1]); expect(treated[1]-treated[2]).toBeCloseTo(rgb[1]-rgb[2]);
    const half=studioPortraitPixel(rgb,.6,1,.5); expect(half[0]-rgb[0]).toBeCloseTo((treated[0]-rgb[0])/2);
    expect(studioPortraitPixel([1,.9,.8],1,1,1)).toEqual([1,.9,.8]); expect(studioPortraitPixel([.2,.1,0],0,1,1)).toEqual([.2,.1,0]);
  });
  it('v2 acrescenta nariz e desenha exclusões duras somente após feather do contorno', () => {
    const value=face();
    [168,6,197,195,5,4,1,19,94,2,98,97,326,327,294,278,344,440,275,45,220,115,48,64].forEach((id,i)=>{
      value[id]={x:.5+Math.cos(i/24*Math.PI*2)*.025,y:.54+Math.sin(i/24*Math.PI*2)*.08};
    });
    const original=structuredClone(value), regions=studioPortraitRegions(value,2);
    expect(regions).toHaveLength(7); expect(regions[6].protected).toBe(true);
    expect(Math.max(...regions[6].points.map(p=>p.x))-.5).toBeGreaterThan(.025);
    const passes:{filter:string;fillStyle:string}[]=[];
    let clips=0, strokes=0;
    const ctx={filter:'none',fillStyle:'',fillRect(){},save(){},restore(){},stroke(){strokes++;},clip(){clips++;},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){passes.push({filter:this.filter,fillStyle:this.fillStyle});}};
    const canvas={width:1,height:1,getContext:()=>ctx} as unknown as HTMLCanvasElement;
    expect(drawStudioPortraitMask(canvas,value,640,360,2)).toBe(true);
    expect(passes[0]).toEqual({filter:'blur(1.5px)',fillStyle:'#fff'});
    expect(passes.slice(1)).toEqual(Array(6).fill({filter:'none',fillStyle:'#000'}));
    expect(clips).toBe(1);
    expect(strokes).toBe(6);
    expect(ctx.filter).toBe('none'); expect(value).toEqual(original);
    expect(studioPortraitPixel([.4,.3,.2],.8,1,1,2)[0]-.4).toBeGreaterThan(studioPortraitPixel([.4,.3,.2],.8,1,1,1)[0]-.4);
  });
});
