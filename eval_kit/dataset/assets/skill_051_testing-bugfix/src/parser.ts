export interface ParsedOrderLine { sku:string; quantity:number; unitCents:number }
export class ParseError extends Error { constructor(public readonly line:number,message:string){super(`line ${line}: ${message}`);} }

export function parseOrderCsv(text:string):ParsedOrderLine[]{
  const rows=text.split(/\r?\n/).filter(Boolean);
  return rows.map((row,index)=>{
    const [skuRaw,quantityRaw,unitRaw,...extra]=row.split(',');
    if(extra.length) throw new ParseError(index+1,'too many columns');
    const sku=(skuRaw??'').trim(); if(!sku) throw new ParseError(index+1,'sku is required');
    const quantity=Number(quantityRaw); if(!Number.isInteger(quantity)||quantity<=0) throw new ParseError(index+1,'quantity must be positive integer');
    const unitCents=Number(unitRaw); if(!Number.isInteger(unitCents)||unitCents<0) throw new ParseError(index+1,'unitCents must be non-negative integer');
    return {sku,quantity,unitCents};
  });
}

export function lineTotal(line:ParsedOrderLine):number{return line.quantity*line.unitCents;}
export function orderTotal(lines:ParsedOrderLine[]):number{return lines.reduce((sum,line)=>sum+lineTotal(line),0);}

export class FakeClock{
  constructor(private current:Date){}
  now():Date{return new Date(this.current);}
  advance(ms:number):void{if(!Number.isFinite(ms)||ms<0) throw new Error('ms must be non-negative');this.current=new Date(this.current.getTime()+ms);}
}

export class RetryBudget{
  private used=0;
  constructor(private readonly maximum:number){if(!Number.isInteger(maximum)||maximum<0) throw new Error('maximum must be non-negative');}
  take():boolean{if(this.used>=this.maximum)return false;this.used++;return true;}
  remaining():number{return this.maximum-this.used;}
}
