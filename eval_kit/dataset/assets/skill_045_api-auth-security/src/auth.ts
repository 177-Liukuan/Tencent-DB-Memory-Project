import { createHmac, timingSafeEqual } from 'node:crypto';
export function sign(payload: string, secret: string) { return createHmac('sha256', secret).update(payload).digest('hex'); }
export function verify(payload: string, signature: string, secret: string) { const expected = Buffer.from(sign(payload, secret)); const actual = Buffer.from(signature); return expected.length === actual.length && timingSafeEqual(expected, actual); }
export function bearer(header: string | undefined) {
    if (!header?.startsWith('Bearer '))
        return null;
    return header.slice(7).trim() || null;
}

