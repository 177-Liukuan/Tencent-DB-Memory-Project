import type { BusinessTool } from './tool-registry.js';
export type Row = {
    caseId: string;
    tool: BusinessTool | null;
    valid: boolean;
    tokens: number;
};
export class Recorder {
    private rows: Row[] = [];
    add(row: Row) { this.rows.push(row); }
    summary() { const total = this.rows.length; return { total, valid: this.rows.filter(x => x.valid).length, falsePositive: this.rows.filter(x => x.tool && !x.valid).length, tokens: this.rows.reduce((n, x) => n + x.tokens, 0) }; }
}

