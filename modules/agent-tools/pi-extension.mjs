// Pi owns its Agent loop, credentials and conversation. Reuse TAi's existing
// MCP descriptors/validation over an in-memory transport, without a new planner.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {connectNativeHost} from '../../src/host/client/native-client.mjs';
import {createNativeToolServer} from './native-tools.mjs';
import {trackNativeClient} from './native-presence.mjs';
export async function registerPiTools(pi, host) {
  const server=createNativeToolServer(host);
  const presence=trackNativeClient(server,host);
  const client=new Client({name:'tai-pi-extension',version:'0.1.0'},{capabilities:{}});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport),client.connect(clientTransport)]);
    const {tools}=await client.listTools();
    for(const tool of tools)pi.registerTool({name:tool.name,label:tool.name.replace('tai_','TAi · '),
      description:tool.description,parameters:tool.inputSchema,
      async execute(_id,params,signal){
        const result=await client.callTool({name:tool.name,arguments:params},undefined,{signal});
        if(result.isError)throw new Error(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));
        return {content:result.content,details:{source:'tai-browser',spaceId:host.binding.spaceId}};
      }});
    return async()=>{await presence.dispose();await client.close();await server.close();};
  }catch{await client.close().catch(()=>{});await server.close().catch(()=>{});throw new Error('TAI_PI_CONNECT_FAILED');}
}
export default async function(pi) {
  const file=process.env.TAI_CONNECTION_FILE;
  if(!file)throw new Error('TAI_PI_CONNECTION_REQUIRED');
  const dispose=await registerPiTools(pi,await connectNativeHost(file));
  pi.on('session_shutdown',dispose);
}
