/**
 * 随机片单的纯函数：随机抽样与混洗。
 * 抽成独立模块的原因：route 里直接内联会不可测（Math.random 依赖散在逻辑里），
 * 这里保证两个函数都不修改入参、可直接单测。
 */

/** 无重复随机抽样：从 sources 中随机取 count 个（不足时返回全部） */
export function pickRandomSources<T>(sources: T[], count: number): T[] {
  if (count >= sources.length) return [...sources];
  // 索引池随机抽取，避免「随机过滤」造成的重复与偏斜
  const pool = sources.map((_, i) => i);
  const picked: number[] = [];
  for (let k = 0; k < count; k++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked.map((i) => sources[i]);
}

/** Fisher-Yates 混洗后取前 count 个；不修改原数组 */
export function shuffleTake<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
