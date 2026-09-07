export interface DeadLetter { eventId:string; kind:string; payload:unknown; reason:string; attempts:number; failedAt:string }
export interface ReplayDecision { replay:boolean; reason:string }

export function toDeadLetter(input:{eventId:string;kind:string;payload:unknown;error:unknown;attempts:number;now?:Date}):DeadLetter{
  const reason=input.error instanceof Error?input.error.message:String(input.error);
  if(!input.eventId) throw new Error('eventId is required');
  if(input.attempts<=0) throw new Error('attempts must be positive');
  return {eventId:input.eventId,kind:input.kind,payload:structuredClone(input.payload),reason,attempts:input.attempts,failedAt:(input.now??new Date()).toISOString()};
}

export function classifyReplay(letter:DeadLetter,knownKinds:Set<string>,maxAttempts:number):ReplayDecision{
  if(!knownKinds.has(letter.kind)) return {replay:false,reason:'unknown event kind'};
  if(letter.attempts>=maxAttempts) return {replay:false,reason:'attempt limit reached'};
  if(/schema|validation|invalid payload/i.test(letter.reason)) return {replay:false,reason:'permanent payload failure'};
  return {replay:true,reason:'transient failure'};
}

export function selectReplayBatch(letters:DeadLetter[],limit:number):DeadLetter[]{
  if(!Number.isInteger(limit)||limit<=0) throw new Error('limit must be positive integer');
  return [...letters].sort((a,b)=>a.failedAt.localeCompare(b.failedAt)||a.eventId.localeCompare(b.eventId)).slice(0,limit);
}

export class ReplayAudit {
  private readonly entries:Array<{eventId:string;operator:string;at:string;result:'replayed'|'skipped'|'failed'}>=[];
  record(eventId:string,operator:string,result:'replayed'|'skipped'|'failed',at=new Date()):void{
    if(!operator.trim()) throw new Error('operator required');
    this.entries.push({eventId,operator,at:at.toISOString(),result});
  }
  summary(){return this.entries.reduce((acc,e)=>{acc[e.result]++;return acc;},{replayed:0,skipped:0,failed:0});}
}
