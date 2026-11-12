import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {ResourceUpdatedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createNativeToolServer} from '../native-tools.mjs';
const binding={profileId:'profile-fixture',spaceId:'fixture-space',taskId:'task-fixture'};
async function fixture(t,commands){
 const received=[];
 const host={binding,commands,libraries:['retired-library'],execute:async request=>{
  received.push(request);return{id:request.id,ok:true,value:[]};
 }};
 const server=createNativeToolServer(host),client=new Client({name:'native-capabilities-test',version:'1'});
 const [left,right]=InMemoryTransport.createLinkedPair();await server.connect(right);await client.connect(left);
 t.after(async()=>{await client.close();await server.close();});
 return{client,received};
}
const call=async(client,name,args={})=>{
 const r=await client.callTool({name,arguments:args});assert.equal(r.isError,true);return JSON.parse(r.content[0].text);
};
test('old library metadata cannot register clip tools or execute business commands',async t=>{
 const {client,received}=await fixture(t,['page.list','library.read','library.list','library.putIfAbsent']);
 assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['tai_page_list','tai_task_status']);
 for(const name of ['tai_clip_search','tai_clip_read','tai_clip_save'])
  assert.equal((await call(client,name,{libraryId:'retired-library'})).error.code,'CAPABILITY_UNAVAILABLE');
 assert.equal(received.length,0);
});
test('old module metadata cannot reactivate preview, apply or filesystem tools',async t=>{
 const {client,received}=await fixture(t,['modules.preview']);
 assert.deepEqual((await client.listTools()).tools,[]);
 for(const name of ['tai_app_preview','tai_app_apply','library.read'])
  assert.equal((await call(client,name)).error.code,'CAPABILITY_UNAVAILABLE');
 assert.equal(received.length,0);
});
test('mixed legacy grants retain only scoped browser tools',async t=>{
 const {client,received}=await fixture(t,['page.list','page.open','page.read','page.act','modules.preview','library.list','library.read']);
 const tools=(await client.listTools()).tools;
 assert.deepEqual(tools.map(t=>t.name),['tai_page_list','tai_page_open','tai_page_read','tai_page_act','tai_task_status']);
 assert.ok(tools.every(tool=>!Object.hasOwn(tool.inputSchema.properties,'libraryId')));
 const r=JSON.parse((await client.callTool({name:'tai_page_list',arguments:{}})).content[0].text);
 assert.equal(r.ok,true);assert.equal(received.length,1);assert.deepEqual(received[0].scope,binding);
});

test('status is scoped and only subscribed clients receive changes', async t => {
 const {client,received}=await fixture(t,['page.list']);
 const {resources:[resource]}=await client.listResources();
 assert.equal(resource.uri,'tai://task/status');
 assert.equal(received.length,0,'discovery must not poll the browser');
 await assert.rejects(client.readResource({uri:'tai://task/someone-else'}));
 assert.equal(received.length,0);
 const denied=await call(client,'tai_task_status',{spaceId:'another-space'});
 assert.equal(denied.error.code,'INVALID_ARGUMENTS');
 const result=await client.callTool({name:'tai_task_status',arguments:{after:7}});
 assert.equal(result.isError,undefined);
 assert.deepEqual(received[0].scope,binding);
 assert.deepEqual(received[0].payload,{after:7});
});

test('official MCP subscription signals changes and stops on unsubscribe', async t => {
 const binding={profileId:'fixture-profile',spaceId:'fixture-space',taskId:'fixture-task'};
 let cursor=1, reads=0;
 const host={binding,commands:['page.list'],execute:async request=>{
  assert.equal(request.command,'page.status');
  assert.deepEqual(request.scope,binding);
  reads++;
  return {id:request.id,ok:true,value:{cursor,state:cursor===1?'ready':'paused',events:[]}};
 }};
 const server=createNativeToolServer(host),client=new Client({name:'subscription-test',version:'1'});
 const [left,right]=InMemoryTransport.createLinkedPair();
 t.after(async()=>{await client.close();await server.close();});
 await server.connect(right);await client.connect(left);
 const uri='tai://task/status';
 const notification=Promise.withResolvers();
 client.setNotificationHandler(ResourceUpdatedNotificationSchema, ({params})=>notification.resolve(params.uri));
 await client.subscribeResource({uri});
 assert.equal(reads,1);
 cursor++;
 const timeout=setTimeout(()=>notification.reject(new Error('No MCP resource update')),4000);
 t.after(()=>clearTimeout(timeout));
 assert.equal(await notification.promise,uri);
 const {contents:[status]}=await client.readResource({uri});
 assert.deepEqual(JSON.parse(status.text),{ok:true,cursor:2,state:'paused',events:[]});
 await client.unsubscribeResource({uri});
 const previous=reads;
 await new Promise(resolve=>setTimeout(resolve,2100));
 assert.equal(reads,previous);
});
