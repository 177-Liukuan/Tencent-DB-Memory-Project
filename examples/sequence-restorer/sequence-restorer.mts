export type WriteStatus =
  | "WAITING"
  | "COMPLETE"
  | "DUPLICATE"
  | "CONFLICT"
  | "EXPIRED";

export type Element = [id: number, value: number];
export type VisibleRows = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

interface FillingSegment {
  row: number;
  ids: number[];
  keep: (0 | 1)[];
  values: Map<number, number>;
  expiresAt: number;
}

// 保留位置没有 value 字段；它的数值只能在恢复时从 visible 取得。
type RestoreEntry =
  | { id: number; keep: 1 }
  | { id: number; keep: 0; value: number };

/** 输入满足题目约束；所有过期清理均由操作传入的逻辑时间驱动。 */
export class SequenceRestorer {
  readonly #ttl: number;
  readonly #active = new Map<number, FillingSegment>();
  readonly #rows: RestoreEntry[][];
  #nextSegmentId = 1;

  constructor(m: number, ttl: number) {
    this.#ttl = ttl;
    this.#rows = Array.from({ length: m }, () => []);
  }

  append(row: number, ids: readonly number[], keep: readonly (0 | 1)[], now: number): number {
    this.#expire(now);
    const segmentId = this.#nextSegmentId++;
    this.#active.set(segmentId, {
      row,
      ids: [...ids],
      keep: [...keep],
      values: new Map(),
      expiresAt: now + this.#ttl,
    });
    return segmentId;
  }

  write(segmentId: number, id: number, value: number, now: number): WriteStatus {
    this.#expire(now);
    const segment = this.#active.get(segmentId);
    if (!segment) return "EXPIRED";

    if (segment.values.has(id)) {
      return segment.values.get(id) === value ? "DUPLICATE" : "CONFLICT";
    }

    segment.values.set(id, value);
    if (segment.values.size < segment.ids.length) return "WAITING";

    // 前一片段必须完成或过期后才能 append，因此完成顺序就是片段顺序。
    // 先判断重复，再进入此分支，保证每个完成片段只归档一次。
    const row = this.#rows[segment.row]!;
    for (let i = 0; i < segment.ids.length; i++) {
      const elementId = segment.ids[i]!;
      row.push(segment.keep[i] === 1
        ? { id: elementId, keep: 1 }
        : { id: elementId, keep: 0, value: segment.values.get(elementId)! });
    }
    return "COMPLETE";
  }

  missing(segmentId: number, now: number): number[] | null {
    this.#expire(now);
    const segment = this.#active.get(segmentId);
    if (!segment) return null;
    return segment.ids.filter((id) => !segment.values.has(id));
  }

  restore(visible: VisibleRows, now: number): Element[][] {
    this.#expire(now);
    return this.#rows.map((entries, row) => {
      let cursor = 0;
      return entries.map((entry): Element => [
        entry.id,
        entry.keep === 0 ? entry.value : visible[row]![cursor++]![1],
      ]);
    });
  }

  #expire(now: number): void {
    // Map 保持插入顺序，且 TTL 固定、时间单调，所以到期时间也有序。
    // 每个片段只删除一次，不扫描所有历史，不使用 shift 或真实定时器。
    for (const [segmentId, segment] of this.#active) {
      if (now < segment.expiresAt) break;
      this.#active.delete(segmentId);
    }
  }
}
