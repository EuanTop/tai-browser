// Owned synthetic browser only: the browser UI palette must not change the
// webpage's preferred color scheme.
import {createServer} from 'node:http';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startNativeBrowser,until} from './native_smoke_support.mjs';
const binary=process.argv[2];
if(!binary)throw new Error('Pass the compiled Chromium executable');
const output=resolve('research/local/immersive-chrome');await mkdir(output,{recursive:true});
const server=createServer((req,res)=>{
 const dark=req.url==='/dark';
 res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
 res.end(`<!doctype html><meta name="theme-color" content="${dark?'#111827':'#faf8f3'}"><title>${dark?'Dark':'Light'} canvas</title><style>body{background:${dark?'#111827':'#faf8f3'};color:${dark?'white':'black'};margin:0;font:18px system-ui}main{padding:60px;max-width:900px}h1{font-size:52px}</style><main><h1>Room to think.</h1><p>The page and toolbar share one calm canvas.</p><input aria-label="Page input" placeholder="Keep browsing"></main>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(output,'profile-'));let browser;
const checks=[];function expect(name,passed){checks.push({name,passed:!!passed});if(!passed)throw new Error(name);}
const media=()=>browser.evaluate(`({dark:matchMedia('(prefers-color-scheme: dark)').matches,light:matchMedia('(prefers-color-scheme: light)').matches})`);
try{
 browser=await startNativeBrowser(binary,profile);
 const baseline=JSON.stringify(await media());
 for(const route of ['/dark','/light']){
  await browser.call('Page.navigate',{url:origin+route});
  await until(()=>browser.evaluate(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'`));
  await browser.evaluate('new Promise(r=>setTimeout(r,350))');
  expect(route+' preserves renderer preferred color scheme',JSON.stringify(await media())===baseline);
 }
 await browser.evaluate(`document.querySelector('meta').content='#173b36';document.body.style.background='#173b36'`);
 await browser.evaluate('new Promise(r=>setTimeout(r,350))');
 expect('dynamic page colors preserve renderer scheme',JSON.stringify(await media())===baseline);
 await browser.evaluate(`document.querySelector('input').focus();document.querySelector('input').value='Page still accepts input'`);
 expect('page focus and editing remain available',await browser.evaluate(`document.activeElement===document.querySelector('input')&&document.activeElement.value==='Page still accepts input'`));
 await writeFile(join(output,'renderer-checks.json'),JSON.stringify({passed:true,checks},null,2));
 console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await browser?.stop();await new Promise(r=>server.close(r));}
