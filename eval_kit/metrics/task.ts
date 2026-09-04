import type { AnswerAssertion, EvalCase } from "../types.js";

export function evaluateAnswer(assertion: AnswerAssertion, answer: string): boolean {
  if (assertion.operator === "exact") return answer.trim() === assertion.value.trim();
  if (assertion.operator === "contains") return answer.includes(assertion.value);
  try {
    return new RegExp(assertion.value, assertion.flags).test(answer);
  } catch {
    return false;
  }
}

export function scoreTask(testCase: EvalCase, answer: string | null): boolean | null {
  const assertions = testCase.answer_assertions;
  if (!assertions || assertions.length === 0) return null;
  if (answer === null) return false;
  return assertions.every((assertion) => evaluateAnswer(assertion, answer));
}
