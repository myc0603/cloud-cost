/**
 * Azure VM 사이즈 정적 카탈로그.
 *
 * Retail Prices API는 가격만 주고 vCPU/RAM 스펙을 주지 않는다 (GCP와 같은 사정).
 * x86 주력 7개 + ARM(Ampere Altra) 2개 시리즈:
 *   B·Bsv2(버스트) / Dsv5·Dsv6(범용) / Esv5·Esv6(메모리) / Fsv2(컴퓨트) / Dpsv6(ARM 범용) / Epsv6(ARM 메모리)
 * 스펙 출처: learn.microsoft.com/azure/virtual-machines/sizes 시리즈별 문서 (2026-10-11 확인).
 * 격리(isolated) 사이즈(E104is_v5·E192is_v6)는 전용 호스트 성격이라 제외.
 */

import type { Arch } from '../../src/lib/schema';

export interface AzureVmSize {
  armSkuName: string; // Standard_B2s — 가격 조인 키
  vcpu: number;
  ramGb: number;
  arch: Arch;
  generation: string; // 시리즈 키
  burstable: boolean;
}

function series(
  generation: string,
  arch: Arch,
  burstable: boolean,
  entries: [armSkuName: string, vcpu: number, ramGb: number][],
): AzureVmSize[] {
  return entries.map(([armSkuName, vcpu, ramGb]) => ({ armSkuName, vcpu, ramGb, arch, generation, burstable }));
}

export const AZURE_VM_SIZES: AzureVmSize[] = [
  ...series('b', 'x86', true, [
    ['Standard_B1s', 1, 1],
    ['Standard_B1ms', 1, 2],
    ['Standard_B2s', 2, 4],
    ['Standard_B2ms', 2, 8],
    ['Standard_B4ms', 4, 16],
    ['Standard_B8ms', 8, 32],
  ]),
  // Bsv2 — B 시리즈 후속(버스트). ts/ls/s = 같은 vCPU에 RAM 1:0.5 / 1:2 / 1:4
  ...series('bsv2', 'x86', true, [
    ['Standard_B2ts_v2', 2, 1],
    ['Standard_B2ls_v2', 2, 4],
    ['Standard_B2s_v2', 2, 8],
    ['Standard_B4ls_v2', 4, 8],
    ['Standard_B4s_v2', 4, 16],
    ['Standard_B8ls_v2', 8, 16],
    ['Standard_B8s_v2', 8, 32],
    ['Standard_B16ls_v2', 16, 32],
    ['Standard_B16s_v2', 16, 64],
    ['Standard_B32ls_v2', 32, 64],
    ['Standard_B32s_v2', 32, 128],
  ]),
  ...series('dsv5', 'x86', false, [
    ['Standard_D2s_v5', 2, 8],
    ['Standard_D4s_v5', 4, 16],
    ['Standard_D8s_v5', 8, 32],
    ['Standard_D16s_v5', 16, 64],
    ['Standard_D32s_v5', 32, 128],
    ['Standard_D48s_v5', 48, 192],
    ['Standard_D64s_v5', 64, 256],
    ['Standard_D96s_v5', 96, 384],
  ]),
  ...series('dsv6', 'x86', false, [
    ['Standard_D2s_v6', 2, 8],
    ['Standard_D4s_v6', 4, 16],
    ['Standard_D8s_v6', 8, 32],
    ['Standard_D16s_v6', 16, 64],
    ['Standard_D32s_v6', 32, 128],
    ['Standard_D48s_v6', 48, 192],
    ['Standard_D64s_v6', 64, 256],
    ['Standard_D96s_v6', 96, 384],
    ['Standard_D128s_v6', 128, 512],
    ['Standard_D192s_v6', 192, 768],
  ]),
  ...series('esv5', 'x86', false, [
    ['Standard_E2s_v5', 2, 16],
    ['Standard_E4s_v5', 4, 32],
    ['Standard_E8s_v5', 8, 64],
    ['Standard_E16s_v5', 16, 128],
    ['Standard_E20s_v5', 20, 160],
    ['Standard_E32s_v5', 32, 256],
    ['Standard_E48s_v5', 48, 384],
    ['Standard_E64s_v5', 64, 512],
    ['Standard_E96s_v5', 96, 672],
  ]),
  ...series('esv6', 'x86', false, [
    ['Standard_E2s_v6', 2, 16],
    ['Standard_E4s_v6', 4, 32],
    ['Standard_E8s_v6', 8, 64],
    ['Standard_E16s_v6', 16, 128],
    ['Standard_E20s_v6', 20, 160],
    ['Standard_E32s_v6', 32, 256],
    ['Standard_E48s_v6', 48, 384],
    ['Standard_E64s_v6', 64, 512],
    ['Standard_E96s_v6', 96, 768],
    ['Standard_E128s_v6', 128, 1024],
  ]),
  ...series('fsv2', 'x86', false, [
    ['Standard_F2s_v2', 2, 4],
    ['Standard_F4s_v2', 4, 8],
    ['Standard_F8s_v2', 8, 16],
    ['Standard_F16s_v2', 16, 32],
    ['Standard_F32s_v2', 32, 64],
    ['Standard_F48s_v2', 48, 96],
    ['Standard_F64s_v2', 64, 128],
    ['Standard_F72s_v2', 72, 144],
  ]),
  // ARM (Ampere Altra) — Dpsv6(범용) / Epsv6(메모리). 서울·버지니아 공통 존재
  ...series('dpsv6', 'arm', false, [
    ['Standard_D2ps_v6', 2, 8],
    ['Standard_D4ps_v6', 4, 16],
    ['Standard_D8ps_v6', 8, 32],
    ['Standard_D16ps_v6', 16, 64],
    ['Standard_D32ps_v6', 32, 128],
    ['Standard_D48ps_v6', 48, 192],
    ['Standard_D64ps_v6', 64, 256],
    ['Standard_D96ps_v6', 96, 384],
  ]),
  ...series('epsv6', 'arm', false, [
    ['Standard_E2ps_v6', 2, 16],
    ['Standard_E4ps_v6', 4, 32],
    ['Standard_E8ps_v6', 8, 64],
    ['Standard_E16ps_v6', 16, 128],
    ['Standard_E32ps_v6', 32, 256],
    ['Standard_E48ps_v6', 48, 384],
    ['Standard_E64ps_v6', 64, 512],
    ['Standard_E96ps_v6', 96, 672],
  ]),
];
