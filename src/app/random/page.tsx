'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/header';
import { DetailModal } from '@/components/detail-modal';
import { aggregateResults } from '@/components/video-card';
import { RandomCard } from '@/components/random-card';
import { useAuth } from '@/components/auth';
import { Spinner } from '@/components/states';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { AggregatedGroup } from '@/components/video-card';
import type { SearchResultItem } from '@/lib/types';
import { validateSourceUrl } from '@/lib/utils';

/**
 * 随便看看：从已启用点播源随机翻页取片单。
 * 批次状态机：每次刷新 unshift 一个新批次到顶部，旧批次下移保留（横线分隔），
 * 离开/刷新页面才清空 —— 状态放组件内（不进 React Query 缓存）正是为此。
 */
interface RandomBatch {
  id: number;
  groups: AggregatedGroup[];
}

export default function RandomPage() {
  // 精确订阅所需字段（对齐首页做法）：设置/历史等无关 store 变化不触发重渲染
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const { verified } = useAuth();

  const [batches, setBatches] = useState<RandomBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);
  const idRef = useRef(1);
  /** 进入页面自动刷新一次的防重入（React 严格模式 effect 双调） */
  const didAutoRefreshRef = useRef(false);

  // 与首页同一套源筛选：去重、URL 合法、未停用、订阅未整体关闭
  const selectedSources = useMemo(() => {
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);

  const refresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.random(selectedSources, yellowFilter);
      if (res.list.length === 0) {
        setError('没有获取到内容，请稍后再试');
        return;
      }
      const groups = aggregateResults(res.list);
      // 成功才插入批次：失败时旧批次原样保留
      setBatches((prev) => [{ id: idRef.current++, groups }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取随机推荐失败');
    } finally {
      setLoading(false);
    }
  }, [loading, selectedSources, yellowFilter]);

  // 渲染期按当前 yellowFilter 过滤旧批次：中途打开过滤开关时，已加载的
  // 成人条目也要隐藏（不修改批次数据，关闭开关可恢复显示）
  const visibleBatches = useMemo(() => {
    if (!yellowFilter) return batches;
    return batches.map((b) => ({
      ...b,
      groups: b.groups.filter((g) => !g.items.some((i) => i.isAdult)),
    }));
  }, [batches, yellowFilter]);

  // 进入页面默认刷新一次（verified 就绪后）
  useEffect(() => {
    if (verified && !didAutoRefreshRef.current && selectedSources.length > 0) {
      didAutoRefreshRef.current = true;
      refresh();
    }
  }, [verified, selectedSources.length, refresh]);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">随便看看</h1>
            <p className="text-sm text-muted mt-1">从你的点播源里随机翻翻，说不定有惊喜</p>
          </div>
          <button
            className="btn btn-primary flex items-center gap-2"
            onClick={refresh}
            disabled={loading || selectedSources.length === 0}
          >
            {loading ? <Spinner size="sm" /> : null}
            {loading ? '加载中...' : '换一批'}
          </button>
        </div>

        {error && (
          <div className="border border-line rounded-xl p-4 mb-6 text-sm text-muted flex items-center justify-between gap-4">
            <span>{error}</span>
            <button className="btn" onClick={refresh} disabled={loading}>
              重试
            </button>
          </div>
        )}

        {!verified ? (
          <div className="border border-dashed border-line rounded-xl p-10 text-center text-muted">
            等待访问验证...
          </div>
        ) : selectedSources.length === 0 ? (
          <div className="border border-dashed border-line rounded-xl p-10 text-center text-muted">
            还没有可用的点播源，请先在右上角「设置」中启用
          </div>
        ) : (
          visibleBatches.map((batch, i) => (
            <section key={batch.id}>
              {i > 0 && <hr className="border-line my-8" />}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
                {batch.groups.map((group) => (
                  <RandomCard key={group.key} group={group} onOpen={(item) => setDetailItem(item)} />
                ))}
              </div>
            </section>
          ))
        )}

        {loading && batches.length === 0 && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}
      </main>

      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
