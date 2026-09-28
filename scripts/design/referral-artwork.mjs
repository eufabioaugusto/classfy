// Editable vector source + PNG export. Pass the absolute bundled sharp module path.
import { mkdir, writeFile } from 'node:fs/promises';
const {default:sharp}=await import(process.argv[2]);
const root='public/referrals'; await mkdir(root,{recursive:true});
const illustration=`<g transform="translate(45 30)">
 <circle cx="275" cy="240" r="218" fill="#fff0f3"/><path d="M60 235C40 20 508 20 480 295" stroke="#f2b2c1" stroke-width="2" stroke-dasharray="7 10" fill="none"/>
 <g transform="translate(35 124) rotate(-14 130 130)"><rect width="238" height="275" rx="28" fill="#e2dce8"/><rect y="-9" width="238" height="275" rx="28" fill="#fff" stroke="#ece8eb"/>
 <rect x="18" y="9" width="202" height="180" rx="19" fill="#e8e3f0"/><circle cx="119" cy="99" r="42" fill="#fff"/><path d="M108 76l35 23-35 23z" fill="#1e1729"/>
 <rect x="23" y="207" width="119" height="8" rx="4" fill="#2c2338"/><rect x="23" y="226" width="160" height="6" rx="3" fill="#dad4e0"/></g>
 <g transform="translate(249 95) rotate(12 123 144)"><rect width="242" height="295" rx="28" fill="#d70b3f"/><rect y="-10" width="242" height="295" rx="28" fill="#ed174c"/>
 <path d="M70 74c19-11 33-8 51 1 18-9 33-12 51-1v83c-18-11-33-8-51 1-18-9-32-12-51-1z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><path d="M121 75v83" stroke="#fff" stroke-width="5"/>
 <rect x="26" y="205" width="150" height="8" rx="4" fill="#fff"/><rect x="26" y="226" width="190" height="6" rx="3" fill="#ffffff70"/><rect x="26" y="243" width="126" height="6" rx="3" fill="#ffffff70"/></g>
 <g transform="translate(338 18) rotate(9)"><rect width="122" height="71" rx="23" fill="#18151f"/><path d="M34 70l-6 19 29-19" fill="#18151f"/><circle cx="35" cy="34" r="5" fill="#fff"/><circle cx="61" cy="34" r="5" fill="#fff"/><circle cx="87" cy="34" r="5" fill="#fff"/></g>
 <g transform="translate(5 51)"><circle cx="34" cy="34" r="34" fill="#ed174c"/><path d="M24 36l20-16m-13 0h13v13M44 35L24 51m13 0H24V38" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/></g>
 <circle cx="502" cy="218" r="10" fill="#ed174c"/><circle cx="89" cy="402" r="7" fill="#ed174c"/>
</g>`;
const svg=(w,h,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>text{font-family:Arial,Helvetica,sans-serif}</style>${body}</svg>`;
const feed=svg(1080,1350,`<rect width="1080" height="1350" fill="#f7f5f2"/>
 <text x="76" y="128" font-size="54" font-weight="700" letter-spacing="-3" fill="#151419">Classfy</text>
 <rect x="792" y="84" width="212" height="48" rx="24" fill="#eeeae6"/><text x="898" y="115" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="2" fill="#4b454c">DESCUBRA MAIS</text>
 <text x="76" y="262" font-size="83" font-weight="700" letter-spacing="-4" fill="#16141b"><tspan x="76">Seu próximo</tspan><tspan x="76" dy="92">assunto favorito</tspan><tspan x="76" dy="92" fill="#ed174c">está aqui.</tspan></text>
 <text x="80" y="521" font-size="27" fill="#706974">Conteúdos e creators para abrir novas ideias.</text>
 <g transform="translate(240 545) scale(1.1)">${illustration}</g>
 <rect x="64" y="1130" width="952" height="156" rx="26" fill="#fff"/>
 <text x="94" y="1172" font-size="18" font-weight="700" letter-spacing="1.5" fill="#ed174c">UM CONVITE PARA VOCÊ</text>
 <text x="94" y="1213" font-size="27" font-weight="700" fill="#151419">Explore a Classfy pelo meu link.</text>`);
const story=svg(1080,1920,`<rect width="1080" height="1920" fill="#ed174c"/>
 <circle cx="1040" cy="887" r="510" fill="#ff3a65"/><circle cx="120" cy="1200" r="540" fill="#de0d41"/>
 <text x="88" y="242" font-size="57" font-weight="700" letter-spacing="-3" fill="#fff">Classfy</text>
 <text x="88" y="363" font-size="20" font-weight="700" letter-spacing="4" fill="#ffffffbb">COMPARTILHE UMA DESCOBERTA</text>
 <text x="82" y="494" font-size="112" font-weight="700" letter-spacing="-5" fill="#fff"><tspan x="82">Uma boa</tspan><tspan x="82" dy="121">descoberta</tspan><tspan x="82" dy="121">puxa outra.</tspan></text>
 <text x="88" y="834" font-size="30" fill="#ffffffdd">Encontre seu próximo assunto na Classfy.</text>
 <g transform="translate(142 882) scale(1.35)">${illustration}</g>
 <rect x="64" y="1490" width="952" height="212" rx="28" fill="#fff"/>
 <text x="94" y="1545" font-size="18" font-weight="700" letter-spacing="1.5" fill="#ed174c">UM CONVITE PARA VOCÊ</text>
 <text x="94" y="1590" font-size="29" font-weight="700" fill="#151419">Conheça pelo meu link.</text>
 <text x="540" y="1770" text-anchor="middle" font-size="23" fill="#ffffffcc">Assista. Descubra. Leve uma ideia com você.</text>`);
for(const [name,content] of [['invite-feed',feed],['invite-story',story],['sharing-illustration',svg(600,500,illustration)]]) {
 await writeFile(`${root}/${name}.svg`,content);
 if(name!=='sharing-illustration') await sharp(Buffer.from(content)).png().toFile(`${root}/${name}.png`);
}
console.log('Exported feed 1080×1350, story 1080×1920 and modal illustration.');
