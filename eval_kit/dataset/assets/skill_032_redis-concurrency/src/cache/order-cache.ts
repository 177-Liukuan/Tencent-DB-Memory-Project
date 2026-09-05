export function orderKey(id: string): string { return `order:${id}`; }
export async function loadOrder(id: string): Promise<unknown> { return { id }; }
