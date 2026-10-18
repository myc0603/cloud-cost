'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus } from 'lucide-react';
import type { ResourceType } from '@/lib/estimator';
import { RESOURCE_ICON } from './resource-icons';

/** 추가 메뉴 분류 — RESOURCES의 모든 타입이 한 번씩 들어가야 한다 */
const GROUPS: { id: string; types: ResourceType[] }[] = [
  { id: 'compute', types: ['vm', 'k8s', 'container'] },
  { id: 'data', types: ['db', 'cache'] },
  { id: 'network', types: ['lb', 'nat', 'egress', 'cdn'] },
  { id: 'storage', types: ['block', 'object'] },
  { id: 'ops', types: ['logs'] },
];

interface Props {
  onAdd: (type: ResourceType) => void;
  canAdd: (type: ResourceType) => boolean;
}

/** "+ 리소스 추가" 하나로 접어둔 분류별 추가 메뉴 — 제자리에서 펼쳐지고, 여러 개를 연달아 추가할 수 있게 추가해도 열린 채로 둔다 */
export default function AddResourceMenu({ onAdd, canAdd }: Props) {
  const t = useTranslations('scenario');
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-dashed border-slate-300">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <Plus aria-hidden className="size-4" />
        {t('addResource')}
        <ChevronDown aria-hidden className={`size-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* 높이 애니메이션: grid 행을 0fr ↔ 1fr로 전환. 닫혀 있을 땐 inert로 포커스·클릭 차단 */}
      <div
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-dashed border-slate-300 p-3 sm:grid-cols-3">
            {GROUPS.map((g) => (
              <div key={g.id} className="flex flex-col items-start gap-0.5">
                <span className="text-xs font-semibold text-slate-400">{t(`addGroup.${g.id}`)}</span>
                {g.types.map((type) => {
                  const Icon = RESOURCE_ICON[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onAdd(type)}
                      disabled={!canAdd(type)}
                      title={t(`resourceHint.${type}`)}
                      className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      {t(`resourceTitle.${type}`)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
