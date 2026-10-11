/**
 * Azure Database Flexible Server(MySQL·PostgreSQL 공통) 컴퓨트 사이즈 정적 카탈로그.
 * Retail Prices API는 가격만 주고 vCore·RAM 스펙을 주지 않는다 (VM 카탈로그와 같은 사정).
 * 스펙 출처: learn.microsoft.com — postgresql/flexible-server/concepts-compute,
 *            mysql/flexible-server/concepts-service-tiers-storage (2026-10-11 확인).
 *
 * - 버스트(B): 사이즈별 가격 미터. 이중화(HA) 미지원 (두 엔진 문서 모두 명시)
 * - 범용(Dadsv5, vCore당 4GiB)·메모리 최적화(Eadsv5): vCore당 가격 미터 × vCore 수
 * - E64ads_v5는 문서마다 504/512GiB로 엇갈려 작은 값(MySQL 문서) 사용 — 과대 매칭 방지
 */

export interface AzureDbSize {
  /** 표시용 SKU명 */
  sku: string;
  vcpu: number;
  ramGb: number;
  tier: 'burstable' | 'general' | 'memory';
  /** 버스트: 가격 미터 이름(소문자, " vcore" 제거). 그 외: null (vCore당 단가 사용) */
  meter: string | null;
}

const burst = (n: string, vcpu: number, ramGb: number): AzureDbSize => ({
  sku: `Standard_${n}`,
  vcpu,
  ramGb,
  tier: 'burstable',
  meter: n.toLowerCase(),
});

export const AZURE_DB_SIZES: AzureDbSize[] = [
  burst('B1ms', 1, 2),
  burst('B2s', 2, 4),
  burst('B2ms', 2, 8),
  burst('B4ms', 4, 16),
  burst('B8ms', 8, 32),
  burst('B12ms', 12, 48),
  burst('B16ms', 16, 64),
  burst('B20ms', 20, 80),
  ...[2, 4, 8, 16, 32, 48, 64, 96].map((v) => ({
    sku: `Standard_D${v}ads_v5`,
    vcpu: v,
    ramGb: v * 4,
    tier: 'general' as const,
    meter: null,
  })),
  ...(
    [
      [2, 16],
      [4, 32],
      [8, 64],
      [16, 128],
      [20, 160],
      [32, 256],
      [48, 384],
      [64, 504],
      [96, 672],
    ] as const
  ).map(([v, ramGb]) => ({ sku: `Standard_E${v}ads_v5`, vcpu: v, ramGb, tier: 'memory' as const, meter: null })),
];
