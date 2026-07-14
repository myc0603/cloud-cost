'use client';

import type { Scenario } from '@/lib/estimator';
import NumberField from './NumberField';

interface Props {
  scenario: Scenario;
  onChange: (next: Partial<Pick<Scenario, 'blockGb' | 'objectGb' | 'egressGb'>>) => void;
}

/** 스토리지·트래픽은 시나리오당 하나씩이라 단일 카드로 묶는다. 0 = 미사용 */
export default function StorageTrafficCard({ scenario, onChange }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">스토리지 · 트래픽</span>
        <span className="text-xs text-slate-400">0 = 미사용</span>
      </div>
      <div className="flex flex-wrap gap-4">
        <NumberField label="블록 스토리지 (GB)" value={scenario.blockGb} onChange={(blockGb) => onChange({ blockGb })} />
        <NumberField label="오브젝트 스토리지 (GB)" value={scenario.objectGb} onChange={(objectGb) => onChange({ objectGb })} />
        <NumberField label="아웃바운드 트래픽 (GB/월)" value={scenario.egressGb} onChange={(egressGb) => onChange({ egressGb })} />
      </div>
    </div>
  );
}
