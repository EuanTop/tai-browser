import test from 'node:test';
import assert from 'node:assert/strict';
import {registerPiTools} from '../pi-extension.mjs';
test('Pi reuses the granted MCP tools and immutable Space binding',async()=>{
 const tools=[],requests=[],binding={profileId:'test-profile',spaceId:'fixed-space',taskId:'test-task'};
 const dispose=await registerPiTools({registerTool:tool=>tools.push(tool)},{binding,commands:['page.list'],libraries:[],async execute(request){if(request.command!=='host.client')requests.push(request);return {id:request.id,ok:true,value:{pages:[]}};}});
 try{assert.deepEqual(tools.map(t=>t.name),['tai_page_list','tai_task_status']);const result=await tools[0].execute('id',{},new AbortController().signal);assert.equal(JSON.parse(result.content[0].text).ok,true);assert.equal(requests[0].scope.spaceId,'fixed-space');assert.equal(requests[0].command,'page.list');await assert.rejects(tools[0].execute('id',{spaceId:'forged'},new AbortController().signal));assert.equal(requests.length,1);}finally{await dispose();}
});
