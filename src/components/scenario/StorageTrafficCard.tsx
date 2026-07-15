'use client';

import { useTranslations } from 'next-intl';
import type { Scenario } from '@/lib/estimator';
import NumberField from './NumberField';

interface Props {
  scenario: Scenario;
  onChange: (next: Partial<Pick<Scenario, 'blockGb' | 'objectGb' | 'egressGb'>>) => void;
}

/** 스토리지·트래픽은 시나리오당 하나씩이라 단일 카드로 묶는다. 0 = 미사용 */
export default function StorageTrafficCard({ scenario, onChange }: Props) {
  const t = useTranslations('scenario');
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{t('storageTraffic')}</span>
        <span className="text-xs text-slate-400">{t('zeroUnused')}</span>
      </div>
      <div className="flex flex-wrap gap-4">
        <NumberField label={t('blockStorage')} value={scenario.blockGb} onChange={(blockGb) => onChange({ blockGb })} />
        <NumberField label={t('objectStorage')} value={scenario.objectGb} onChange={(objectGb) => onChange({ objectGb })} />
        <NumberField label={t('egress')} value={scenario.egressGb} onChange={(egressGb) => onChange({ egressGb })} />
      </div>
    </div>
  );
}
