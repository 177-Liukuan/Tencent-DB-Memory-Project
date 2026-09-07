export type EvalConfig = {
    model: string;
    dataset: string;
    assetSnapshot: string;
    allowSkillWrite: boolean;
};
export function comparable(a: EvalConfig, b: EvalConfig) { return a.model === b.model && a.dataset === b.dataset && a.assetSnapshot === b.assetSnapshot && a.allowSkillWrite === b.allowSkillWrite; }
