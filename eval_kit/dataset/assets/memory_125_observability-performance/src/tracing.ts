export type TraceContext = {
    traceId: string;
    sampled: boolean;
};
export function parseTraceparent(value: string | undefined): TraceContext | null {
    if (!value)
        return null;
    const p = value.split('-');
    if (p.length !== 4)
        return null;
    return { traceId: p[1], sampled: (parseInt(p[3], 16) & 1) === 1 };
}
