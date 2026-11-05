'use client';

import { useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/header';
import { DetailModal } from '@/components/detail-modal';
import { RandomCard } from '@/components/random-card';
import { aggregateResults } from '@/components/video-card';
import { useAuth } from '@/components/auth';
import { Spinner } from '@/components/states';
import { useAppStore, resolveSource } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { SearchResultItem, SourceConfig } from '@/lib/types';
import { validateSourceUrl } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * 片库检索：先选点播源 → 动态加载该源分类树（分类/类型两级级联）
 * → 可选年代/排序 → 分页浏览。检索条件全部来自源接口，无硬编码。
 * 排序 v 参数是苹果CMS 通用约定：0更新 1添加 2人气 3评分（各源实现不一，尽力而为）。
 */
interface Category {
  id: number;
  pid: number;
  name: string;
}

const SORT_OPTIONS = [
  { value: 0, label: '最新更新' },
  { value: 1, label: '最新添加' },
  { value: 2, label: '最热' },
  { value: 3, label: '评分' },
];

/** 年代候选：接口不提供枚举，按当前年份倒推生成 */
function yearOptions(): number[] {
  const now = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => now - i);
}

export default function BrowsePage() {
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const { verified } = useAuth();

  const [sourceUrl, setSourceUrl] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [topCat, setTopCat] = useState<number | ''>('');
  const [subCat, setSubCat] = useState<number | ''>('');
  const [year, setYear] = useState('');
  const [sort, setSort] = useState(0);
  const [page, setPage] = useState(1);
  const [groups, setGroups] = useState<ReturnType<typeof aggregateResults>>([]);
  const [pageInfo, setPageInfo] = useState({ page: 1, pagecount: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);

  // 已启用且有效的源（不做健康度过滤：检索场景用户明确指定源）
  const availableSources = useMemo(() => {
    const seen = new Set<string>();
    return [...customAPIs, ...envSources]
      .filter((s) => validateSourceUrl(s.url) && !seen.has(s.url) && seen.add(s.url))
      .filter((s) => selectedKeys.length === 0 || selectedKeys.includes(s.key));
  }, [customAPIs, envSources, selectedKeys]);

  const currentSource = useMemo(
    () => availableSources.find((s) => s.url === sourceUrl),
    [availableSources, sourceUrl]
  );

  // 分类树：一级（分类）与二级（内容类型）由 type_pid 组装
  const topCats = useMemo(() => categories.filter((c) => c.pid === 0), [categories]);
  const subCats = useMemo(
    () => (topCat === '' ? [] : categories.filter((c) => c.pid === topCat)),
    [categories, topCat]
  );

  // 选源 → 拉分类树；源变化时重置级联筛选与页码
  useEffect(() => {
    if (!sourceUrl) return;
    let cancelled = false;
    setCatLoading(true);
    setCategories([]);
    setTopCat('');
    setSubCat('');
    setPage(1);
    setError('');
    api
      .browseCategories({ key: '', name: '', url: sourceUrl })
      .then((res) => {
        if (!cancelled) setCategories(res.categories);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '获取分类失败');
      })
      .finally(() => {
        if (!cancelled) setCatLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  // 检索条件变化 → 自动回第 1 页并查询
  useEffect(() => {
    setPage(1);
  }, [sourceUrl, topCat, subCat, year, sort]);

  // 查询（源+条件+页码 任一变化）
  useEffect(() => {
    if (!verified || !sourceUrl) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .browseList({
        source: { key: '', name: '', url: sourceUrl },
        t: subCat || topCat || undefined,
        year: year || undefined,
        v: sort,
        pg: page,
        filterAdult: yellowFilter,
      })
      .then((res) => {
        if (cancelled) return;
        setGroups(aggregateResults(res.list));
        setPageInfo({ page: res.page, pagecount: res.pagecount });
      })
      .catch((err) => {
        if (cancelled) return;
        setGroups([]);
        setError(err instanceof Error ? err.message : '查询失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [verified, sourceUrl, topCat, subCat, year, sort, page, yellowFilter]);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">片库</h1>
            <p className="text-sm text-muted mt-1">按源浏览分类与年代，发现更多内容</p>
          </div>
        </div>

        {!verified ? (
          <div className="border border-dashed border-line rounded-xl p-10 text-center text-muted">
            等待访问验证...
          </div>
        ) : availableSources.length === 0 ? (
          <div className="border border-dashed border-line rounded-xl p-10 text-center text-muted">
            还没有可用的点播源，请先在右上角「设置」中启用
          </div>
        ) : (
          <>
            {/* 筛选条 */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <select
                aria-label="选择点播源"
                className="input h-9 w-44"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              >
                <option value="">选择点播源…</option>
                {availableSources.map((s) => (
                  <option key={s.url} value={s.url}>
                    {s.name}
                  </option>
                ))}
              </select>

              {catLoading && <Spinner size="sm" />}

              {topCats.length > 0 && (
                <select
                  aria-label="分类"
                  className="input h-9 w-28"
                  value={topCat}
                  onChange={(e) => {
                    setTopCat(e.target.value ? Number(e.target.value) : '');
                    setSubCat('');
                  }}
                >
                  <option value="">全部分类</option>
                  {topCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {subCats.length > 0 && (
                <select
                  aria-label="类型"
                  className="input h-9 w-28"
                  value={subCat}
                  onChange={(e) => setSubCat(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">全部类型</option>
                  {subCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                aria-label="年代"
                className="input h-9 w-24"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              >
                <option value="">全部年代</option>
                {yearOptions().map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>

              <select
                aria-label="排序"
                className="input h-9 w-28"
                value={sort}
                onChange={(e) => setSort(Number(e.target.value))}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="border border-line rounded-xl p-4 mb-6 text-sm text-muted">{error}</div>
            )}

            {!sourceUrl ? (
              <div className="border border-dashed border-line rounded-xl p-10 text-center text-muted">
                选择一个点播源开始浏览
              </div>
            ) : (
              <>
                {loading && groups.length === 0 ? (
                  <div className="flex justify-center py-16">
                    <Spinner size="lg" />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
                    {groups.map((g) => (
                      <RandomCard key={g.key} group={g} onOpen={(item) => setDetailItem(item)} />
                    ))}
                  </div>
                )}

                {/* 分页器 */}
                {pageInfo.pagecount > 1 && !loading && (
                  <div className="flex items-center justify-center gap-2 mt-8">
                    <button
                      className="btn h-9"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </button>
                    <span className={cn('text-sm text-muted px-2')}>
                      {pageInfo.page} / {pageInfo.pagecount}
                    </span>
                    <button
                      className="btn h-9"
                      disabled={page >= pageInfo.pagecount}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
