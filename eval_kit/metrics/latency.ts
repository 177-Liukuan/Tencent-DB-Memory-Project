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
  const sorted = [...present].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: present.length,
    mean: sum / present.length,
    // 中位数在偶数样本时取中间两项的平均值；P95 继续采用 nearest-rank。
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p95: percentile(present, 0.95),
  };
}
