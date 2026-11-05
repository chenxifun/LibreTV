import { describe, expect, it } from 'vitest';
import { pickRandomSources, shuffleTake } from './random-pick';

describe('pickRandomSources', () => {
  it('返回数量不超过请求数与源总数', () => {
    const src = [1, 2, 3, 4, 5];
    expect(pickRandomSources(src, 3).length).toBe(3);
    expect(pickRandomSources(src, 10).length).toBe(5);
    expect(pickRandomSources([], 3)).toEqual([]);
  });

  it('无重复且全部来自原数组', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const picked = pickRandomSources(src, 4);
    expect(new Set(picked).size).toBe(4);
    picked.forEach((p) => expect(src).toContain(p));
  });

  it('不修改原数组', () => {
    const src = [1, 2, 3];
    const copy = [...src];
    pickRandomSources(src, 2);
    expect(src).toEqual(copy);
  });
});

describe('shuffleTake', () => {
  it('不修改原数组且元素不增不减', () => {
    const src = [1, 2, 3, 4, 5];
    const copy = [...src];
    const out = shuffleTake(src, 3);
    expect(src).toEqual(copy);
    expect(out.length).toBe(3);
    out.forEach((o) => expect(src).toContain(o));
    expect(new Set(out).size).toBe(3);
  });

  it('count 超长时返回全部', () => {
    expect(shuffleTake([1, 2], 10).length).toBe(2);
    expect(shuffleTake([], 5)).toEqual([]);
  });
});
