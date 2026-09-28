import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

// Use the same reviewed content in the React pages and public HTML documents.
const source = await readFile(new URL('../src/content/legal.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'legal.ts', { loader: 'ts', format: 'esm' });
const { contact, privacy, terms } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const links = '<nav aria-label="Informações legais"><a href="/privacidade">Política de Privacidade</a><a href="/termos">Termos de Uso</a></nav>';
const output = new URL('../dist/legal/', import.meta.url);
await mkdir(output, { recursive: true });
for (const [path, title, sections] of [
  ['privacidade', 'Política de Privacidade', privacy],
  ['termos', 'Termos de Uso', terms],
]) {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Classfy</title><meta name="description" content="${title} da Classfy: informações sobre a plataforma, seus dados e direitos.">
<link rel="canonical" href="https://classfy.com.br/${path}"><link rel="icon" href="/favicon.ico">
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased}header{max-width:896px;margin:auto;padding:26px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eee}a{color:inherit}.brand{font-size:26px;font-weight:750;letter-spacing:-1px;text-decoration:none}.back{font-size:14px;color:#666;text-decoration:none}main{max-width:768px;margin:auto;padding:64px 24px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase}h1{font-size:38px;letter-spacing:-1.3px;line-height:1.15;margin:20px 0 16px}.updated{font-size:14px;color:#737373;margin-bottom:48px}section{margin-top:36px}h2{font-size:21px;letter-spacing:-.4px;margin-bottom:12px}p{color:#666;font-size:16px;line-height:1.8;margin:12px 0}.contact{margin-top:40px;padding:24px;border:1px solid #e5e5e5;border-radius:12px;background:#fafafa}.contact h2{margin-top:0}.contact a{overflow-wrap:anywhere}footer{padding:32px 24px;border-top:1px solid #eee}nav{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 24px;font-size:13px;color:#737373}nav a{text-decoration:none}nav a:hover,.back:hover{text-decoration:underline}@media(max-width:600px){main{padding-top:40px}h1{font-size:30px}header{gap:16px}.back{font-size:12px}}
</style></head><body>
<header><a class="brand" href="/">Classfy</a><a class="back" href="/">← Voltar à Classfy</a></header>
<main><div class="eyebrow">Transparência e confiança</div><h1>${title}</h1><p class="updated">Última atualização: 28 de setembro de 2026</p>
${sections.map((section, index) => `<section aria-labelledby="legal-${index}"><h2 id="legal-${index}">${index + 1}. ${escape(section.title)}</h2>${section.paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</section>`).join('')}
<div class="contact"><h2>Fale com a Classfy</h2><a href="mailto:${escape(contact)}">${escape(contact)}</a></div></main><footer>${links}</footer>
</body></html>`;
  await writeFile(new URL(`${path}.html`, output), html);
  console.log(`Página pública gerada: /${path}`);
}
