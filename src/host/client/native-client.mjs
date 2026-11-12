// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
// TAi-owned native transport; Agent loops and MCP framing stay in their modules.
import {open, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createConnection} from 'node:net';
import {dirname} from 'node:path';
const MAX_CONFIG=16384, MAX_REQUEST=8*1024*1024, MAX_RESPONSE=16*1024*1024;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const identifier=value=>typeof value==='string'&&!!value.trim()&&value.length<=100;
const ALLOWED_COMMANDS=new Set(['page.list','page.open','page.read','page.act','page.screenshot','library.read','library.list','library.putIfAbsent','modules.preview']);
function granted(config,key,maximum,valid){
  if(!own(config,key))return Object.freeze([]);
  const values=config[key];
  if(!Array.isArray(values)||values.length>maximum||values.some(value=>!valid(value))||
      new Set(values).size!==values.length)throw new HostError('INVALID_CONNECTION_FILE');
  return Object.freeze([...values]);
}
export class HostError extends Error { constructor(code){super(code);this.name='HostError';this.code=code;} }
function ownFile(stat){return stat.isFile()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&stat.nlink===1&&stat.size<=MAX_CONFIG;}
async function readConfig(configFile){
  let file;
  try{
    if(typeof configFile!=='string'||!configFile)throw new Error();
    // O_NONBLOCK prevents a substituted FIFO from blocking before fstat.
    file=await open(configFile,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    if(!ownFile(await file.stat()))throw new Error();
    const buffer=Buffer.alloc(MAX_CONFIG+1);let size=0;
    while(size<buffer.length){
      const {bytesRead}=await file.read(buffer,size,buffer.length-size,null);
      if(!bytesRead)break;
      size+=bytesRead;
      if(size>MAX_CONFIG)throw new Error();
    }
    // The first stat is not a read limit: a selected file may grow meanwhile.
    if(!ownFile(await file.stat()))throw new Error();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
  }catch{throw new HostError('INVALID_CONNECTION_FILE');}
  finally{await file?.close().catch(()=>{});}
}
function responseValid(value,id){
  if(!record(value)||value.id!==id||typeof value.ok!=='boolean')return false;
  if(value.ok)return own(value,'value')&&!own(value,'error');
  return !own(value,'value')&&record(value.error)&&typeof value.error.code==='string'&&
    !!value.error.code&&typeof value.error.message==='string'&&
    (!own(value.error,'retryable')||typeof value.error.retryable==='boolean');
}
const validEndpoint=path=>typeof path==='string'&&/^\/tmp\/tai-host-[A-Za-z0-9._-]{1,64}\/s$/u.test(path);
async function checkEndpoint(endpoint){
  const folder=await lstat(dirname(endpoint)),socketStat=await lstat(endpoint);
  if(!folder.isDirectory()||folder.uid!==process.getuid()||(folder.mode&0o077)!==0||
      !socketStat.isSocket()||socketStat.uid!==process.getuid())throw new HostError('INVALID_ENDPOINT');
}
export async function connectNativeHost(configFile){
  // Config is selected at process launch, never an Agent tool/path argument.
  const config=await readConfig(configFile);
  if(!record(config)||config.protocol!=='tai.local.v1'||typeof config.token!=='string'||
      !/^[a-f0-9]{64}$/i.test(config.token)||!validEndpoint(config.endpoint))
    throw new HostError('INVALID_CONNECTION_FILE');
  if(!record(config.binding)||Object.keys(config.binding).sort().join(',')!=='profileId,spaceId,taskId'||
      Object.values(config.binding).some(v=>!identifier(v)))throw new HostError('INVALID_BINDING');
  const remembered=typeof config.windowKey==='string'&&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(config.windowKey);
  if(!remembered){
    try{await checkEndpoint(config.endpoint);}catch{throw new HostError('INVALID_ENDPOINT');}
  }
  const binding=Object.freeze({...config.binding});
  const commands=granted(config,'commands',8,value=>typeof value==='string'&&ALLOWED_COMMANDS.has(value));
  const libraries=granted(config,'libraries',8,identifier);
  async function execute(request,{signal}={}){
    // Serialize first, then validate the exact JSON snapshot that goes on wire.
    // A caller's toJSON/getters or later mutations cannot substitute a scope.
    let snapshot;
    try{snapshot=JSON.parse(JSON.stringify(request));}catch{throw new HostError('INVALID_REQUEST');}
    if(!record(snapshot)||snapshot.protocol!=='tai.v1'||!identifier(snapshot.id)||
        !identifier(snapshot.command)||!record(snapshot.scope)||!record(snapshot.payload)||
        Object.keys(snapshot).some(k=>!['protocol','id','command','scope','payload'].includes(k)))
      throw new HostError('INVALID_REQUEST');
    for(const key of Object.keys(binding))if(snapshot.scope[key]!==binding[key])throw new HostError('SCOPE_MISMATCH');
    if(Object.keys(snapshot.scope).some(k=>!['profileId','spaceId','taskId','pageId','pageRevision'].includes(k)))throw new HostError('SCOPE_MISMATCH');
    if((own(snapshot.scope,'pageId')&&!identifier(snapshot.scope.pageId))||
        (own(snapshot.scope,'pageRevision')&&(!Number.isSafeInteger(snapshot.scope.pageRevision)||snapshot.scope.pageRevision<0)))
      throw new HostError('INVALID_REQUEST');
    const encoded=JSON.stringify({token:config.token,request:snapshot})+'\n';
    if(Buffer.byteLength(encoded)>MAX_REQUEST)throw new HostError('QUOTA_EXCEEDED');
    if(signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'||
        typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))
      throw new HostError('INVALID_REQUEST');
    if(signal?.aborted)throw new HostError('CANCELED');
    let endpoint=config.endpoint;
    if(remembered){
      let current;
      try{current=await readConfig(configFile);}catch{throw new HostError('HOST_UNAVAILABLE');}
      if(!record(current)||current.protocol!==config.protocol||
          current.token!==config.token||current.windowKey!==config.windowKey||
          !record(current.binding)||!Object.keys(binding).every(key=>current.binding[key]===binding[key])||
          !validEndpoint(current.endpoint))throw new HostError('HOST_UNAVAILABLE');
      try{await checkEndpoint(current.endpoint);}catch{throw new HostError('HOST_UNAVAILABLE');}
      endpoint=current.endpoint;
    }
    if(signal?.aborted)throw new HostError('CANCELED');
    // Exactly one connection, one request, one response. No retry after any
    // transport failure: cancellation after write cannot undo native work.
    return new Promise((resolve,reject)=>{
      const chunks=[];let size=0,settled=false,sent=false;
      const socket=createConnection({path:endpoint});
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(value);};
      const abort=()=>finish(new HostError(sent?'OUTCOME_UNKNOWN':'CANCELED'));
      const disconnected=()=>finish(new HostError(sent?'OUTCOME_UNKNOWN':'HOST_UNAVAILABLE'));
      const timer=setTimeout(disconnected,30000);
      signal?.addEventListener('abort',abort,{once:true});
      socket.once('connect',()=>{if(settled)return;if(signal?.aborted){abort();return;}sent=true;socket.write(encoded);});
      socket.on('error',disconnected);
      socket.on('data',chunk=>{
        if(settled)return;
        size+=chunk.length;
        const newline=chunk.indexOf(10);
        if(size>MAX_RESPONSE+1||(newline<0&&size>MAX_RESPONSE)||
            (newline>=0&&newline!==chunk.length-1)){finish(new HostError('INVALID_RESPONSE'));return;}
        chunks.push(chunk);
        if(newline<0)return;
        try{
          // Decode once at the frame boundary: multibyte UTF-8 characters may
          // cross any socket chunk boundary, including between their bytes.
          const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size).subarray(0,size-1));
          const value=JSON.parse(text);
          if(!responseValid(value,snapshot.id))throw new Error();
          finish(null,value);
        }catch{finish(new HostError('INVALID_RESPONSE'));}
      });
      socket.once('end',disconnected);
      socket.once('close',disconnected);
    });
  }
  return Object.freeze({binding,commands,libraries,execute});
}
