export type Block = {
    kind: 'text' | 'tool';
    id: string;
};
export function stableOrder(blocks: readonly Block[]) { return blocks.map((x, index) => ({ ...x, index })); }
export function afterAnchor<T extends {
    turn: number;
}>(rows: T[], anchor: number) { return rows.filter(x => x.turn >= anchor); }
