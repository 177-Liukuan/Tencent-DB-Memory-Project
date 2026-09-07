export type AuditOutcome='success'|'denied'|'error';
export interface AuthAuditEvent { event:string; outcome:AuditOutcome; requestId:string; actorHash?:string; reason?:string; at:string }

const SECRET_KEYS=new Set(['authorization','cookie','password','token','api_key','apikey','secret']);
export function sanitizeFields(fields:Record<string,unknown>):Record<string,unknown>{
  const out:Record<string,unknown>={};
  for(const [key,value] of Object.entries(fields)){
    if(SECRET_KEYS.has(key.toLowerCase())){out[key]='[REDACTED]';continue;}
    if(typeof value==='string'&&value.length>256){out[key]=`${value.slice(0,64)}…`;continue;}
    out[key]=value;
  }
  return out;
}

export class AuditBuffer{
  private readonly events:AuthAuditEvent[]=[];
  push(event:Omit<AuthAuditEvent,'at'>,now=new Date()):void{
    if(!event.event.trim()||!event.requestId.trim()) throw new Error('event and requestId are required');
    this.events.push({...event,at:now.toISOString()});
  }
  list():ReadonlyArray<AuthAuditEvent>{return [...this.events];}
  count(outcome?:AuditOutcome):number{return outcome?this.events.filter(x=>x.outcome===outcome).length:this.events.length;}
}

export function normalizeRedirect(value:string,allowedOrigins:Set<string>,fallback='/'):string{
  if(value.startsWith('/')&&!value.startsWith('//')) return value;
  try{const url=new URL(value);return allowedOrigins.has(url.origin)?url.toString():fallback;}catch{return fallback;}
}

export function parseBearer(header:string|undefined):string|null{
  if(!header) return null;
  const match=/^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1]??null;
}
