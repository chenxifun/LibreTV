import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type { SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * 片库检索：按源的分类/类型/年代/排序分页浏览。
 * 苹果CMS 列表接口的既有能力：
 * - 无 ac 参数     → 返回该源自己的分类树（class 数组，两级 type_pid）
 * - ac=videolist   → 分页列表，可组合 t(分类) year(年代) pg(页) v(排序) wd(关键词)
 * 分类 ID 各源不同（暴风电影=20、量子电影=1），必须动态拉取，绝不写死。
 */

interface BrowseCategory {
  id: number;
  pid: number;
  name: string;
}

/** 源分类树缓存：各源分类极少变化，5 分钟内免重复拉取 */
const CATEGORY_TTL = 5 * 60 * 1000;
const categoryCache = new Map<string, { at: number; data: BrowseCategory[] }>();

async function fetchCategories(source: SourceConfig): Promise<BrowseCategory[]> {
  const cacheKey = source.url.replace(/\/+$/, '');
  const hit = categoryCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CATEGORY_TTL) return hit.data;

  const verdict = await checkUpstreamAllowed(source.url);
  if (!verdict.ok) throw new Error(verdict.reason);

  // 用 URL 对象拼接：源地址可能自带查询串，字符串拼 ? 会吞掉已有参数
  const u = new URL(cacheKey);
  u.searchParams.delete('ac');
  const res = await fetchUpstream(u.toString(), { timeoutMs: 8000, headers: cmsRequestHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { class?: Array<{ type_id?: unknown; type_pid?: unknown; type_name?: unknown }> };
  const categories: BrowseCategory[] = (Array.isArray(data.class) ? data.class : [])
    .map((c) => ({
      id: Number(c.type_id),
      pid: Number(c.type_pid ?? 0),
      name: String(c.type_name ?? '').trim(),
    }))
    .filter((c) => Number.isFinite(c.id) && c.name);
  const result = { at: Date.now(), data: categories };
  categoryCache.set(cacheKey, result);
  return categories;
}

/** GET ?categories=1&url=… → 源分类树（动态，无硬编码映射） */
export async function GET(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;

  const url = new URL(req.url);
  if (url.searchParams.get('categories') !== '1') {
    return NextResponse.json({ error: '缺少 categories 参数' }, { status: 400 });
  }
  const raw = url.searchParams.get('url') || '';
  const name = url.searchParams.get('name') || '源';
  if (!/^https?:\/\//.test(raw)) {
    return NextResponse.json({ error: '无效的源地址' }, { status: 400 });
  }
  try {
    const categories = await fetchCategories({ key: '', name, url: raw });
    return NextResponse.json({ categories });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取分类失败' },
      { status: 502 }
    );
  }
}

interface BrowseBody {
  source?: SourceConfig;
  t?: number;
  year?: string;
  v?: number;
  wd?: string;
  pg?: number;
  filterAdult?: boolean;
}

/** POST → 分页列表：透传 t/year/v/wd/pg，返回 list + page/pagecount */
export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;

  let body: BrowseBody;
  try {
    body = (await req.json()) as BrowseBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const source = body.source;
  if (!source || typeof source.url !== 'string' || !/^https?:\/\//.test(source.url)) {
    return NextResponse.json({ error: '无效的源' }, { status: 400 });
  }

  const verdict = await checkUpstreamAllowed(source.url);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 403 });
  }

  // URL 对象拼接：保留源地址自带查询串
  const u = new URL(source.url.replace(/\/+$/, ''));
  u.searchParams.set('ac', 'videolist');
  if (Number.isFinite(body.t) && Number(body.t) > 0) u.searchParams.set('t', String(body.t));
  if (typeof body.year === 'string' && /^\d{4}$/.test(body.year)) u.searchParams.set('year', body.year);
  if (Number.isFinite(body.v) && Number(body.v) >= 0) u.searchParams.set('v', String(body.v));
  if (typeof body.wd === 'string' && body.wd.trim()) u.searchParams.set('wd', body.wd.trim());
  const pg = Number.isFinite(body.pg) && Number(body.pg) > 0 ? Math.floor(Number(body.pg)) : 1;
  u.searchParams.set('pg', String(pg));

  let json: { page?: unknown; pagecount?: unknown };
  try {
    const res = await fetchUpstream(u.toString(), { timeoutMs: 8000, headers: cmsRequestHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = (await res.json()) as typeof json;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '请求上游失败' },
      { status: 502 }
    );
  }

  const list = filterAdultResults(parseSearchList(json, source), body.filterAdult !== false);
  return NextResponse.json({
    list,
    page: parseInt(String(json.page ?? pg), 10) || pg,
    pagecount: Math.max(1, parseInt(String(json.pagecount ?? 1), 10) || 1),
  });
}
