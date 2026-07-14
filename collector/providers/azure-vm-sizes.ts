/**
 * Azure VM 사이즈 정적 카탈로그.
 *
 * Retail Prices API는 가격만 주고 vCPU/RAM 스펙을 주지 않는다 (GCP와 같은 사정).
 * v1은 주력 4개 시리즈만: B(버스트) / Dsv5(범용) / Esv5(메모리) / Fsv2(컴퓨트).
 */

export interface AzureVmSize {
  armSkuName: string; // Standard_B2s — 가격 조인 키
  vcpu: number;
  ramGb: number;
  generation: string; // 시리즈 키
  burstable: boolean;
}

function series(
  generation: string,
  burstable: boolean,
  entries: [armSkuName: string, vcpu: number, ramGb: number][],
): AzureVmSize[] {
  return entries.map(([armSkuName, vcpu, ramGb]) => ({ armSkuName, vcpu, ramGb, generation, burstable }));
}

export const AZURE_VM_SIZES: AzureVmSize[] = [
  ...series('b', true, [
    ['Standard_B1s', 1, 1],
    ['Standard_B1ms', 1, 2],
    ['Standard_B2s', 2, 4],
    ['Standard_B2ms', 2, 8],
    ['Standard_B4ms', 4, 16],
    ['Standard_B8ms', 8, 32],
  ]),
  ...series('dsv5', false, [
    ['Standard_D2s_v5', 2, 8],
    ['Standard_D4s_v5', 4, 16],
    ['Standard_D8s_v5', 8, 32],
    ['Standard_D16s_v5', 16, 64],
    ['Standard_D32s_v5', 32, 128],
  ]),
  ...series('esv5', false, [
    ['Standard_E2s_v5', 2, 16],
    ['Standard_E4s_v5', 4, 32],
    ['Standard_E8s_v5', 8, 64],
    ['Standard_E16s_v5', 16, 128],
  ]),
  ...series('fsv2', false, [
    ['Standard_F2s_v2', 2, 4],
    ['Standard_F4s_v2', 4, 8],
    ['Standard_F8s_v2', 8, 16],
    ['Standard_F16s_v2', 16, 32],
    ['Standard_F32s_v2', 32, 64],
  ]),
];
