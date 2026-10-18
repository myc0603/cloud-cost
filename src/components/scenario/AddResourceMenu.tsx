'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ResourceType } from '@/lib/estimator';

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

/** "+ 리소스 추가" 하나로 접어둔 분류별 추가 메뉴 — 제자리에서 펼쳐진다 */
export default function AddResourceMenu({ onAdd, canAdd }: Props) {
  const t = useTranslations('scenario');
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-dashed border-slate-300">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1 px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900"
      >
        {open ? '−' : '+'} {t('addResource')}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-dashed border-slate-300 p-3 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.id} className="flex flex-col items-start gap-1">
              <span className="text-xs font-semibold text-slate-400">{t(`addGroup.${g.id}`)}</span>
              {g.types.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    onAdd(type);
                    setOpen(false);
                  }}
                  disabled={!canAdd(type)}
                  title={t(`resourceHint.${type}`)}
                  className="text-left text-sm text-slate-700 hover:text-slate-950 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                >
                  + {t(`resourceTitle.${type}`)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
