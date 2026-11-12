// Exercise the installed launcher with synthetic data, never a user's profile.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {startNativeBrowser,until,findWelcomeDialog} from './native_smoke_support.mjs';
import {connectNativeHost} from '../src/host/client/native-client.mjs';
const binary=process.argv[2];if(!binary)throw new Error('Pass the installed native launcher path');
const profile=await mkdtemp(resolve('research/local/browser-profiles/native-install-'));
const checks=[],expect=(check,value)=>{assert(value,check);checks.push({check,passed:true});console.log('PASS '+check);};
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<title>TAi 安装检查</title><h1>本地安装后的真实网页</h1>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
  browser=await startNativeBrowser(binary,profile,{product:false,navigate:false,initialURL:'chrome://tai/home.html'});
  const state=await until(async()=>{const value=await browser.state();return value.ready&&value;});
  expect('launcher enables TAi without a caller sidebar flag',!!state.profileId);
  const welcome=await findWelcomeDialog(browser);
  expect('fresh installed Profile opens welcome separately from the home tab',
    await browser.evaluate("location.pathname==='/home.html'"));
  expect('welcome starts with two choices and no import instructions',
    await browser.evaluate("!document.querySelector('#welcome-intro').hidden&&document.querySelector('#welcome-import').hidden",welcome.sessionId));
  const skip=await browser.call('Runtime.evaluate',{
    expression:"document.querySelector('#continue').click()",
    userGesture:true,returnByValue:true,
  },welcome.sessionId);
  assert(!skip.exceptionDetails,'Start browsing activates the welcome action');
  await until(async()=>!(await browser.call('Target.getTargets')).targetInfos.some(target=>target.targetId===welcome.targetId));
  expect('new-tab page uses TAi home',await browser.evaluate("location.href==='chrome://tai/home.html'"));
  expect('approved architecture loads from installed app',await until(()=>browser.evaluate(`(async()=>{
    const hero=document.querySelector('.atrium-hero');
    if(!hero||!getComputedStyle(hero).backgroundImage.includes('brand-standard-hero.png'))return false;
    const image=new Image();image.src='brand-standard-hero.png';await image.decode();return image.naturalWidth>0&&image.naturalHeight>0;
  })()`)));
  await browser.call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  expect('installed app opens real web content',await until(()=>browser.evaluate("document.title==='TAi 安装检查'&&document.body.textContent.includes('本地安装后的真实网页')")));
  await browser.call('Page.navigate',{url:'chrome://tai/library.html'});
  expect('installed app keeps retired tools inactive',await until(()=>browser.evaluate("document.body.textContent.includes('此内置功能已停止提供')&&!document.querySelector('script,iframe,input')")));
  await browser.call('Page.navigate',{url:'chrome://extensions/'});
  await browser.call('Accessibility.enable');
  expect('installed app retains Chromium extension management',await until(async()=>{
    const {nodes}=await browser.call('Accessibility.getFullAXTree');
    return nodes.some(node=>node.role?.value==='heading'&&node.name?.value==='Extensions')&&nodes.some(node=>node.name?.value==='Developer mode');
  }));
  await browser.call('Page.navigate',{url:'chrome://settings/help'});
  expect('installed About page stays stable and exposes manual updates through accessibility',await until(async()=>{
    const {nodes}=await browser.call('Accessibility.getFullAXTree');
    return nodes.some(n=>n.role?.value==='heading'&&n.name?.value==='TAi Browser')&&
        nodes.some(n=>n.role?.value==='StaticText'&&n.name?.value?.trim()==='Manual updates');
  }));
  await browser.call('Page.navigate',{url:'chrome://tai/help.html'});
  expect('TAi Browser Help links to the project and the maintainer email',await until(()=>browser.evaluate(
    "document.readyState==='complete'&&document.querySelector('#project')?.href==='https://github.com/EuanTop/tai-browser'&&document.querySelector('#contact')?.href==='mailto:euan@mail.bnu.edu.cn'")));
  expect('Help sends a draft to the GitHub issue composer',await browser.evaluate(`(()=>{
    let opened;
    window.open=url=>{opened=new URL(url);};
    document.querySelector('#subject').value='Synthetic issue & example';
    document.querySelector('#details').value='First line\\n测试';
    document.querySelector('#report').requestSubmit();
    return opened?.origin==='https://github.com'&&
        opened.pathname==='/EuanTop/tai-browser/issues/new'&&
        opened.searchParams.get('title')==='Synthetic issue & example'&&
        opened.searchParams.get('body')==='First line\\n测试';
  })()`));
  // Persist a TAi page before testing relaunch: Chromium can ignore internal
  // startup URLs when restoring a previous session; its WebUI handlers are
  // intentionally absent from the standard extensions management page.
  await browser.call('Page.navigate',{url:'chrome://tai/home.html'});
  await until(()=>browser.evaluate("location.href==='chrome://tai/home.html'&&document.readyState==='complete'"));
  await browser.stop();browser=null;
  browser=await startNativeBrowser(binary,profile,{product:false,navigate:false,initialURL:'chrome://tai/home.html'});
  expect('relaunch retains the same independent Profile',(await until(async()=>{const value=await browser.state();return value.ready&&value;})).profileId===state.profileId);
  expect('skipping welcome stays dismissed across relaunch',
    await browser.evaluate("location.pathname==='/home.html'"));
  await browser.stop();browser=null;
  const agentProfile=await mkdtemp(resolve('research/local/browser-profiles/native-agent-settings-'));
  await mkdir(join(agentProfile,'Default'));
  await writeFile(join(agentProfile,'Default/SidebarWorkspace.json'),JSON.stringify({
    version:1,language:'en',welcome_pending:false,active:'coding',
    spaces:[{id:'coding',name:'Coding'},{id:'research',name:'Research'}],items:[],
  }));
  browser=await startNativeBrowser(binary,agentProfile);
  await browser.evaluate("location.hash='appearance'");
  expect('appearance offers system, light and dark, with system selected by default',await until(()=>
    browser.evaluate(`document.querySelector('#color-mode')?.checkVisibility()&&
      !document.querySelector('#color-mode').disabled&&
      [...document.querySelectorAll('#color-mode input')].map(radio=>radio.value).join(',')==='system,light,dark'&&
      document.querySelector('#color-mode :checked').value==='system'&&
      [...document.querySelectorAll('#language option')].some(option=>option.value==='system')`)));
  for(const mode of ['dark','light','system']){
    await browser.evaluate(`document.querySelector('#color-mode [value=${mode}]').click();document.querySelector('#save-edition').click()`);
    expect('appearance saves '+mode+' independently of the edition',await until(async()=>{
      const next=await browser.state();
      return next.colorMode===mode&&next.edition==='standard'&&
        (mode==='system'||await browser.evaluate("document.documentElement.dataset.colorMode")===mode);
    }));
    await until(()=>browser.evaluate("document.querySelector('#save-edition').disabled"));
  }
  await browser.evaluate("location.hash='agent'");
  async function authorize(space,provider){
    await until(()=>browser.evaluate("document.querySelector('.agent-create')?.checkVisibility()&&!document.querySelector('.agent-create').disabled"));
    const result=await browser.call('Runtime.evaluate',{
      expression:`(()=>{
        const field=document.querySelector('#host-space');
        field.value=${JSON.stringify(space)};
        field.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('[data-provider='+${JSON.stringify(provider)}+']').click();
        document.querySelector('.agent-create').click();
      })()`,
      userGesture:true,returnByValue:true,
    });
    assert(!result.exceptionDetails);
    return until(async()=>{
      const host=await browser.evaluate("import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiGetHostState'))");
      return host.tasks.find(task=>task.spaceId===space&&task.provider===provider);
    });
  }
  const coding=await authorize('coding','codex');
  const research=await authorize('research','claude');
  expect('ChatGPT connection picker displays the current app icon and name',await until(()=>browser.evaluate(`(()=>{
    const option=document.querySelector('[data-provider="codex"]');
    return option?.textContent.trim()==='ChatGPT'&&option.querySelector('img')?.naturalWidth===16;
  })()`)));
  expect('Agent settings lists both fixed Space authorizations at once',await until(()=>browser.evaluate(`
    [...document.querySelectorAll('.agent-task-binding')].some(row=>row.textContent.includes('ChatGPT')&&row.textContent.includes('Coding'))&&
    [...document.querySelectorAll('.agent-task-binding')].some(row=>row.textContent.includes('Claude Code')&&row.textContent.includes('Research'))&&
    !document.querySelector('.agent-limit,.sidebar-signature')`)));
  expect('the setup command follows the chosen authorization row',await browser.evaluate(`(()=>{
    const setup=id=>document.querySelector('[data-task-id="'+id+'"] [data-agent-action=setup]');
    const code=()=>document.querySelector('.agent-command').textContent;
    const claude=code().startsWith('claude mcp add');
    setup(${JSON.stringify(coding.id)}).click();
    const codex=code().startsWith('codex mcp add');
    setup(${JSON.stringify(research.id)}).click();
    return claude&&codex&&code().startsWith('claude mcp add');
  })()`));
  const clients=await Promise.all([coding,research].map(task=>
    connectNativeHost(join(agentProfile,'Default','TAiHostConnections',task.id+'.json'))));
  const listed=await Promise.all(clients.map((client,index)=>client.execute({
    protocol:'tai.v1',id:'agent-settings-'+index,command:'page.list',scope:client.binding,payload:{},
  })));
  expect('both grants can independently list their own Space',listed.every(result=>result.ok)&&
    clients[0].binding.spaceId==='coding'&&clients[1].binding.spaceId==='research'&&
    clients.every(client=>client.commands.length===2));
  await writeFile('research/local/install-app-smoke.json',JSON.stringify({passed:true,checks,profile},null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks}));
} finally {if(browser)await browser.stop();server.close();}
