import type { EvalCase, Variant } from "../types.js";

export type ScheduledRun = {
  run_id: string;
  case_id: string;
  variant: Variant;
  pair_index: number;
  order_index: number;
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: T[], seed: number): T[] {
  const output = [...values];
  const random = seededRandom(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [output[index], output[selected]] = [output[selected] as T, output[index] as T];
  }
  return output;
}

export function buildRunSchedule(
  cases: EvalCase[],
  seed: number,
  filters: { caseIds?: Set<string>; variants?: Set<Variant> } = {},
): ScheduledRun[] {
  const selected = filters.caseIds ? cases.filter((testCase) => filters.caseIds?.has(testCase.case_id)) : cases;
  const schedule: ScheduledRun[] = [];
  for (const [pairIndex, testCase] of shuffled(selected, seed).entries()) {
    const pair: Variant[] = pairIndex % 2 === 0 ? ["baseline", "native"] : ["native", "baseline"];
    for (const variant of pair) {
      if (filters.variants && !filters.variants.has(variant)) continue;
      schedule.push({
        run_id: `${testCase.case_id}--${variant}`,
        case_id: testCase.case_id,
        variant,
        pair_index: pairIndex,
        order_index: schedule.length,
      });
    }
  }
  return schedule;
}
