'use client';

import { useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/header';
import { DetailModal } from '@/components/detail-modal';
import { RandomCard } from '@/components/random-card';
import { aggregateResults } from '@/components/video-card';
import { useAuth } from '@/components/auth';
import { Spinner } from '@/components/states';
import { Icon } from '@/components/icon';
import { useAppStore, resolveSource } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { SearchResultItem, SourceConfig } from '@/lib/types';
import { validateSourceUrl } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * 片库检索：先选点播源 → 动态加载该源分类树（分类/类型两级级联）
 * → 可选年代/排序 → 分页浏览。检索条件全部来自源接口，无硬编码。
 *
 * 交互约定（与自动刷新版本的区别）：筛选条件改动只进「草稿」，
 * 点「检索」才提交并请求 —— 条件多时避免每选一项就打一次源站。
 * 折叠态只回显已选条件，展开编辑。
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

/**
 * 每页条数：24 = 8 列 × 3 行整（桌面满网格；移动端 3 列 × 8 行也整）。
 * 苹果CMS pagesize 参数，源不支持时自动回退源默认 20 条。
 */
const PAGE_SIZE = 24;

export default function BrowsePage() {
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const { verified } = useAuth();

  // —— 草稿（用户正在编辑的条件）与已提交（当前结果对应的条件）分离 ——
  const [draftUrl, setDraftUrl] = useState('');
  const [draftTop, setDraftTop] = useState<number | ''>('');
  const [draftSub, setDraftSub] = useState<number | ''>('');
  const [draftYear, setDraftYear] = useState('');
  const [draftSort, setDraftSort] = useState(0);
  const [applied, setApplied] = useState({ url: '', t: undefined as number | undefined, year: '', v: 0 });

  const [filtersOpen, setFiltersOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [groups, setGroups] = useState<ReturnType<typeof aggregateResults>>([]);
  const [pageInfo, setPageInfo] = useState({ page: 1, pagecount: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);

  // 分类树跟随「草稿源」加载：让用户在选完源、点检索前就能看到分类选项
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  const availableSources = useMemo(() => {
    const seen = new Set<string>();
    return [...customAPIs, ...envSources]
      .filter((s) => validateSourceUrl(s.url) && !seen.has(s.url) && seen.add(s.url))
      .filter((s) => selectedKeys.length === 0 || selectedKeys.includes(s.key));
  }, [customAPIs, envSources, selectedKeys]);

  const topCats = useMemo(() => categories.filter((c) => c.pid === 0), [categories]);
  const subCats = useMemo(
    () => (draftTop === '' ? [] : categories.filter((c) => c.pid === draftTop)),
    [categories, draftTop]
  );

  // 草稿源变化 → 拉分类树 + 重置级联
  useEffect(() => {
    if (!draftUrl) return;
    let cancelled = false;
    setCatLoading(true);
    setCategories([]);
    setDraftTop('');
    setDraftSub('');
    setError('');
    api
      .browseCategories({ key: '', name: '', url: draftUrl })
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
  }, [draftUrl]);

  // 已提交条件查询（点检索 / 翻页时触发）
  useEffect(() => {
    if (!verified || !applied.url) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .browseList({
        source: { key: '', name: '', url: applied.url },
        t: applied.t,
        year: applied.year || undefined,
        v: applied.v,
        pg: page,
        pagesize: PAGE_SIZE,
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
  }, [verified, applied, page, yellowFilter]);

  const dirty =
    draftUrl !== applied.url ||
    (draftSub || draftTop || undefined) !== applied.t ||
    draftYear !== applied.year ||
    draftSort !== applied.v;

  const submit = () => {
    setApplied({ url: draftUrl, t: draftSub || draftTop || undefined, year: draftYear, v: draftSort });
    setPage(1);
  };

  // 回显 chips：折叠态用与展开态同款的选中 chip 展示已生效条件（视觉连续）
  const appliedChips = useMemo(() => {
    if (!applied.url) return [];
    const chips: string[] = [availableSources.find((s) => s.url === applied.url)?.name ?? '源'];
    const nameOf = (id: number) => categories.find((c) => c.id === id)?.name;
    if (applied.t) {
      const top = categories.find((c) => c.id === applied.t && c.pid === 0);
      const sub = categories.find((c) => c.id === applied.t && c.pid !== 0);
      chips.push(sub ? `${nameOf(sub.pid)}·${sub.name}` : (top?.name ?? String(applied.t)));
    }
    if (applied.year) chips.push(`${applied.year}年`);
    chips.push(SORT_OPTIONS.find((o) => o.value === applied.v)?.label ?? '');
    return chips.filter(Boolean);
  }, [applied, availableSources, categories]);

  const hasApplied = applied.url !== '';

  const pickSourceName = availableSources.find((s) => s.url === draftUrl)?.name;

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
            {/* 筛选 title 行：常驻显示已生效条件 + 折叠按钮（只收起选项区，title 不动） */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <Icon name="filter" />
              {hasApplied ? (
                appliedChips.map((label) => (
                  <span key={label} className="chip border bg-accent/10 text-accent font-medium border-accent/30">
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted">未设置筛选条件</span>
              )}
              {dirty && <span className="text-[11px] text-accent shrink-0">有未应用的修改</span>}
              <button
                className="btn btn-ghost btn-sm ml-auto"
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
              >
                {filtersOpen ? '收起' : '展开'}
                <Icon name="chevronDown" className={cn('transition-transform', filtersOpen && 'rotate-180')} />
              </button>
            </div>

            {/* 选项区：全 chip 平铺，随折叠收起 */}
            {filtersOpen && (
              <div className="border border-line rounded-xl p-4 mb-6">
                {/* 源 */}
                <FilterRow label="源">
                  {availableSources.map((s) => (
                    <Chip key={s.url} active={draftUrl === s.url} onClick={() => setDraftUrl(s.url)}>
                      {s.name}
                    </Chip>
                  ))}
                </FilterRow>

                {draftUrl && catLoading && (
                  <div className="py-2">
                    <Spinner size="sm" />
                  </div>
                )}

                {/* 分类（一级） */}
                {topCats.length > 0 && (
                  <FilterRow label="分类">
                    <Chip active={draftTop === ''} onClick={() => { setDraftTop(''); setDraftSub(''); }}>
                      全部
                    </Chip>
                    {topCats.map((c) => (
                      <Chip
                        key={c.id}
                        active={draftTop === c.id || draftSub !== '' && categories.find((x) => x.id === draftSub)?.pid === c.id}
                        onClick={() => {
                          setDraftTop(c.id);
                          setDraftSub('');
                        }}
                      >
                        {c.name}
                      </Chip>
                    ))}
                  </FilterRow>
                )}

                {/* 类型（二级，随分类变化） */}
                {subCats.length > 0 && (
                  <FilterRow label="类型">
                    <Chip active={draftTop !== '' && draftSub === ''} onClick={() => setDraftSub('')}>
                      全部
                    </Chip>
                    {subCats.map((c) => (
                      <Chip key={c.id} active={draftSub === c.id} onClick={() => setDraftSub(c.id)}>
                        {c.name}
                      </Chip>
                    ))}
                  </FilterRow>
                )}

                {/* 年代 */}
                <FilterRow label="年代">
                  <Chip active={draftYear === ''} onClick={() => setDraftYear('')}>
                    全部
                  </Chip>
                  {yearOptions().map((y) => (
                    <Chip key={y} active={draftYear === String(y)} onClick={() => setDraftYear(String(y))}>
                      {y}
                    </Chip>
                  ))}
                </FilterRow>

                {/* 排序 */}
                <FilterRow label="排序">
                  {SORT_OPTIONS.map((o) => (
                    <Chip key={o.value} active={draftSort === o.value} onClick={() => setDraftSort(o.value)}>
                      {o.label}
                    </Chip>
                  ))}
                </FilterRow>

                {/* 操作行 */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
                  <button className="btn btn-primary" onClick={submit} disabled={!draftUrl}>
                    {loading ? <Spinner size="sm" /> : <Icon name="search" />}
                    检索
                  </button>
                  {dirty && <span className="text-[11px] text-accent">条件已修改，点检索生效</span>}
                </div>
              </div>
            )}

            {error && (
              <div className="border border-line rounded-xl p-4 mb-6 text-sm text-muted">{error}</div>
            )}

            {!applied.url ? (
              <div className="border border-dashed border-line rounded-xl p-10 text-center text-muted">
                {pickSourceName ? `已选「${pickSourceName}」，设置条件后点「检索」` : '选择一个点播源开始浏览'}
              </div>
            ) : (
              <>
                {loading && groups.length === 0 ? (
                  <div className="flex justify-center py-16">
                    <Spinner size="lg" />
                  </div>
                ) : groups.length === 0 && !loading ? (
                  <div className="border border-dashed border-line rounded-xl p-10 text-center text-muted">
                    {applied.t && !subCats.length
                      ? '该分类下没有内容，试试选择具体的类型（如「动作片」）'
                      : '没有符合条件的内容，试试放宽筛选'}
                  </div>
                ) : (
                  <div className={cn('grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5', loading && 'opacity-50 pointer-events-none')}>
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

/** 一行筛选：左侧灰色标签 + 右侧 chip 平铺（可换行） */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="text-xs text-faint w-8 shrink-0 pt-1 text-right">{label}</span>
      <div className="flex flex-wrap gap-1.5 min-w-0">{children}</div>
    </div>
  );
}

/** 筛选 chip：选中态与 source-manager 的筛选 chip 同款视觉 */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'chip border',
        active
          ? 'bg-accent/10 text-accent font-medium border-accent/30'
          : 'text-muted border-line hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
