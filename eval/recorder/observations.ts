export function isProxyModelGeneration(observation: Record<string, unknown>): boolean {
  if (String(observation.type).toUpperCase() !== "GENERATION") return false;
  const metadata = observation.metadata;
  return Boolean(
    metadata
    && typeof metadata === "object"
    && (metadata as Record<string, unknown>).protocol === "anthropic",
  );
}

export function proxyModelGenerationCount(observations: Record<string, unknown>[]): number {
  return observations.filter(isProxyModelGeneration).length;
}
