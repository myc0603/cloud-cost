/**
 * GCP 머신 타입 정적 카탈로그.
 *
 * GCP는 인스턴스 통가격이 아니라 "패밀리별 vCPU 시간 단가 + RAM GB 시간 단가"로
 * 과금하며, 머신 타입의 스펙 구성(vCPU/RAM)은 가격 API에 없다.
 * 스펙은 사실상 불변이므로 여기서 정적으로 관리하고, 단가와 조합해 가격을 계산한다.
 * ARM은 T2A(Tau, Ampere Altra) — 리전 가용성이 제한적이라 단가가 없는 리전은 자동 제외된다.
 */

import type { Arch } from '../../src/lib/schema';

export interface GcpMachineType {
  name: string; // e2-standard-2
  family: string; // e2
  arch: Arch;
  vcpu: number; // 사용자에게 보이는 vCPU 수
  ramGb: number;
  /** 과금 기준 코어 수 — E2 공유 코어 타입은 vCPU 2개가 보여도 분수 코어로 과금된다 */
  billedCores: number;
  burstable: boolean;
}

function sizes(
  family: string,
  arch: Arch,
  kind: 'standard' | 'highmem' | 'highcpu',
  counts: number[],
  ramPerVcpu: number,
): GcpMachineType[] {
  return counts.map((n) => ({
    name: `${family}-${kind}-${n}`,
    family,
    arch,
    vcpu: n,
    ramGb: n * ramPerVcpu,
    billedCores: n,
    burstable: false,
  }));
}

export const GCP_MACHINE_TYPES: GcpMachineType[] = [
  // E2 공유 코어 — burstable
  { name: 'e2-micro', family: 'e2', arch: 'x86', vcpu: 2, ramGb: 1, billedCores: 0.25, burstable: true },
  { name: 'e2-small', family: 'e2', arch: 'x86', vcpu: 2, ramGb: 2, billedCores: 0.5, burstable: true },
  { name: 'e2-medium', family: 'e2', arch: 'x86', vcpu: 2, ramGb: 4, billedCores: 1, burstable: true },

  ...sizes('e2', 'x86', 'standard', [2, 4, 8, 16, 32], 4),
  ...sizes('e2', 'x86', 'highmem', [2, 4, 8, 16], 8),
  ...sizes('e2', 'x86', 'highcpu', [2, 4, 8, 16, 32], 1),

  ...sizes('n2', 'x86', 'standard', [2, 4, 8, 16, 32], 4),
  ...sizes('n2', 'x86', 'highmem', [2, 4, 8, 16], 8),
  ...sizes('n2', 'x86', 'highcpu', [2, 4, 8, 16, 32], 1),

  ...sizes('n2d', 'x86', 'standard', [2, 4, 8, 16, 32], 4),

  ...sizes('n1', 'x86', 'standard', [1, 2, 4, 8, 16], 3.75),

  ...sizes('c2', 'x86', 'standard', [4, 8, 16, 30, 60], 4),
  ...sizes('c2d', 'x86', 'standard', [2, 4, 8, 16, 32], 4),
  ...sizes('c3', 'x86', 'standard', [4, 8, 22, 44], 4),

  ...sizes('t2d', 'x86', 'standard', [1, 2, 4, 8, 16, 32], 4),

  // ARM (Ampere Altra) — 리전 제한적, 단가 없으면 수집 단계에서 자동 제외
  ...sizes('t2a', 'arm', 'standard', [1, 2, 4, 8, 16, 32, 48], 4),
];
