/**
 * 시나리오 ↔ URL 쿼리스트링 코덱.
 * URL 자체가 저장된 시나리오다 — 서버 저장 없이 주소 복사가 곧 공유.
 * 형식: ?r=seoul&vm=2c4g:2,4c8g:1&blk=100&obj=500&eg=1024
 *       (vm: vCPU c RAM g : 대수 / blk·obj·eg: GB, 0이면 생략)
 */

import type { Scenario, VmSpec } from './estimator';

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
