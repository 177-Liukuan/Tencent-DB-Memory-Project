export const stages=['build','verify','staging','production'];
export function validateArtifact(meta){
  const errors=[];
  if(!meta||typeof meta!=='object') return ['metadata object required'];
  if(typeof meta.sha!=='string'||!/^[a-f0-9]{7,64}$/i.test(meta.sha)) errors.push('sha is invalid');
  if(typeof meta.image!=='string'||!meta.image.includes('@sha256:')) errors.push('image must be digest pinned');
  if(typeof meta.builtAt!=='string'||Number.isNaN(Date.parse(meta.builtAt))) errors.push('builtAt must be ISO timestamp');
  return errors;
}
export function nextStage(current){
  const index=stages.indexOf(current); if(index<0) throw new Error(`unknown stage: ${current}`); return stages[index+1]??null;
}
export function canPromote({checks,observation}){
  const required=['tests','typecheck','security','migration'];
  for(const key of required) if(checks[key]!==true) return {ok:false,reason:`${key} check failed`};
  if(observation&&observation.errorRate>observation.maxErrorRate) return {ok:false,reason:'error rate above gate'};
  if(observation&&observation.p95Ms>observation.maxP95Ms) return {ok:false,reason:'latency above gate'};
  return {ok:true,reason:'all gates passed'};
}
export function releaseRecord({artifact,from,to,operator,at=new Date()}){
  if(!operator) throw new Error('operator required');
  if(stages.indexOf(to)!==stages.indexOf(from)+1) throw new Error('release must promote one stage at a time');
  return {artifact,from,to,operator,at:at.toISOString()};
}
export function rollbackPlan(record){
  return {action:'rollback',target:record.from,artifact:record.artifact,reason:`rollback ${record.to} promotion`};
}
