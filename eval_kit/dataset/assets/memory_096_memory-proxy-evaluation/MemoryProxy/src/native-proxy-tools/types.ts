// Registry 独立运行所需的类型；不引入服务、存储或执行器。
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type NativeToolBackend = "memory" | "skill" | "knowledge";
export type NativeToolEffect = "read" | "write" | "archive";
