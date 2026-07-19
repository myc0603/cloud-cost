/**
 * 시나리오 ↔ URL 쿼리스트링 코덱.
 * URL 자체가 저장된 시나리오다 — 서버 저장 없이 주소 복사가 곧 공유.
 * 형식: ?r=seoul&vm=2c4g:2,4c8g:1&blk=100&obj=500&eg=1024
 *       (vm: vCPU c RAM g : 대수 / blk·obj·eg: GB, 0이면 생략)
 */

import type { ArchFilter, Overrides, Scenario, VmSpec } from './estimator';
import type { Provider } from './schema';

const PROVIDERS = new Set<string>(['aws', 'azure', 'gcp']);

export function encodeScenario(scenario: Scenario): string {
  const params = new URLSearchParams();
  params.set('r', scenario.region);
  if (scenario.vms.length > 0) {
    params.set('vm', scenario.vms.map((v) => `${v.vcpu}c${v.ramGb}g:${v.count}`).join(','));
  }
  if (scenario.blockGb > 0) params.set('blk', String(scenario.blockGb));
  if (scenario.objectGb > 0) params.set('obj', String(scenario.objectGb));
  if (scenario.egressGb > 0) params.set('eg', String(scenario.egressGb));
  return params.toString();
}

/** 파라미터가 아예 없으면 null (호출부에서 기본 시나리오 사용). 깨진 토큰은 버린다 */
export function decodeScenario(query: string | URLSearchParams): Scenario | null {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  if (!['r', 'vm', 'blk', 'obj', 'eg'].some((k) => params.get(k) !== null)) return null;

  const vms: VmSpec[] = (params.get('vm') ?? '').split(',').flatMap((token) => {
    const m = token.match(/^(\d+)c(\d+)g:(\d+)$/);
    if (!m) return [];
    const [, vcpu, ramGb, count] = m.map(Number);
    if (vcpu < 1 || ramGb < 1 || count < 1) return [];
    return [{ vcpu, ramGb, count }];
  });

  const gb = (key: string) => {
    const n = parseInt(params.get(key) ?? '0', 10);
    return Number.isNaN(n) || n < 0 ? 0 : n;
  };

  return {
    region: params.get('r') === 'us-east' ? 'us-east' : 'seoul',
    vms,
    blockGb: gb('blk'),
    objectGb: gb('obj'),
    egressGb: gb('eg'),
  };
}

/**
 * 커스텀 인스턴스 선택 ↔ pick 파라미터. 형식: pick=aws:0:t3.large,gcp:1:n2-standard-2
 * (provider:vmIndex:sku). 자동(최저가) 선택은 저장 안 함 → 비지 않은 override만 담긴다.
 */
export function encodeOverrides(overrides: Overrides): string {
  const tokens: string[] = [];
  for (const [provider, perVm] of Object.entries(overrides)) {
    if (!perVm) continue;
    for (const [idx, sku] of Object.entries(perVm)) tokens.push(`${provider}:${idx}:${sku}`);
  }
  return tokens.join(',');
}

/**
 * 매칭 옵션(아키텍처·버스트) ↔ URL. arch=arm|x86 (both는 기본이라 생략), burst=0 (기본 포함이라 끌 때만).
 * 총액을 바꾸는 시나리오 성격이라 공유 링크에 함께 저장한다.
 */
export function encodeMatchOptions(opts: { arch: ArchFilter; includeBurstable: boolean }): string {
  const params = new URLSearchParams();
  if (opts.arch !== 'both') params.set('arch', opts.arch);
  if (!opts.includeBurstable) params.set('burst', '0');
  return params.toString();
}

export function decodeMatchOptions(query: string | URLSearchParams): { arch: ArchFilter; includeBurstable: boolean } {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const arch = params.get('arch');
  return {
    arch: arch === 'x86' || arch === 'arm' ? arch : 'both',
    includeBurstable: params.get('burst') !== '0',
  };
}

/** 깨진 토큰·모르는 플랫폼은 버린다. 조건 미충족 SKU는 estimate가 최저가로 self-heal */
export function decodeOverrides(query: string | URLSearchParams): Overrides {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const raw = params.get('pick');
  if (!raw) return {};
  const out: Overrides = {};
  for (const token of raw.split(',')) {
    const [provider, idxStr, sku] = token.split(':');
    if (!PROVIDERS.has(provider) || !sku) continue;
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 0) continue;
    (out[provider as Provider] ??= {})[idx] = sku;
  }
  return out;
}
