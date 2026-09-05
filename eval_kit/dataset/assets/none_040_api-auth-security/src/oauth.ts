export function safeRedirect(candidate: string, allowedOrigin: string) {
    const url = new URL(candidate, allowedOrigin);
    if (url.origin !== allowedOrigin)
        return '/';
    return `${url.pathname}${url.search}`;
}
export function validateState(expected: string, actual: string) { return expected.length > 10 && expected === actual; }

