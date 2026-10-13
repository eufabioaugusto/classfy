#!/bin/bash
set -euo pipefail
studio_grade_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_grade_mobile="$(cd "$studio_grade_root/../.." && pwd)"
studio_grade_temp="$(mktemp -d "${TMPDIR:-/tmp}/classfy-remote-grade.XXXXXX")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=gray:s=3840x2160:r=30:d=0.4 \
  -f lavfi -i sine=frequency=440:sample_rate=48000:duration=0.4 \
  -vf 'drawbox=x=0:y=0:w=320:h=320:color=blue:t=fill' -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac "$studio_grade_temp/source.mov"
cd "$studio_grade_mobile"
node --experimental-strip-types --input-type=module - "$studio_grade_temp" <<'JS'
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {compileStudioRecipe,emptyStudioEditing,reconcileStudioTakes} from './src/features/studio/model.ts';
const root=process.argv[2],uri=pathToFileURL(`${root}/source.mov`).toString();
for(const name of ['natural','warm']){
 const grade=name==='warm'?{preset:'natural',intensity:0.7,exposure:0.25,contrast:0.1,saturation:0.15,temperature:0.4}:undefined;
 const take={id:'source',uri,name:'source',duration:0.4,start:0,end:0.4,width:3840,height:2160,frameRate:30,hasAudio:true,grade};
 const editing=reconcileStudioTakes({kind:'aula',takes:[],editing:emptyStudioEditing('aula')},[take]);
 writeFileSync(`${root}/${name}.json`,JSON.stringify(compileStudioRecipe({kind:'aula',takes:[take],editing})));
}
JS
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_grade_root/ios/StudioEffectRenderer.swift" "$studio_grade_root/ios/StudioVideoCompositor.swift" \
  "$studio_grade_root/ios/StudioRecipeVisualEffects.swift" "$studio_grade_root/ios/StudioRecipeEngine.swift" \
  "$studio_grade_root/tests/StudioRemoteCameraGradeTests.swift" -o "$studio_grade_temp/verify-remote-grade"
"$studio_grade_temp/verify-remote-grade" "$studio_grade_temp"
ffmpeg -hide_banner -loglevel error -i "$studio_grade_temp/warm-4k.mp4" -map 0:a:0 -ac 1 -f f32le - | python3 -c '
import array,math,sys
samples=array.array("f",sys.stdin.buffer.read())
rms=math.sqrt(sum(value*value for value in samples)/len(samples))
assert len(samples)>10000 and rms>0.01, (len(samples),rms)
print("PASS decoded audio is present and audible: RMS %.5f (%d samples)"%(rms,len(samples)))'
printf 'Artifacts: %s\n' "$studio_grade_temp"
