export interface EvalInput { model:string; query:string; assetSnapshot:string; memoryRead:boolean; skillRead:boolean; promptRevision:string; identity:string }
export interface Difference { field:keyof EvalInput; baseline:unknown; native:unknown }

const fields:Array<keyof EvalInput>=['model','query','assetSnapshot','memoryRead','skillRead','promptRevision','identity'];
export function compareInputs(baseline:EvalInput,native:EvalInput):Difference[]{
  const differences:Difference[]=[];
  for(const field of fields){if(baseline[field]!==native[field])differences.push({field,baseline:baseline[field],native:native[field]});}
  return differences;
}
export function assertFairComparison(baseline:EvalInput,native:EvalInput):void{
  const differences=compareInputs(baseline,native);if(differences.length)throw new Error(`unfair comparison: ${differences.map(x=>x.field).join(', ')}`);
}
export interface MetricRow { injectedTokens:number; validCalls:number; wrongToolCalls:number; falsePositiveCalls:number; family:'memory'|'skill'|'none' }
export function summarize(rows:MetricRow[]){
  const base={runs:0,injectedTokens:0,validCalls:0,wrongToolCalls:0,falsePositiveCalls:0};
  return rows.reduce((acc,row)=>({runs:acc.runs+1,injectedTokens:acc.injectedTokens+row.injectedTokens,validCalls:acc.validCalls+row.validCalls,wrongToolCalls:acc.wrongToolCalls+row.wrongToolCalls,falsePositiveCalls:acc.falsePositiveCalls+row.falsePositiveCalls}),base);
}
export function byFamily(rows:MetricRow[]){return{memory:summarize(rows.filter(x=>x.family==='memory')),skill:summarize(rows.filter(x=>x.family==='skill')),none:summarize(rows.filter(x=>x.family==='none')),overall:summarize(rows)};}
export function validRate(rows:MetricRow[]):number{const total=rows.length;return total===0?0:rows.reduce((n,row)=>n+(row.validCalls>0?1:0),0)/total;}
export function wrongToolRate(rows:MetricRow[]):number{const calls=rows.reduce((n,row)=>n+row.validCalls+row.wrongToolCalls,0);return calls===0?0:rows.reduce((n,row)=>n+row.wrongToolCalls,0)/calls;}
