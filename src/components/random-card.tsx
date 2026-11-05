'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';
import type { AggregatedGroup } from './video-card';
import type { SearchResultItem } from '@/lib/types';
import { SmartImage } from './smart-image';

/**
 * 随便看看页的海报卡：对齐首页推荐区 DoubanCard 的形态 —— 纯竖版封面，
 * 名称/类型/年份以渐变遮罩叠在封面下部；多源以左上角标签提示。
 * 与 AggregatedCard 的区别：无展开面板与画质探测（浏览场景不需要），
 * 点击直接打开第一个（最好画质进入详情后再选）。
 */
export function RandomCard({
  group,
  onOpen,
}: {
  group: AggregatedGroup;
  onOpen: (item: SearchResultItem) => void;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [group.pic]);

  const multi = group.items.length > 1;
  const adult = useMemo(() => group.items.some((i) => i.isAdult), [group.items]);

  const activate = () => onOpen(group.items[0]);

  return (
    <div
      className="card cursor-pointer hover:scale-[1.03] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
    >
      <div className="relative aspect-[2/3] bg-chip">
        {group.pic && !imgFailed ? (
          <SmartImage
            url={group.pic}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={group.name}
            className="w-full h-full object-cover"
            onExhausted={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-chip">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 011 1 12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
          </div>
        )}

        {/* 信息叠在封面上：底部渐变遮罩，名称/类型/年份白字 */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-6">
          <div className="text-xs font-medium text-white truncate" title={group.name}>
            {group.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/75">
            {group.typeName && <span className="truncate">{group.typeName}</span>}
            {group.year && (
              <>
                {group.typeName && <span>·</span>}
                <span className="shrink-0">{group.year}</span>
              </>
            )}
            {group.remarks && (
              <>
                {(group.typeName || group.year) && <span>·</span>}
                <span className="truncate">{group.remarks}</span>
              </>
            )}
          </div>
        </div>

        {multi && (
          <span className="absolute top-1.5 left-1.5 tag bg-black/70 text-accent font-medium">
            {group.items.length} 源
          </span>
        )}
        {adult && (
          <span className="absolute top-1.5 right-1.5 tag bg-black/70 text-rating">18+</span>
        )}
      </div>
    </div>
  );
}
