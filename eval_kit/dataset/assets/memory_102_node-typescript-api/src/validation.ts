export type ValidationIssue = { path: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string, issues: ValidationIssue[]): string | undefined {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ path: key, message: 'must be a non-empty string' });
    return undefined;
  }
  return value.trim();
}

function integerField(record: Record<string, unknown>, key: string, issues: ValidationIssue[]): number | undefined {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.push({ path: key, message: 'must be an integer' });
    return undefined;
  }
  return value;
}

export interface OrderQueryInput { customerId?: string; offset: number; limit: number }
export function validateOrderQuery(value: unknown): ValidationResult<OrderQueryInput> {
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', message: 'must be an object' }] };
  const issues: ValidationIssue[] = [];
  const allowed = new Set(['customerId', 'offset', 'limit']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push({ path: key, message: 'unknown field' });
  const customerId = value.customerId === undefined ? undefined : stringField(value, 'customerId', issues);
  const offset = integerField(value, 'offset', issues);
  const limit = integerField(value, 'limit', issues);
  if (offset !== undefined && offset < 0) issues.push({ path: 'offset', message: 'must be >= 0' });
  if (limit !== undefined && limit <= 0) issues.push({ path: 'limit', message: 'must be > 0' });
  if (issues.length || offset === undefined || limit === undefined) return { ok: false, issues };
  return { ok: true, value: { customerId, offset, limit } };
}

export interface RuntimeConfig { apiBaseUrl: string; requestTimeoutMs: number; environment: 'local'|'test'|'production' }
export function parseRuntimeConfig(env: Record<string,string|undefined>): RuntimeConfig {
  const apiBaseUrl=(env.ORDER_API_BASE_URL??'').trim();
  if(!apiBaseUrl) throw new Error('ORDER_API_BASE_URL is required');
  const requestTimeoutMs=Number(env.REQUEST_TIMEOUT_MS??'5000');
  if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<=0) throw new Error('REQUEST_TIMEOUT_MS must be a positive integer');
  const environment=env.APP_ENV??'local';
  if(environment!=='local'&&environment!=='test'&&environment!=='production') throw new Error('APP_ENV is invalid');
  return {apiBaseUrl,requestTimeoutMs,environment};
}
