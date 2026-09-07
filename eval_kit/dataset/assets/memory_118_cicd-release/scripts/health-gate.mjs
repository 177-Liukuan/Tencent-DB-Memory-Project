export function shouldPromote(samples, maxFailures = 0) {
    if (!Array.isArray(samples) || samples.length === 0)
        return false;
    let failures = 0;
    for (const sample of samples) {
        if (!sample.ok)
            failures += 1;
        if (failures > maxFailures)
            return false;
    }
    return true;
}
export function summarize(samples) {
    const ok = samples.filter(x => x.ok).length;
    return { total: samples.length, ok, failed: samples.length - ok };
}
