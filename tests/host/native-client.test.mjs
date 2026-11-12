// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,chmod,rm,symlink,link,open,appendFile,unlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {connectNativeHost,HostError} from '../../src/host/client/native-client.mjs';
const binding={profileId:'synthetic-profile',spaceId:'synthetic-space',taskId:'synthetic-task'};
const request=(id='r-1')=>({protocol:'tai.v1',id,command:'page.read',scope:{...binding},payload:{}});
const success=(id,value={title:'合成网页 🌈'})=>({id,ok:true,value});
const errorCode=code=>error=>error instanceof HostError&&error.code===code&&error.message===code;
async function fixture(t,respond=({request},socket)=>socket.end(JSON.stringify(success(request.id))+'\n')){
  const folder=await mkdtemp('/tmp/tai-host-client-test-');
  await chmod(folder,0o700);
  const endpoint=join(folder,'s'),configFile=join(folder,'connection.json');
  const config={protocol:'tai.local.v1',endpoint,token:'a'.repeat(64),binding:{...binding}};
  const connections=new Set(),received=[];let count=0;
  const server=createServer(socket=>{
    count++;connections.add(socket);socket.on('close',()=>connections.delete(socket));
    socket.on('error',()=>{});let text='';
    socket.on('data',data=>{
      text+=data.toString();
      const end=text.indexOf('\n');if(end<0)return;
      socket.removeAllListeners('data');
      const envelope=JSON.parse(text.slice(0,end));received.push(envelope);
      Promise.resolve(respond(envelope,socket)).catch(()=>socket.destroy());
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
  await writeFile(configFile,JSON.stringify(config),{mode:0o600});
  t.after(async()=>{
    for(const socket of connections)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
    await rm(folder,{recursive:true,force:true});
  });
  return {folder,endpoint,configFile,config,received,get count(){return count;},
    save:async value=>writeFile(configFile,JSON.stringify(value)),
    client:()=>connectNativeHost(configFile)};
}

test('valid scoped request and UTF-8 split within multibyte characters',async t=>{
  const f=await fixture(t,async({request:incoming},socket)=>{
    const bytes=Buffer.from(JSON.stringify(success(incoming.id))+'\n');
    const at=bytes.indexOf(Buffer.from('合'))+1;
    socket.write(bytes.subarray(0,at));await delay(5);
    socket.write(bytes.subarray(at,at+1));await delay(5);
    socket.end(bytes.subarray(at+1));
  });
  const client=await f.client();
  assert.deepEqual(await client.execute(request()),success('r-1'));
  assert.equal(f.count,1);assert.deepEqual(f.received[0].request,request());
  assert.equal(f.received[0].token,f.config.token);
  assert.ok(Object.isFrozen(client)&&Object.isFrozen(client.binding));
});

test('binding overrides, extra scope, and toJSON substitution are rejected before connecting',async t=>{
  const f=await fixture(t),client=await f.client();
  for(const field of ['profileId','spaceId','taskId']){
    const input=request();input.scope[field]='another';
    await assert.rejects(client.execute(input),errorCode('SCOPE_MISMATCH'));
  }
  const extra=request();extra.scope.filePath='/synthetic/ungranted';
  await assert.rejects(client.execute(extra),errorCode('SCOPE_MISMATCH'));
  const disguised=request();disguised.toJSON=()=>({...request(),scope:{...binding,taskId:'override'}});
  await assert.rejects(client.execute(disguised),errorCode('SCOPE_MISMATCH'));
  assert.throws(()=>{client.binding.spaceId='override';},TypeError);
  assert.equal(f.count,0);
});

test('exact request snapshot cannot change while connection is pending',async t=>{
  const f=await fixture(t),client=await f.client(),input=request();
  const operation=client.execute(input);input.scope.taskId='changed';input.id='changed';
  assert.equal((await operation).id,'r-1');
  assert.equal(f.received[0].request.scope.taskId,binding.taskId);
});

test('invalid requests and request byte quota never open a connection',async t=>{
  const f=await fixture(t),client=await f.client();
  const invalid=[null,[],{...request(),scope:[]},{...request(),payload:[]},
    {...request(),scope:{...binding,pageRevision:-1}},
    {...request(),scope:{...binding,pageId:''}},
    {...request(),extra:true}];
  const cycle=request();cycle.payload.cycle=cycle;invalid.push(cycle);
  for(const input of invalid)await assert.rejects(client.execute(input),errorCode('INVALID_REQUEST'));
  const large=request();large.payload.text='x'.repeat(8*1024*1024);
  await assert.rejects(client.execute(large),errorCode('QUOTA_EXCEEDED'));
  assert.equal(f.count,0);
});

test('native failure is returned as the typed correlated result, without retry',async t=>{
  const expected={id:'r-1',ok:false,error:{code:'LEASE_REVOKED',message:'LEASE_REVOKED',retryable:false}};
  const f=await fixture(t,(_,socket)=>socket.end(JSON.stringify(expected)+'\n'));
  assert.deepEqual(await(await f.client()).execute(request()),expected);
  await delay(20);assert.equal(f.count,1);
});

for(const [name,bytes] of [
  ['malformed JSON',Buffer.from('{bad}\n')],
  ['wrong correlation',Buffer.from(JSON.stringify(success('wrong'))+'\n')],
  ['missing success value',Buffer.from('{"id":"r-1","ok":true}\n')],
  ['malformed native error',Buffer.from('{"id":"r-1","ok":false,"error":{"code":3}}\n')],
  ['invalid UTF-8',Buffer.concat([Buffer.from('{"id":"r-1","ok":true,"value":"'),Buffer.from([0xff]),Buffer.from('"}\n')])],
  ['extra frame',Buffer.from(JSON.stringify(success('r-1'))+'\n{}\n')],
  ['oversize response',Buffer.alloc(16*1024*1024+2,0x78)],
])test('invalid response: '+name,async t=>{
  const f=await fixture(t,(_,socket)=>socket.end(bytes));
  await assert.rejects((await f.client()).execute(request()),errorCode('INVALID_RESPONSE'));
  await delay(10);assert.equal(f.count,1);
});

test('disconnect after dispatch reports unknown outcome and does not retry',async t=>{
  const f=await fixture(t,(_,socket)=>socket.destroy());
  await assert.rejects((await f.client()).execute(request()),errorCode('OUTCOME_UNKNOWN'));
  await delay(20);assert.equal(f.count,1);assert.equal(f.received.length,1);
});

test('incomplete response followed by disconnect remains an unknown outcome',async t=>{
  const f=await fixture(t,(_,socket)=>socket.end('{"id":"r-1"'));
  await assert.rejects((await f.client()).execute(request()),errorCode('OUTCOME_UNKNOWN'));
  assert.equal(f.count,1);
});

test('cancellation before dispatch makes no connection; cancellation after dispatch is uncertain',async t=>{
  const controller=new AbortController();let acknowledge;
  const dispatched=new Promise(resolve=>{acknowledge=resolve;});
  const f=await fixture(t,()=>acknowledge()),client=await f.client();
  const canceled=new AbortController();canceled.abort();
  await assert.rejects(client.execute(request(),{signal:canceled.signal}),errorCode('CANCELED'));
  assert.equal(f.count,0);
  const operation=client.execute(request(),{signal:controller.signal});
  await dispatched;controller.abort();
  await assert.rejects(operation,errorCode('OUTCOME_UNKNOWN'));
  await delay(20);assert.equal(f.count,1);assert.equal(f.received.length,1);
});

test('unavailable endpoint before connection does not imply dispatch or retry',async t=>{
  const f=await fixture(t),client=await f.client();
  await unlink(f.endpoint);
  await assert.rejects(client.execute(request()),errorCode('HOST_UNAVAILABLE'));
  assert.equal(f.count,0);
});

test('connection files reject open errors, permissions, symbolic links, hardlinks and byte overflow',async t=>{
  const f=await fixture(t);
  await assert.rejects(connectNativeHost(join(f.folder,'missing')),errorCode('INVALID_CONNECTION_FILE'));
  await chmod(f.configFile,0o644);
  await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));
  await chmod(f.configFile,0o600);
  const symbolic=join(f.folder,'symbolic');await symlink(f.configFile,symbolic);
  await assert.rejects(connectNativeHost(symbolic),errorCode('INVALID_CONNECTION_FILE'));
  const hard=join(f.folder,'hard');await link(f.configFile,hard);
  await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));await unlink(hard);
  await writeFile(f.configFile,' '.repeat(16385));
  await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));
  await writeFile(f.configFile,Buffer.from([0xff]));
  await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));
});

test('bounded descriptor read rejects growth after the initial file stat',async t=>{
  const f=await fixture(t);
  const probe=await open(f.configFile);const prototype=Object.getPrototypeOf(probe);await probe.close();
  const original=prototype.read;let injected=false;
  t.mock.method(prototype,'read',async function(...args){
    if(!injected){injected=true;await appendFile(f.configFile,' '.repeat(16385));}
    assert.ok(args[2]<=16385,'each read is capped independent of fstat');
    return original.apply(this,args);
  });
  await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));
  assert.equal(injected,true);
});

test('config schema and binding shape are validated without leaking raw details',async t=>{
  const f=await fixture(t);
  for(const value of [null,[],{}, {...f.config,token:1},{...f.config,endpoint:'/tmp/elsewhere/s'}]){
    await f.save(value);await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));
  }
  for(const invalid of [null,[],{...binding,extra:'x'},{...binding,taskId:''},{...binding,taskId:'x'.repeat(101)}]){
    await f.save({...f.config,binding:invalid});await assert.rejects(f.client(),errorCode('INVALID_BINDING'));
  }
});

test('endpoint folder must be private and neither folder nor socket may be symbolic',async t=>{
  const f=await fixture(t);
  await chmod(f.folder,0o755);await assert.rejects(f.client(),errorCode('INVALID_ENDPOINT'));
  await chmod(f.folder,0o700);
  const alias=await mkdtemp('/tmp/tai-host-client-test-link-');
  await rm(alias,{recursive:true});await symlink(f.folder,alias,'dir');
  t.after(()=>rm(alias,{force:true}));
  await f.save({...f.config,endpoint:join(alias,'s')});
  await assert.rejects(f.client(),errorCode('INVALID_ENDPOINT'));await f.save(f.config);
  const target=join(f.folder,'actual-socket');await rename(f.endpoint,target);
  await symlink(target,f.endpoint);await assert.rejects(f.client(),errorCode('INVALID_ENDPOINT'));
  await unlink(f.endpoint);
});


test('response deadline after dispatch is uncertain and never retries',async t=>{
  let acknowledge;const dispatched=new Promise(resolve=>{acknowledge=resolve;});
  const f=await fixture(t,()=>acknowledge()),client=await f.client();
  t.mock.timers.enable({apis:['setTimeout']});
  const operation=client.execute(request());
  const rejection=assert.rejects(operation,errorCode('OUTCOME_UNKNOWN'));
  await dispatched;t.mock.timers.tick(30000);await rejection;
  assert.equal(f.count,1);assert.equal(f.received.length,1);
});


test('grant metadata is copied, frozen, and excludes the authentication token',async t=>{
  const f=await fixture(t);
  const commands=['page.list','page.read','library.read','library.list','library.putIfAbsent'];
  const libraries=['synthetic-library','合成资料库'];
  await f.save({...f.config,commands,libraries});
  const client=await f.client();
  assert.deepEqual(client.commands,commands);assert.deepEqual(client.libraries,libraries);
  assert.ok(Object.isFrozen(client.commands)&&Object.isFrozen(client.libraries));
  assert.throws(()=>client.commands.push('page.act'),TypeError);
  assert.throws(()=>{client.libraries[0]='replacement';},TypeError);
  commands[0]='page.open';libraries[0]='changed';
  await f.save({...f.config,commands,libraries});
  assert.equal(client.commands[0],'page.list');assert.equal(client.libraries[0],'synthetic-library');
  assert.deepEqual(Object.keys(client).sort(),['binding','commands','execute','libraries']);
  assert.equal(Object.hasOwn(client,'token'),false);
  assert.equal(JSON.stringify(client).includes(f.config.token),false);
  assert.equal((await client.execute(request())).ok,true);
});

test('missing grant fields yield independently frozen empty lists',async t=>{
  const f=await fixture(t),client=await f.client();
  assert.deepEqual(client.commands,[]);assert.deepEqual(client.libraries,[]);
  assert.ok(Object.isFrozen(client.commands)&&Object.isFrozen(client.libraries));
  await f.save({...f.config,commands:[],libraries:[]});
  const explicit=await f.client();
  assert.deepEqual(explicit.commands,[]);assert.deepEqual(explicit.libraries,[]);
  assert.notEqual(explicit.commands,client.commands);assert.notEqual(explicit.libraries,client.libraries);
});

test('grant metadata rejects unknown, duplicate, mistyped and oversized values',async t=>{
  const f=await fixture(t);
  const commands=['page.list','page.open','page.read','page.act','library.read','library.list','library.putIfAbsent'];
  const libraries=Array.from({length:8},(_,i)=>'library-'+i);
  await f.save({...f.config,commands,libraries});
  const maximum=await f.client();assert.equal(maximum.commands.length,7);assert.equal(maximum.libraries.length,8);
  for(const value of [null,{},'page.read',[1],['page.read','page.read'],['settings.patch'],
      ['library.remove'],[''],[...commands,'page.read']]){
    await f.save({...f.config,commands:value});
    await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));
  }
  for(const value of [null,{},'library',[1],['same','same'],[''],['   '],['x'.repeat(101)],
      [...libraries,'ninth']]){
    await f.save({...f.config,libraries:value});
    await assert.rejects(f.client(),errorCode('INVALID_CONNECTION_FILE'));
  }
  assert.equal(f.count,0);
});
