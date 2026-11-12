// Observe the official SDK initialization lifecycle; this is not a tool grant.
import {randomUUID} from 'node:crypto';
export function trackNativeClient(server,host){
  const sessionId=randomUUID();let started=false,closed=false,timer,queue=Promise.resolve();
  const report=(event,extra={})=>{queue=queue.then(()=>host.execute({protocol:'tai.v1',id:randomUUID(),command:'host.client',scope:host.binding,payload:{event,sessionId,...extra}})).catch(()=>{});return queue;};
  async function dispose(){if(closed)return queue;closed=true;clearInterval(timer);if(started)await report('disconnected');}
  const initialized=server.oninitialized,close=server.onclose;
  server.oninitialized=()=>{
    initialized?.();if(closed||started)return;started=true;
    const client=server.getClientVersion();
    const identity={name:String(client?.name||'MCP client').slice(0,80),version:String(client?.version||'').slice(0,80)};
    const connected=()=>report('connected',identity);
    void connected();
    timer=setInterval(async()=>{
      const reply=await report('heartbeat');
      if(!closed&&reply?.error?.code==='CLIENT_NOT_REGISTERED')void connected();
    },15000);timer.unref?.();
  };
  server.onclose=()=>{close?.();void dispose();};
  return {dispose};
}
