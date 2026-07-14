'use client';

import type { VmSpec } from '@/lib/estimator';

interface Props {
  index: number;
  spec: VmSpec;
  onChange: (spec: VmSpec) => void;
  onRemove: () => void;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= 1) onChange(n);
        }}
        className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
      />
    </label>
  );
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
        <NumberField label="vCPU" value={spec.vcpu} onChange={(vcpu) => onChange({ ...spec, vcpu })} />
        <NumberField label="RAM (GB)" value={spec.ramGb} onChange={(ramGb) => onChange({ ...spec, ramGb })} />
        <NumberField label="대수" value={spec.count} onChange={(count) => onChange({ ...spec, count })} />
      </div>
    </div>
  );
}
