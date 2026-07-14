import type { EstimateLine, ProviderEstimate } from '@/lib/estimator';
import type { Provider } from '@/lib/schema';

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };
const STORAGE_LABEL = { 'block-ssd': '블록 스토리지', 'object-standard': '오브젝트 스토리지' } as const;

const usd = (x: number) =>
  '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function LineLabel({ line }: { line: EstimateLine }) {
  if (line.kind === 'vm') {
    return (
      <span>
        VM {line.spec.vcpu}vCPU/{line.spec.ramGb}GB ×{line.spec.count}
        {line.matched ? (
          <span className="ml-1 font-mono text-slate-900">
            → {line.matched.sku} ({line.matched.vcpu}vCPU/{line.matched.ramGb}GB)
          </span>
        ) : (
          <span className="ml-1 text-red-500">조건 만족 인스턴스 없음</span>
        )}
      </span>
    );
  }
  if (line.kind === 'storage') {
    return (
      <span>
        {STORAGE_LABEL[line.storageKind]} {line.sizeGb}GB
        {line.pricePerGbMonth === null && <span className="ml-1 text-red-500">데이터 없음</span>}
      </span>
    );
  }
  return (
    <span>
      아웃바운드 트래픽 {line.gb}GB
      {line.freeGb !== null && line.freeGb > 0 && (
        <span className="ml-1 text-slate-400">(무료 {line.freeGb}GB 반영)</span>
      )}
      {line.monthlyUsd === null && <span className="ml-1 text-red-500">데이터 없음</span>}
    </span>
  );
}

export default function EstimateResult({ estimates }: { estimates: ProviderEstimate[] }) {
  const totals = estimates.map((e) => e.totalMonthlyUsd).filter((t): t is number => t !== null);
  const cheapest = totals.length > 0 ? Math.min(...totals) : null;

  return (
    <div className="flex flex-col gap-4">
      {estimates.map((e) => {
        const isCheapest = e.totalMonthlyUsd !== null && e.totalMonthlyUsd === cheapest;
        return (
          <div
            key={e.provider}
            className={`rounded-lg border bg-white p-4 shadow-sm ${
              isCheapest ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold">
                {PROVIDER_LABEL[e.provider]}
                {isCheapest && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                    최저가
                  </span>
                )}
              </span>
              <span className="text-lg font-bold tabular-nums">
                {!e.available ? (
                  <span className="text-sm font-normal text-slate-400">데이터 준비 중</span>
                ) : e.totalMonthlyUsd === null ? (
                  <span className="text-sm font-normal text-slate-400">견적 불가</span>
                ) : (
                  <>{usd(e.totalMonthlyUsd)}<span className="text-xs font-normal text-slate-500"> /월</span></>
                )}
              </span>
            </div>

            {e.available && e.lines.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                {e.lines.map((line, i) => (
                  <li key={i} className="flex justify-between text-xs text-slate-600">
                    <LineLabel line={line} />
                    {line.monthlyUsd !== null && <span className="tabular-nums">{usd(line.monthlyUsd)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-400">
        Linux 온디맨드 정가 × 월 730시간 기준. 할인·프리티어 미반영. 화살표(→)는 스펙을 만족하는
        최저가 인스턴스로 자동 매칭된 결과입니다. 스토리지는 범용 SSD(gp3 · Premium SSD v2 ·
        Balanced PD)와 표준 오브젝트 티어, 트래픽은 인터넷 라우팅 기준 구간 요금입니다.
      </p>
    </div>
  );
}
