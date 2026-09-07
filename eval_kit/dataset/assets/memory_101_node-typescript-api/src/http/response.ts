export interface HttpResponse<T> {
    status: number;
    body: T;
    headers: Record<string, string>;
}
export function json<T>(status: number, body: T, requestId: string): HttpResponse<T> { return { status, body, headers: { 'x-request-id': requestId } }; }
