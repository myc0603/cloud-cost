'use client';

import type { VmSpec } from '@/lib/estimator';
import NumberField from './NumberField';

interface Props {
  index: number;
  spec: VmSpec;
  onChange: (spec: VmSpec) => void;
  onRemove: () => void;
}

export default function ResourceCard({ index, spec, onChange, onRemove }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">가상 머신 #{index + 1}</span>
        <button
          onClick={onRemove}
          className="text-xs text-slate-400 hover:text-red-600"
          aria-label="이 리소스 삭제"
        >
          삭제
        </button>
      </div>
      <div className="flex gap-4">
        <NumberField label="vCPU" value={spec.vcpu} min={1} onChange={(vcpu) => onChange({ ...spec, vcpu })} />
        <NumberField label="RAM (GB)" value={spec.ramGb} min={1} onChange={(ramGb) => onChange({ ...spec, ramGb })} />
        <NumberField label="대수" value={spec.count} min={1} onChange={(count) => onChange({ ...spec, count })} />
      </div>
    </div>
  );
}
