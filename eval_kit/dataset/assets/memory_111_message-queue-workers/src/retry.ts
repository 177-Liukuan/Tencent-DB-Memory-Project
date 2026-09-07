export function classify(error: unknown): 'permanent' | 'transient' { const m = error instanceof Error ? error.message : String(error); return /schema|invalid/i.test(m) ? 'permanent' : 'transient'; }
export function backoff(attempt: number) { return Math.min(30000, 250 * 2 ** attempt); }
