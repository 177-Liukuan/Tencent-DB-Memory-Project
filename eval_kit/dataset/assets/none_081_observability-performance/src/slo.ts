export interface WindowSample { requests:number; errors:number; latenciesMs:number[] }
export interface Slo { availability:number; latencyMs:number; latencyPercentile:number }
export interface SloResult { availability:number; percentileMs:number; errorBudgetConsumed:number; passing:boolean }

export function percentile(values:number[],p:number):number{
  if(p<0||p>1)throw new Error('p must be in [0,1]'); if(values.length===0)return 0;
  const sorted=[...values].sort((a,b)=>a-b);const index=Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1);return sorted[Math.max(0,index)];
}
export function evaluateSlo(sample:WindowSample,slo:Slo):SloResult{
  if(sample.requests<0||sample.errors<0||sample.errors>sample.requests)throw new Error('invalid counters');
  const availability=sample.requests===0?1:(sample.requests-sample.errors)/sample.requests;
  const percentileMs=percentile(sample.latenciesMs,slo.latencyPercentile);
  const allowedFailure=1-slo.availability;const observedFailure=1-availability;
  const errorBudgetConsumed=allowedFailure===0?(observedFailure===0?0:Infinity):observedFailure/allowedFailure;
  return {availability,percentileMs,errorBudgetConsumed,passing:availability>=slo.availability&&percentileMs<=slo.latencyMs};
}
export interface AlertState { firing:boolean; reason:string }
export function alertFor(result:SloResult,burnThreshold:number):AlertState{
  if(result.errorBudgetConsumed>=burnThreshold)return{firing:true,reason:'error budget burn'};
  if(!result.passing)return{firing:true,reason:'SLO objective missed'};
  return{firing:false,reason:'within objective'};
}
export function mergeSamples(samples:WindowSample[]):WindowSample{return{requests:samples.reduce((n,s)=>n+s.requests,0),errors:samples.reduce((n,s)=>n+s.errors,0),latenciesMs:samples.flatMap(s=>s.latenciesMs)};}
