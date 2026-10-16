/**
 * 견적 엔진 공통 타입 — 리소스 모듈(vm·storage·egress …)과 진입점(index.ts)이 함께 쓴다.
 * 리소스 모듈은 이 파일만 import한다 (index.ts를 import하면 순환 참조).
 */

import type { Arch, CommitPrices, DbEngine, Provider, ProviderPricing, Region, StorageSku, Term, VmSku } from '../schema';

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
  | { type: 'egress'; gb: number } // 월 아웃바운드 전송량
  /** 관리형 K8s — 클러스터 수 + 클러스터당 워커 노드(VM 매칭 재사용) */
  | { type: 'k8s'; clusters: number; node: VmSpec }
  /** L7 로드밸런서 — 대수 + 월 처리 트래픽(전체 합계) */
  | { type: 'lb'; count: number; gb: number }
  /** NAT 게이트웨이 — 개수 + 월 처리 데이터(전체 합계) */
  | { type: 'nat'; count: number; gb: number }
  /** 관리형 DB — 엔진 · 인스턴스 스펙 · 스토리지(인스턴스당) · 이중화 · 인스턴스 수 */
  | { type: 'db'; engine: DbEngine; vcpu: number; ramGb: number; storageGb: number; ha: boolean; count: number }
  /** Redis 호환 관리형 캐시 — 메모리(GB) · 이중화 · 캐시 개수 */
  | { type: 'cache'; memoryGb: number; ha: boolean; count: number }
  /** 서버리스 컨테이너 — 컨테이너당 vCPU(0.25~16) · 메모리(GB) · 상시 실행 컨테이너 수 */
  | ({ type: 'container' } & VmSpec);

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
  /**
   * 약정 기간 — 생략 시 정가(온디맨드). VM·K8s 노드·DB·캐시 컴퓨트에만 적용되고,
   * 이 기준 가격으로 최저가를 다시 찾는다. 약정가가 없는 후보는 정가로 남는다(committed: false).
   */
  term?: Term;
}

/** 약정 기간의 가격 — 약정가가 없으면 정가. committed = 약정가 적용 여부 */
export function priceAt<T>(onDemand: T, commit: CommitPrices<T> | undefined, term: Term | undefined): { price: T; committed: boolean } {
  const c = term ? commit?.[term] : undefined;
  return c === undefined ? { price: onDemand, committed: false } : { price: c, committed: true };
}

/** 플랫폼 × 리소스 인덱스 → 사용자가 고른 SKU명. 조건 미충족·미존재 SKU는 무시하고 최저가로 self-heal */
export type Overrides = Partial<Record<Provider, Record<number, string>>>;

/**
 * 매칭 실패 이유 — "견적 불가"를 버그로 오해하지 않게 화면에 같이 보여준다.
 * arch: 버스트·아키텍처 조건을 만족하는 인스턴스가 이 리전에 아예 없음 (예: 서울 GCP ARM)
 * size: 인스턴스는 있지만 요구 스펙이 조건 내 최대치를 넘음 (vCPU·RAM 최대는 각각 따로 집계)
 * memory: 메모리만 보는 리소스(캐시)에서 요구 메모리가 최대치를 넘음
 */
export type NoMatchReason =
  | { reason: 'arch' }
  | { reason: 'size'; maxVcpu: number; maxRamGb: number }
  | { reason: 'memory'; maxGb: number };

/** 견적 한 줄. resourceIndex = 이 줄을 만든 카드의 인덱스 (카드 하나가 여러 줄을 낼 수 있다) */
export type EstimateLine = { resourceIndex: number } & (
  | {
      kind: 'vm';
      /** vm = VM 카드, k8s-node = K8s 카드의 워커 노드 (표시 라벨만 다르고 매칭은 동일) */
      role: 'vm' | 'k8s-node';
      spec: VmSpec;
      matched: VmMatch | null;
      candidates: VmMatch[];
      /** matched가 null일 때만 값이 있다 */
      noMatch: NoMatchReason | null;
      monthlyUsd: number | null;
    }
  | { kind: 'storage'; storageKind: StorageSku['kind']; sizeGb: number; pricePerGbMonth: number | null; monthlyUsd: number | null }
  | { kind: 'egress'; gb: number; freeGb: number | null; monthlyUsd: number | null }
  | { kind: 'k8s-control'; clusters: number; clusterPerHour: number | null; monthlyUsd: number | null }
  | { kind: 'lb'; count: number; gb: number; monthlyUsd: number | null }
  /** billedVms: 시간당 요금이 VM 수 비례인 플랫폼(GCP)에서 과금 기준이 된 VM 수. 그 외 null */
  | { kind: 'nat'; count: number; gb: number; billedVms: number | null; monthlyUsd: number | null }
  /**
   * 관리형 DB 컴퓨트. matched·candidates의 perHour는 이중화 여부가 반영된 값.
   * matched·noMatch 둘 다 null = 해당 엔진 요금 데이터 없음
   */
  | {
      kind: 'db';
      engine: DbEngine;
      ha: boolean;
      spec: VmSpec;
      matched: DbMatch | null;
      candidates: DbMatch[];
      noMatch: NoMatchReason | null;
      monthlyUsd: number | null;
    }
  | { kind: 'db-storage'; storageGb: number; count: number; ha: boolean; perGbMonth: number | null; monthlyUsd: number | null }
  /** 관리형 캐시. engine = 표시용 엔진명(Valkey·Redis), 요금 데이터 없으면 null */
  | {
      kind: 'cache';
      engine: string | null;
      memoryGb: number;
      ha: boolean;
      count: number;
      matched: CacheMatch | null;
      candidates: CacheMatch[];
      noMatch: NoMatchReason | null;
      monthlyUsd: number | null;
    }
  /** 서버리스 컨테이너. matched·noMatch 둘 다 null = 요금 데이터 없음 */
  | { kind: 'container'; spec: VmSpec; matched: ContainerMatch | null; noMatch: NoMatchReason | null; monthlyUsd: number | null }
);

/** 컨테이너 매칭 결과 — 플랫폼 허용 조합으로 올린 사이즈, perHour = 컨테이너 1개 시간당(요금 기준 반영) */
export interface ContainerMatch {
  vcpu: number;
  ramGb: number;
  arch: Arch;
  perHour: number;
  committed: boolean;
}

/** VM 매칭 결과 — perHour = 선택한 요금 기준(정가·약정)의 시간당, pricePerHour는 정가 그대로 */
export interface VmMatch extends VmSku {
  perHour: number;
  /** 약정 기간이 지정됐는데 약정가가 없어 정가로 계산했으면 false (정가 기준이면 항상 false) */
  committed: boolean;
}

/** 캐시 매칭 결과 — perHour는 이중화 여부·요금 기준이 반영된 값 */
export interface CacheMatch {
  sku: string;
  memoryGb: number;
  perHour: number;
  committed: boolean;
}

/** DB 매칭 결과 한 건 — AWS·Azure는 실제 SKU, GCP는 계산한 커스텀 사이즈(db-custom-{vCPU}-{RAM MB}). perHour는 이중화·요금 기준 반영 */
export interface DbMatch {
  sku: string;
  vcpu: number;
  ramGb: number;
  perHour: number;
  committed: boolean;
}

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
  /**
   * 한 플랫폼에 대한 견적 줄. pick = 이 카드에 대해 사용자가 고른 SKU (VM류만 사용).
   * scenario = 시나리오 전체 — 다른 카드를 참조해야 하는 리소스용 (NAT: GCP 과금 VM 수)
   */
  estimate(
    r: R,
    ctx: { index: number; pricing: ProviderPricing; opts: MatchOptions; pick?: string; scenario: Scenario },
  ): EstimateLine[];
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
