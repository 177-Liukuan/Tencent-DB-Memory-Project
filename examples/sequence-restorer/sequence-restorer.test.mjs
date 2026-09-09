import assert from "node:assert/strict";
import test from "node:test";
import { SequenceRestorer } from "./sequence-restorer.mts";

test("题目示例：乱序填写、重复判定和过期后的跨行恢复", () => {
  const restorer = new SequenceRestorer(2, 10);
  assert.equal(restorer.append(0, [7, 3], [0, 1], 0), 1);
  assert.equal(restorer.write(1, 3, 20, 1), "WAITING");
  assert.deepEqual(restorer.missing(1, 1), [7]);
  assert.equal(restorer.write(1, 3, 20, 2), "DUPLICATE");
  assert.equal(restorer.write(1, 3, 99, 2), "CONFLICT");
  assert.equal(restorer.write(1, 7, 10, 3), "COMPLETE");
  assert.equal(restorer.append(0, [9], [0], 4), 2);
  assert.equal(restorer.write(2, 9, 30, 5), "COMPLETE");
  assert.equal(restorer.append(1, [2], [1], 6), 3);
  assert.equal(restorer.write(3, 2, 40, 7), "COMPLETE");
  assert.equal(restorer.missing(1, 10), null);
  assert.deepEqual(restorer.restore([[[3, 20]], [[2, 40]]], 20), [
    [[7, 10], [3, 20], [9, 30]],
    [[2, 40]],
  ]);
});

test("missing 保持编号的原始顺序，不按编号大小排序", () => {
  const restorer = new SequenceRestorer(1, 10);
  const segment = restorer.append(0, [8, 2, 5, 1], [0, 0, 0, 0], 0);
  assert.deepEqual(restorer.missing(segment, 0), [8, 2, 5, 1]);
  assert.equal(restorer.write(segment, 5, 0, 1), "WAITING");
  assert.deepEqual(restorer.missing(segment, 1), [8, 2, 1]);
  assert.equal(restorer.write(segment, 2, 0, 2), "WAITING");
  assert.deepEqual(restorer.missing(segment, 2), [8, 1]);
});

test("重复和冲突不增加已填数量，也不覆盖包括零在内的原值", () => {
  const restorer = new SequenceRestorer(1, 10);
  const segment = restorer.append(0, [7, 4], [0, 0], 0);
  assert.equal(restorer.write(segment, 7, 0, 1), "WAITING");
  assert.equal(restorer.write(segment, 7, 0, 2), "DUPLICATE");
  assert.equal(restorer.write(segment, 7, -1, 3), "CONFLICT");
  assert.deepEqual(restorer.missing(segment, 3), [4]);
  assert.equal(restorer.write(segment, 4, -8, 4), "COMPLETE");
  assert.deepEqual(restorer.missing(segment, 4), []);
  assert.equal(restorer.write(segment, 4, -8, 5), "DUPLICATE");
  assert.equal(restorer.write(segment, 4, 1, 5), "CONFLICT");
  assert.deepEqual(restorer.restore([[]], 6), [[[7, 0], [4, -8]]]);
});

test("完成前的写入不续期，恰好到期不能补齐片段", () => {
  const restorer = new SequenceRestorer(1, 10);
  const segment = restorer.append(0, [1, 2], [0, 1], 0);
  assert.equal(restorer.write(segment, 1, 10, 9), "WAITING");
  assert.equal(restorer.write(segment, 2, 20, 10), "EXPIRED");
  assert.equal(restorer.missing(segment, 10), null);
  assert.deepEqual(restorer.restore([[]], 10), [[]]);
});

test("已完成片段到期后先返回 EXPIRED，但恢复信息不随之失效", () => {
  const restorer = new SequenceRestorer(1, 10);
  const segment = restorer.append(0, [1], [0], 0);
  assert.equal(restorer.write(segment, 1, 7, 9), "COMPLETE");
  assert.equal(restorer.write(segment, 1, 7, 10), "EXPIRED");
  assert.equal(restorer.write(segment, 1, 8, 10), "EXPIRED");
  assert.equal(restorer.missing(segment, 10), null);
  assert.deepEqual(restorer.restore([[]], 10), [[[1, 7]]]);
});

test("全保留片段从残缺数组取值；全删除片段无需任何可见元素", () => {
  const restorer = new SequenceRestorer(3, 10);
  const kept = restorer.append(0, [9, 2], [1, 1], 0);
  restorer.write(kept, 2, 6, 1);
  restorer.write(kept, 9, 6, 1);
  const removed = restorer.append(2, [7, 1], [0, 0], 2);
  restorer.write(removed, 1, 6, 3);
  restorer.write(removed, 7, 6, 3);
  assert.deepEqual(restorer.restore([[[9, 6], [2, 6]], [], []], 12), [
    [[9, 6], [2, 6]], [], [[7, 6], [1, 6]],
  ]);
});

test("交替删除与后续片段按位置合并，不能将隐藏元素集中到行首", () => {
  const restorer = new SequenceRestorer(1, 20);
  const first = restorer.append(0, [9, 1, 8, 2, 7], [0, 1, 0, 1, 0], 0);
  for (const id of [2, 7, 1, 9, 8]) restorer.write(first, id, -id, 1);
  const second = restorer.append(0, [3, 6], [0, 1], 2);
  restorer.write(second, 6, -6, 3);
  restorer.write(second, 3, -3, 3);
  assert.deepEqual(restorer.restore([[[1, -1], [2, -2], [6, -6]]], 30), [
    [[9, -9], [1, -1], [8, -8], [2, -2], [7, -7], [3, -3], [6, -6]],
  ]);
});

test("不恢复未完成片段，过期后可追加且不能复活旧片段", () => {
  const restorer = new SequenceRestorer(1, 3);
  const partial = restorer.append(0, [8, 3], [0, 1], 0);
  restorer.write(partial, 8, 7, 1);
  assert.deepEqual(restorer.restore([[]], 2), [[]]);
  const next = restorer.append(0, [6], [0], 3);
  assert.equal(next, 2);
  assert.equal(restorer.write(partial, 3, 4, 3), "EXPIRED");
  assert.equal(restorer.write(next, 6, 5, 3), "COMPLETE");
  assert.deepEqual(restorer.restore([[]], 100), [[[6, 5]]]);
});

test("相同创建时间的多个片段同时到期，晚创建的片段仍可填写", () => {
  const restorer = new SequenceRestorer(1, 10);
  const first = restorer.append(0, [1], [0], 0);
  restorer.write(first, 1, 11, 0);
  const second = restorer.append(0, [2], [0], 0);
  restorer.write(second, 2, 22, 0);
  const third = restorer.append(0, [3], [0], 5);
  assert.equal(restorer.missing(first, 10), null);
  assert.equal(restorer.write(second, 2, 22, 10), "EXPIRED");
  assert.deepEqual(restorer.missing(third, 10), [3]);
  assert.equal(restorer.write(third, 3, 33, 14), "COMPLETE");
  assert.deepEqual(restorer.restore([[]], 15), [[[1, 11], [2, 22], [3, 33]]]);
});

test("append 不持有调用方数组的可变引用", () => {
  const restorer = new SequenceRestorer(1, 10);
  const ids = [8, 3];
  const keep = [0, 1];
  const segment = restorer.append(0, ids, keep, 0);
  ids.reverse();
  keep.reverse();
  assert.deepEqual(restorer.missing(segment, 1), [8, 3]);
  restorer.write(segment, 8, 4, 1);
  restorer.write(segment, 3, 5, 1);
  assert.deepEqual(restorer.restore([[[3, 5]]], 10), [[[8, 4], [3, 5]]]);
});

test("重复恢复不修改输入，不与输入或长期记录共享输出数组", () => {
  const restorer = new SequenceRestorer(1, 10);
  const segment = restorer.append(0, [4, 1], [0, 1], 0);
  restorer.write(segment, 4, 40, 1);
  restorer.write(segment, 1, 10, 1);
  const visible = Object.freeze([Object.freeze([Object.freeze([1, 10])])]);
  const first = restorer.restore(visible, 10);
  assert.deepEqual(first, [[[4, 40], [1, 10]]]);
  first[0][0][1] = -1;
  first[0][1][1] = -2;
  first[0].reverse();
  assert.deepEqual(restorer.restore(visible, 11), [[[4, 40], [1, 10]]]);
  assert.deepEqual(visible, [[[1, 10]]]);
});

test("尚未创建片段时也保留全部空行", () => {
  const restorer = new SequenceRestorer(3, 10);
  assert.deepEqual(restorer.restore([[], [], []], 0), [[], [], []]);
});

// 对照模型直接保留全部原数组，逐次扫描；只用于验证，不是满足存储限制的解法。
class ArrayReference {
  constructor(m, ttl) {
    this.m = m;
    this.ttl = ttl;
    this.segments = [];
  }

  append(row, ids, keep, now) {
    this.segments.push({
      row, expiresAt: now + this.ttl, complete: false,
      cells: ids.map((id, i) => ({ id, keep: keep[i], value: undefined })),
    });
    return this.segments.length;
  }

  write(segmentId, id, value, now) {
    const segment = this.segments[segmentId - 1];
    if (now >= segment.expiresAt) return "EXPIRED";
    const cell = segment.cells.find((entry) => entry.id === id);
    if (cell.value !== undefined) return cell.value === value ? "DUPLICATE" : "CONFLICT";
    cell.value = value;
    segment.complete = segment.cells.every((entry) => entry.value !== undefined);
    return segment.complete ? "COMPLETE" : "WAITING";
  }

  missing(segmentId, now) {
    const segment = this.segments[segmentId - 1];
    return now >= segment.expiresAt
      ? null
      : segment.cells.filter((cell) => cell.value === undefined).map((cell) => cell.id);
  }

  rows(onlyVisible = false) {
    return Array.from({ length: this.m }, (_, row) => this.segments
      .filter((segment) => segment.row === row && segment.complete)
      .flatMap((segment) => segment.cells
        .filter((cell) => !onlyVisible || cell.keep === 1)
        .map((cell) => [cell.id, cell.value])));
  }
}

test("固定种子的随机操作与逐项扫描的数组模型一致", () => {
  for (let seed = 1; seed <= 30; seed++) {
    let randomState = seed;
    const random = (max) => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState % max;
    };
    const ttl = random(7) + 1;
    const actual = new SequenceRestorer(5, ttl);
    const reference = new ArrayReference(5, ttl);
    let now = 0;
    let nextId = 50000;
    for (let index = 0; index < 60; index++) {
      const row = Math.floor(index / 12);
      const ids = Array.from({ length: random(8) + 1 }, () => nextId--);
      const keep = ids.map(() => random(2));
      const createdAt = now;
      const segment = reference.append(row, ids, keep, now);
      assert.equal(actual.append(row, ids, keep, now), segment);
      const shuffled = [...ids];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (const id of shuffled) {
        // 部分片段跨越截止时间；同一 ID 的重放包括相同值和冲突值。
        now += random(5) === 0 ? ttl : 0;
        const value = random(5) - 2;
        for (const candidate of [value, value, value + 1]) {
          assert.equal(actual.write(segment, id, candidate, now),
            reference.write(segment, id, candidate, now), `seed=${seed}, segment=${segment}`);
        }
        assert.deepEqual(actual.missing(segment, now), reference.missing(segment, now));
        assert.deepEqual(actual.restore(reference.rows(true), now), reference.rows());
      }
      // 此时片段必然完整，或者已过期，满足下一次 append 的前提。
      now += random(2);
      assert.ok(reference.segments[segment - 1].complete || now >= createdAt + ttl);
    }
    now += ttl;
    for (let segment = 1; segment <= 60; segment++) {
      assert.equal(actual.missing(segment, now), null);
    }
    assert.deepEqual(actual.restore(reference.rows(true), now), reference.rows());
  }
});

test("十万次操作规模的单个大片段可逆序填写并线性恢复", () => {
  const count = 99997;
  const restorer = new SequenceRestorer(1, 1);
  const ids = Array.from({ length: count }, (_, i) => count - i);
  const keep = ids.map((_, i) => i % 2);
  const segment = restorer.append(0, ids, keep, 0);
  for (let i = count - 1; i >= 0; i--) {
    assert.equal(restorer.write(segment, ids[i], -i, 0), i === 0 ? "COMPLETE" : "WAITING");
  }
  assert.equal(restorer.missing(segment, 1), null);
  const expected = ids.map((id, i) => [id, -i]);
  const visible = [expected.filter((_, i) => keep[i] === 1)];
  assert.deepEqual(restorer.restore(visible, 1), [expected]);
});

test("十万次操作规模的多个小片段不丢失顺序或残留未完成片段", () => {
  const restorer = new SequenceRestorer(100000, 1);
  for (let index = 0; index < 33333; index++) {
    const segment = restorer.append(index * 3, [index], [0], index);
    if (index % 2 === 0) {
      assert.equal(restorer.write(segment, index, -index, index), "COMPLETE");
    } else {
      assert.deepEqual(restorer.missing(segment, index), [index]);
    }
    assert.equal(restorer.missing(segment, index + 1), null);
  }
  const restored = restorer.restore(Array.from({ length: 100000 }, () => []), 33334);
  assert.equal(restored.length, 100000);
  assert.equal(restored.flat().length, 16667);
  assert.deepEqual(restored[0], [[0, -0]]);
  assert.deepEqual(restored[3], []);
  assert.deepEqual(restored[6], [[2, -2]]);
  assert.deepEqual(restored[99996], [[33332, -33332]]);
  assert.deepEqual(restored[99999], []);
});
