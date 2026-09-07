declare module "node:test" {
    const test: any;
    export default test;
}
declare module "node:assert/strict" {
    const assert: any;
    export default assert;
}
declare module "node:crypto" {
    export const randomUUID: any;
    export const createHmac: any;
    export const timingSafeEqual: any;
    export const randomBytes: any;
    export const createHash: any;
}
declare const Buffer: any;
