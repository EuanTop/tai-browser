// Append-only metadata: cloud-folder merges never overwrite a clip or hide a
// concurrent branch. Files remain portable JSON and use the existing native
// immutable store; there is no second database or privileged filesystem API.
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function validate(event){
  if(!event||Object.keys(event).some(k=>!['version','clipId','parents','value'].includes(k))||event.version!==1||!id(event.clipId)||!Array.isArray(event.parents)||event.parents.length>64||event.parents.some(v=>!digest(v))||new Set(event.parents).size!==event.parents.length)throw new Error('INVALID_CLIP_STATE');
  const v=event.value;
  if(!v||Object.keys(v).some(k=>!['state','title','tags'].includes(k))||!['saved','archived','trash'].includes(v.state)||typeof v.title!=='string'||!v.title.trim()||v.title.length>300||!Array.isArray(v.tags)||v.tags.length>32||v.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>80))throw new Error('INVALID_CLIP_STATE');
  return event;
}
export class ClipStateLedger {
  #store;#events=new Map();
  constructor(store){this.#store=store;}
  async rebuild(){
    let files;try{files=await this.#store.list('clip-state');}catch(e){if(e.code!=='RESOURCE_NOT_FOUND')throw e;files=[];}
    if(files.length>10000)throw new Error('CLIP_STATE_QUOTA');
    const groups=new Map(),warnings=[];
    for(const key of files){
      if(!key.endsWith('.json'))continue;
      const text=await this.#store.read(key);
      try{const event=validate(JSON.parse(text)),sha=await hash(text);if(key!==`clip-state/${event.clipId}/${sha}.json`)throw new Error('Digest mismatch');const group=groups.get(event.clipId)||new Map();group.set(sha,event);groups.set(event.clipId,group);}catch{warnings.push({code:'corrupt-state',resourceId:key});}
    }
    this.#events=new Map();
    for(const[clipId,group]of groups){
      // Every parent must be present and reachable from a valid root. Missing
      // sync files stay on disk and become valid on a later rebuild.
      const valid=new Map(),remaining=new Map(),children=new Map(),ready=[];
      for(const[key,event]of group){remaining.set(key,event.parents.length);if(!event.parents.length)ready.push(key);for(const parent of event.parents){const list=children.get(parent)||[];list.push(key);children.set(parent,list);}}
      for(let i=0;i<ready.length;i++){const key=ready[i];valid.set(key,group.get(key));for(const child of children.get(key)||[]){remaining.set(child,remaining.get(child)-1);if(remaining.get(child)===0)ready.push(child);}}
      if(valid.size!==group.size)warnings.push({code:'incomplete-state',clipId});
      this.#events.set(clipId,valid);
    }
    return {warnings};
  }
  state(clip){
    const events=this.#events.get(clip.id)||new Map(),parents=new Set([...events.values()].flatMap(e=>e.parents));
    const heads=[...events.keys()].filter(k=>!parents.has(k)).sort();
    const conflicted=heads.length>1;
    // Preserve discoverability until the user resolves concurrent updates.
    const value=heads.length===1?events.get(heads[0]).value:{state:'saved',title:clip.title,tags:clip.tags};
    return {...structuredClone(value),heads,conflicted};
  }
  async update(clip,value,{expectedHeads=[]}={}){
    if(!id(clip.id))throw new Error('INVALID_CLIP_STATE');
    await this.rebuild();const current=this.state(clip);
    if(!same(current.heads,expectedHeads))throw new Error('CLIP_STATE_CONFLICT');
    const event=validate({version:1,clipId:clip.id,parents:current.heads,value:structuredClone(value)});
    const text=JSON.stringify(event),sha=await hash(text);
    await this.#store.putIfAbsent(`clip-state/${clip.id}/${sha}.json`,text);
    await this.rebuild();return this.state(clip);
  }
}
