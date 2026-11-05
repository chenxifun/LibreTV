import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream } from '@/lib/fetch-utils';
import { pickRandomSources, shuffleTake } from '@/lib/random-pick';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type { RandomResponse, SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

/** 每次请求随机选中的源数量：太多拖慢响应（等最慢源），太少内容单一 */
const RANDOM_SOURCE_COUNT = 3;
/** 随机页码上限：保守值，兼顾「够随机」与「部分源深翻页慢/返回空」 */
const RANDOM_MAX_PAGE = 200;
/** 返回条数：24 = 3 源 × 20 条/页混洗后取样，两行三列网格刚好铺满 */
const RANDOM_ITEM_COUNT = 24;

/**
 * 随机片单：从随机选中的源各取一个随机页码的「列表模式」数据
 * （苹果CMS 接口去掉 wd 即按入库时间倒序的全量列表，pg 翻页），混洗返回。
 * 与搜索共用 SSRF 管线与 CMS 解析；不做缓存——随机结果缓存即失去随机性。
 */
export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;

  // 源列表走 body：全量源 JSON 编码后动辄数 KB（50 源约 15KB），
  // 放查询串会撞反代 header 上限（414/431），且源地址（可能含 token）会进访问日志
  let body: { sources?: unknown; filterAdult?: boolean };
  try {
    body = (await req.json()) as { sources?: unknown; filterAdult?: boolean };
  } catch {
    return NextResponse.json({ error: '无效的源列表' }, { status: 400 });
  }
  const filterAdult = body.filterAdult === true;

  let sources: SourceConfig[];
  if (!Array.isArray(body.sources)) {
    return NextResponse.json({ error: '无效的源列表' }, { status: 400 });
  }
  sources = body.sources.filter(
    (s): s is SourceConfig =>
      s && typeof s === 'object' &&
      typeof s.url === 'string' && typeof s.name === 'string' && typeof s.key === 'string'
  );
  if (sources.length === 0) {
    return NextResponse.json({ error: '无效的源列表' }, { status: 400 });
  }

  const picked = pickRandomSources(sources, RANDOM_SOURCE_COUNT);
  const failures: RandomResponse['failures'] = [];

  const results = await Promise.all(
    picked.map(async (source): Promise<RandomResponse['list']> => {
      if (!/^https?:\/\//.test(source.url)) {
        failures.push({ sourceKey: source.key, error: '无效的源地址' });
        return [];
      }
      // 用户可控地址发起服务端请求，必须先过 SSRF 校验（与搜索同款）
      const verdict = await checkUpstreamAllowed(source.url);
      if (!verdict.ok) {
        failures.push({ sourceKey: source.key, error: verdict.reason });
        return [];
      }

      const base = source.url.replace(/\/+$/, '');
      const fetchPage = async (page: number) => {
        const api = `${base}?ac=videolist&pg=${page}`;
        const res = await fetchUpstream(api, { timeoutMs: 8000, headers: cmsRequestHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };

      try {
        const page = 1 + Math.floor(Math.random() * RANDOM_MAX_PAGE);
        let items = parseSearchList(await fetchPage(page), source);
        // 随机页可能超出该源真实 pagecount（返回空列表）：回退最新入库页
        if (items.length === 0) {
          items = parseSearchList(await fetchPage(1), source);
        }
        return items;
      } catch (err) {
        failures.push({
          sourceKey: source.key,
          error: err instanceof Error ? err.message : '请求失败',
        });
        return [];
      }
    })
  );

  const merged = filterAdultResults(results.flat(), filterAdult);
  const list = shuffleTake(merged, RANDOM_ITEM_COUNT);
  // 随机结果禁缓存：URL 固定的 POST 也可能被中间层按启发式缓存
  return NextResponse.json({ list, failures } satisfies RandomResponse, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
