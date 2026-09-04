import type { Distribution } from "../types.js";

export function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  if (!(quantile > 0 && quantile <= 1)) throw new Error("Quantile must be in (0, 1]");
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function distribution(values: Array<number | null | undefined>): Distribution {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) return { count: 0, mean: null, median: null, p95: null };
  const sum = present.reduce((total, value) => total + value, 0);
  return {
    count: present.length,
    mean: sum / present.length,
    median: percentile(present, 0.5),
    p95: percentile(present, 0.95),
  };
}
