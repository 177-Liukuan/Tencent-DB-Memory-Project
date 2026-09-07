export type Line = {
    unitCents: number;
    quantity: number;
};
export function subtotal(lines: readonly Line[]) { return lines.reduce((n, x) => n + x.unitCents * x.quantity, 0); }
export function applyBasisPoints(cents: number, bps: number) { return Math.round(cents * (10000 - bps) / 10000); }
export function total(lines: readonly Line[], discountBps = 0) { return applyBasisPoints(subtotal(lines), discountBps); }
