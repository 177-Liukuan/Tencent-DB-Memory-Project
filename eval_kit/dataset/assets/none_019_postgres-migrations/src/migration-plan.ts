export type Phase='expand'|'backfill'|'verify'|'contract';
export interface MigrationStep { id:string; phase:Phase; description:string; blocking:boolean; rollback:string }
export interface MigrationPlan { name:string; steps:MigrationStep[] }

export function validatePlan(plan:MigrationPlan):string[]{
  const issues:string[]=[];
  if(!plan.name.trim()) issues.push('plan name is required');
  const seen=new Set<string>();
  for(const step of plan.steps){
    if(seen.has(step.id)) issues.push(`duplicate step id: ${step.id}`);
    seen.add(step.id);
    if(!step.description.trim()) issues.push(`${step.id}: description is required`);
    if(!step.rollback.trim()) issues.push(`${step.id}: rollback is required`);
  }
  const order:Phase[]=['expand','backfill','verify','contract'];
  let previous=-1;
  for(const step of plan.steps){
    const current=order.indexOf(step.phase);
    if(current<previous) issues.push(`${step.id}: phase order regressed`);
    previous=Math.max(previous,current);
  }
  return issues;
}

export function renderChecklist(plan:MigrationPlan):string{
  return plan.steps.map((step,index)=>`${index+1}. [ ] ${step.phase.toUpperCase()} ${step.id}: ${step.description}${step.blocking?' (blocking)':''}\n   rollback: ${step.rollback}`).join('\n');
}

export function chunkRange(start:number,end:number,batchSize:number):Array<{from:number;to:number}>{
  if(!Number.isInteger(start)||!Number.isInteger(end)||!Number.isInteger(batchSize)) throw new Error('integer arguments required');
  if(start<0||end<start||batchSize<=0) throw new Error('invalid range');
  const chunks:Array<{from:number;to:number}>=[];
  for(let from=start;from<end;from+=batchSize) chunks.push({from,to:Math.min(end,from+batchSize)});
  return chunks;
}

export function summarizeProgress(processed:number,total:number,failed:number){
  if(processed<0||total<0||failed<0||processed>total) throw new Error('invalid progress');
  return {processed,total,failed,remaining:total-processed,percent:total===0?100:Math.round(processed/total*10000)/100};
}
