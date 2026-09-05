export interface CacheKeyParts { namespace:string; version:number; entity:string; id:string }
export function cacheKey(parts:CacheKeyParts):string{
  const clean=[parts.namespace,`v${parts.version}`,parts.entity,parts.id].map(x=>x.trim());
  if(clean.some(x=>!x)) throw new Error('cache key parts must be non-empty');
  if(!Number.isInteger(parts.version)||parts.version<=0) throw new Error('version must be positive');
  return clean.join(':');
}

export function jitterTtl(baseSeconds:number,ratio:number,random=0.5):number{
  if(!Number.isFinite(baseSeconds)||baseSeconds<=0) throw new Error('baseSeconds must be positive');
  if(ratio<0||ratio>1) throw new Error('ratio must be in [0,1]');
  if(random<0||random>1) throw new Error('random must be in [0,1]');
  const delta=baseSeconds*ratio*(random*2-1);
  return Math.max(1,Math.round(baseSeconds+delta));
}

export class SingleFlight<T>{
  private readonly inflight=new Map<string,Promise<T>>();
  async run(key:string,load:()=>Promise<T>):Promise<T>{
    const existing=this.inflight.get(key); if(existing) return existing;
    const pending=load().finally(()=>this.inflight.delete(key));
    this.inflight.set(key,pending); return pending;
  }
  size():number{return this.inflight.size;}
}

export type Cached<T>={kind:'hit';value:T}|{kind:'miss'}|{kind:'negative'};
export function decodeCache<T>(raw:string|null,parse:(value:string)=>T):Cached<T>{
  if(raw===null) return {kind:'miss'};
  if(raw==='__NONE__') return {kind:'negative'};
  return {kind:'hit',value:parse(raw)};
}

export function sameHashTag(keys:string[]):boolean{
  const tags=keys.map(k=>/\{([^}]+)\}/.exec(k)?.[1]??null);
  return tags.length>0&&tags[0]!==null&&tags.every(t=>t===tags[0]);
}
