/**
 * 견적 엔진 공통 타입 — 리소스 모듈(vm·storage·egress …)과 진입점(index.ts)이 함께 쓴다.
 * 리소스 모듈은 이 파일만 import한다 (index.ts를 import하면 순환 참조).
 */

import type { Provider, ProviderPricing, Region, StorageSku, VmSku } from '../schema';

export interface VmSpec {
  vcpu: number;
  ramGb: number;
  count: number;
}

/** 시나리오의 리소스 카드 하나. type이 레지스트리(index.ts RESOURCES) 키 */
export type Resource =
  | ({ type: 'vm' } & VmSpec)
  | { type: 'block'; gb: number }
  | { type: 'object'; gb: number }
  | { type: 'egress'; gb: number }; // 월 아웃바운드 전송량

export type ResourceType = Resource['type'];

export interface Scenario {
  region: Region;
  /** 카드 순서 그대로. 인덱스가 커스텀 선택(Overrides)의 키 */
  resources: Resource[];
}

/** 매칭할 CPU 아키텍처. both = x86·arm 통틀어 최저가 */
export type ArchFilter = 'x86' | 'arm' | 'both';

export interface MatchOptions {
  /** 버스트 인스턴스(t계열/B계열/E2 공유 코어)를 매칭 후보에 포함할지 */
  includeBurstable: boolean;
  /** 매칭할 아키텍처. 생략 시 both */
  arch?: ArchFilter;
}

/** 플랫폼 × 리소스 인덱스 → 사용자가 고른 SKU명. 조건 미충족·미존재 SKU는 무시하고 최저가로 self-heal */
export type Overrides = Partial<Record<Provider, Record<number, string>>>;

/**
 * 매칭 실패 이유 — "견적 불가"를 버그로 오해하지 않게 화면에 같이 보여준다.
 * arch: 버스트·아키텍처 조건을 만족하는 인스턴스가 이 리전에 아예 없음 (예: 서울 GCP ARM)
 * size: 인스턴스는 있지만 요구 스펙이 조건 내 최대치를 넘음 (vCPU·RAM 최대는 각각 따로 집계)
 */
export type NoMatchReason = { reason: 'arch' } | { reason: 'size'; maxVcpu: number; maxRamGb: number };

/** 견적 한 줄. resourceIndex = 이 줄을 만든 카드의 인덱스 (카드 하나가 여러 줄을 낼 수 있다) */
export type EstimateLine = { resourceIndex: number } & (
  | {
      kind: 'vm';
      spec: VmSpec;
      matched: VmSku | null;
      candidates: VmSku[];
      /** matched가 null일 때만 값이 있다 */
      noMatch: NoMatchReason | null;
      monthlyUsd: number | null;
    }
  | { kind: 'storage'; storageKind: StorageSku['kind']; sizeGb: number; pricePerGbMonth: number | null; monthlyUsd: number | null }
  | { kind: 'egress'; gb: number; freeGb: number | null; monthlyUsd: number | null }
);

export interface ProviderEstimate {
  provider: Provider;
  /** VM 요금 데이터 존재 여부 — false면 "데이터 준비 중" */
  available: boolean;
  lines: EstimateLine[];
  /** 모든 항목이 계산됐을 때만 총액. 불완전 견적에 총액을 보여주면 오해를 부른다 */
  totalMonthlyUsd: number | null;
}

/** 리소스 타입 하나의 정의 — 새 리소스는 이걸 구현한 모듈 + 레지스트리 등록 + 입력 카드로 추가한다 */
export interface ResourceDef<R extends Resource> {
  /** URL 토큰 접두사 (res=vm:2c4g:2,blk:100 의 vm·blk) */
  token: string;
  /** 시나리오에 하나만 허용 — 합산 기준 구간 요금(egress)은 쪼개면 무료 구간이 중복 적용된다 */
  singleton?: boolean;
  /** "+ 추가" 시 기본값 */
  create(): R;
  /** 접두사 뒤 본문 ↔ 리소스. 깨진 본문은 null */
  encode(r: R): string;
  decode(body: string): R | null;
  /** 한 플랫폼에 대한 견적 줄. pick = 이 카드에 대해 사용자가 고른 SKU (VM류만 사용) */
  estimate(r: R, ctx: { index: number; pricing: ProviderPricing; opts: MatchOptions; pick?: string }): EstimateLine[];
}

/** 월 환산 시간 — 3사 계산기 관례(365d × 24h ÷ 12) */
export const HOURS_PER_MONTH = 730;

export const round2 = (x: number) => +x.toFixed(2);

/** URL 수량 파싱 — 양의 정수만 (깨진 값은 null) */
export const parsePositiveInt = (s: string | undefined): number | null => {
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
};
