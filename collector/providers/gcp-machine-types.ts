/**
 * GCP 머신 타입 정적 카탈로그.
 *
 * GCP는 인스턴스 통가격이 아니라 "패밀리별 vCPU 시간 단가 + RAM GB 시간 단가"로
 * 과금하며, 머신 타입의 스펙 구성(vCPU/RAM)은 가격 API에 없다.
 * 스펙은 사실상 불변이므로 여기서 정적으로 관리하고, 단가와 조합해 가격을 계산한다.
 * ARM은 T2A(Tau, Ampere Altra)·C4A(Axion) — 리전 가용성이 제한적이라 단가가 없는 리전은 자동 제외된다.
 * 스펙 출처: cloud.google.com/compute/docs/general-purpose-machines, compute-optimized-machines (2026-10-11 확인).
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

/** RAM이 vCPU에 정비례하지 않는 시리즈(C4·C4D·C3D 등)용 — 문서 표의 [vCPU, RAM GB]를 그대로 */
function listed(
  family: string,
  arch: Arch,
  kind: 'standard' | 'highmem' | 'highcpu',
  entries: [vcpu: number, ramGb: number][],
): GcpMachineType[] {
  return entries.map(([n, ramGb]) => ({
    name: `${family}-${kind}-${n}`,
    family,
    arch,
    vcpu: n,
    ramGb,
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

  ...sizes('n2', 'x86', 'standard', [2, 4, 8, 16, 32, 48, 64, 80, 96, 128], 4),
  ...sizes('n2', 'x86', 'highmem', [2, 4, 8, 16, 32, 48, 64, 80, 96], 8),
  ...listed('n2', 'x86', 'highmem', [[128, 864]]),
  ...sizes('n2', 'x86', 'highcpu', [2, 4, 8, 16, 32, 48, 64, 80, 96], 1),

  ...sizes('n2d', 'x86', 'standard', [2, 4, 8, 16, 32, 48, 64, 80, 96, 128, 224], 4),

  ...sizes('n4', 'x86', 'standard', [2, 4, 8, 16, 32, 48, 64, 80], 4),
  ...sizes('n4', 'x86', 'highmem', [2, 4, 8, 16, 32, 48, 64, 80], 8),
  ...sizes('n4', 'x86', 'highcpu', [2, 4, 8, 16, 32, 48, 64, 80], 2),

  ...sizes('n4d', 'x86', 'standard', [2, 4, 8, 16, 32, 48, 64, 80, 96], 4),
  ...sizes('n4d', 'x86', 'highmem', [2, 4, 8, 16, 32, 48, 64, 80, 96], 8),
  ...sizes('n4d', 'x86', 'highcpu', [2, 4, 8, 16, 32, 48, 64, 80, 96], 2),

  ...sizes('n1', 'x86', 'standard', [1, 2, 4, 8, 16], 3.75),

  ...sizes('c2', 'x86', 'standard', [4, 8, 16, 30, 60], 4),
  ...sizes('c2d', 'x86', 'standard', [2, 4, 8, 16, 32, 56, 112], 4),
  ...sizes('c3', 'x86', 'standard', [4, 8, 22, 44, 88, 176], 4),

  ...listed('c3d', 'x86', 'standard', [[4, 16], [8, 32], [16, 64], [30, 120], [60, 240], [90, 360], [180, 720], [360, 1440]]),
  ...listed('c3d', 'x86', 'highmem', [[4, 32], [8, 64], [16, 128], [30, 240], [60, 480], [90, 720], [180, 1440], [360, 2880]]),
  ...listed('c3d', 'x86', 'highcpu', [[4, 8], [8, 16], [16, 32], [30, 59], [60, 118], [90, 177], [180, 354], [360, 708]]),

  ...listed('c4', 'x86', 'standard', [[2, 7], [4, 15], [8, 30], [16, 60], [24, 90], [32, 120], [48, 180], [96, 360], [144, 540], [192, 720], [288, 1080]]),
  ...listed('c4', 'x86', 'highmem', [[2, 15], [4, 31], [8, 62], [16, 124], [24, 186], [32, 248], [48, 372], [96, 744], [144, 1116], [192, 1488], [288, 2232]]),
  ...listed('c4', 'x86', 'highcpu', [[2, 4], [4, 8], [8, 16], [16, 32], [24, 48], [32, 64], [48, 96], [96, 192], [144, 288], [192, 384], [288, 576]]),

  ...listed('c4d', 'x86', 'standard', [[2, 7], [4, 15], [8, 31], [16, 62], [32, 124], [48, 186], [64, 248], [96, 372], [192, 744], [384, 1488]]),
  ...listed('c4d', 'x86', 'highmem', [[2, 15], [4, 31], [8, 63], [16, 126], [32, 252], [48, 378], [64, 504], [96, 756], [192, 1512], [384, 3024]]),
  ...listed('c4d', 'x86', 'highcpu', [[2, 3], [4, 7], [8, 15], [16, 30], [32, 60], [48, 90], [64, 120], [96, 180], [192, 360], [384, 720]]),

  ...sizes('t2d', 'x86', 'standard', [1, 2, 4, 8, 16, 32, 48, 60], 4),

  // ARM (Ampere Altra) — 리전 제한적, 단가 없으면 수집 단계에서 자동 제외
  ...sizes('t2a', 'arm', 'standard', [1, 2, 4, 8, 16, 32, 48], 4),
  ...sizes('c4a', 'arm', 'standard', [1, 2, 4, 8, 16, 32, 48, 64, 72], 4),
  ...sizes('c4a', 'arm', 'highmem', [1, 2, 4, 8, 16, 32, 48, 64, 72], 8),
  ...sizes('c4a', 'arm', 'highcpu', [1, 2, 4, 8, 16, 32, 48, 64, 72], 2),
];
