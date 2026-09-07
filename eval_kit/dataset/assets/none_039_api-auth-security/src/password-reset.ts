import { randomBytes, createHash } from 'node:crypto';
export function issueResetToken() { const raw = randomBytes(24).toString('base64url'); const digest = createHash('sha256').update(raw).digest('hex'); return { raw, digest }; }
export function normalizeResetResponse() { return { accepted: true, message: 'If the account exists, instructions will be sent.' }; }

