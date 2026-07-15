/**
 * 수집 결과 검증 — 갱신 조건이 아니라 안전장치다.
 *
 * 가격 ±30% 급변이나 건수 급감은 실제 가격 변동보다 수집기 버그(API 응답 형식
 * 변경, 페이지네이션 누락, 단위 오독)일 확률이 높다. 오염된 데이터가 배포되기
 * 전에 차단하고 기존 스냅샷을 유지한다. 상세: docs/ARCHITECTURE.md §2
 */

import type { EgressTier, StorageSku, VmSku } from '../src/lib/schema';

export interface Snapshot {
  vms: VmSku[];
  storage: StorageSku[];
  egress: EgressTier | null;
}

/** 전일 스냅샷 대비 이상 징후 목록을 반환. 빈 배열 = 통과. 이전 데이터가 없으면(첫 수집) 통과 */
export function validateSnapshot(label: string, prev: Snapshot | null, next: Snapshot): string[] {
  const errors: string[] = [];
  if (!prev) return errors;

  // 1. VM 건수 급감 — 페이지네이션 끊김·부분 실패 의심
  if (next.vms.length < prev.vms.length * 0.7) {
    errors.push(`${label}: VM 건수 급감 ${prev.vms.length} → ${next.vms.length}`);
  }

  // 2. VM 가격 급변 — 공통 SKU 중 ±30% 초과 변화가 5%를 넘으면 파싱 버그 의심.
  //    소수 SKU의 실제 가격 인하가 있을 수 있으므로 1~2건은 경고만 한다.
  const prevBySku = new Map(prev.vms.map((v) => [v.sku, v.pricePerHour]));
  const changed: string[] = [];
  let common = 0;
  for (const vm of next.vms) {
    const before = prevBySku.get(vm.sku);
    if (before === undefined) continue;
    common++;
    if (Math.abs(vm.pricePerHour - before) / before > 0.3) {
      changed.push(`${vm.sku} $${before} → $${vm.pricePerHour}`);
    }
  }
  if (changed.length > 0) {
    const detail = changed.slice(0, 5).join(', ');
    if (changed.length > Math.max(2, common * 0.05)) {
      errors.push(`${label}: VM 가격 ±30% 초과 변화 ${changed.length}건/${common}건 — ${detail}`);
    } else {
      console.warn(`⚠ ${label}: 가격 급변 ${changed.length}건 (허용 범위 내) — ${detail}`);
    }
  }

  // 3. 스토리지 — 종류 소실 또는 단가 ±30% 급변
  for (const prevSku of prev.storage) {
    const nextSku = next.storage.find((s) => s.kind === prevSku.kind);
    if (!nextSku) {
      errors.push(`${label}: 스토리지 ${prevSku.kind} 소실`);
    } else if (Math.abs(nextSku.pricePerGbMonth - prevSku.pricePerGbMonth) / prevSku.pricePerGbMonth > 0.3) {
      errors.push(`${label}: ${prevSku.kind} 단가 급변 $${prevSku.pricePerGbMonth} → $${nextSku.pricePerGbMonth}`);
    }
  }

  // 4. egress 소실 (있던 게 없어지면 파싱 실패 의심)
  if (prev.egress && !next.egress) {
    errors.push(`${label}: egress 요금표 소실`);
  }

  return errors;
}
