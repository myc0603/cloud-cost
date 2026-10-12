/**
 * Azure Managed Redis SKU 정적 카탈로그 — Retail Prices API에 메모리 용량이 없다.
 * 출처: azure.microsoft.com/pricing/details/managed-redis (SKU·용량 표), learn.microsoft.com/azure/redis/overview (2026-10-12 확인).
 * - B0은 개요 문서 0.5GB / 가격 페이지 1GB로 엇갈려 작은 값 사용 (과대 매칭 방지)
 * - 두 문서에서 모두 확인된 235GB(…250 SKU)까지만 수록
 * 이중화: 가격 페이지가 "1노드(비이중화)" / "2노드(이중화)" 열을 따로 두므로 API 미터(노드 1개) × 2로 본다 — 추론값, methodology에 고지.
 */

export interface AzureCacheSize {
  sku: string; // 가격 미터 "{sku} Cache Instance"의 sku
  memoryGb: number;
  /** 가격 아이템 productName 접미사 */
  tier: 'Balanced' | 'Memory Optimized' | 'Compute Optimized';
}

const tier = (t: AzureCacheSize['tier'], entries: [string, number][]): AzureCacheSize[] =>
  entries.map(([sku, memoryGb]) => ({ sku, memoryGb, tier: t }));

export const AZURE_CACHE_SIZES: AzureCacheSize[] = [
  ...tier('Balanced', [
    ['B0', 0.5],
    ['B1', 1],
    ['B3', 3],
    ['B5', 6],
    ['B10', 12],
    ['B20', 24],
    ['B50', 60],
    ['B100', 120],
    ['B150', 175],
    ['B250', 235],
  ]),
  ...tier('Memory Optimized', [
    ['M10', 12],
    ['M20', 24],
    ['M50', 60],
    ['M100', 120],
    ['M150', 175],
    ['M250', 235],
  ]),
  ...tier('Compute Optimized', [
    ['X3', 3],
    ['X5', 6],
    ['X10', 12],
    ['X20', 24],
    ['X50', 60],
    ['X100', 120],
    ['X150', 175],
    ['X250', 235],
  ]),
];
