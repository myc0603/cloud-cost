/**
 * 시나리오 ↔ URL 쿼리스트링 코덱.
 * URL 자체가 저장된 시나리오다 — 서버 저장 없이 주소 복사가 곧 공유.
 * 형식: ?r=seoul&vm=2c4g:2,4c8g:1  (vCPU c RAM g : 대수)
 */

import type { Scenario, VmSpec } from './estimator';

export function encodeScenario(scenario: Scenario): string {
  const params = new URLSearchParams();
  params.set('r', scenario.region);
  if (scenario.vms.length > 0) {
    params.set('vm', scenario.vms.map((v) => `${v.vcpu}c${v.ramGb}g:${v.count}`).join(','));
  }
  return params.toString();
}

/** 파라미터가 아예 없으면 null (호출부에서 기본 시나리오 사용). 깨진 토큰은 버린다 */
export function decodeScenario(query: string | URLSearchParams): Scenario | null {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const region = params.get('r');
  const vmRaw = params.get('vm');
  if (region === null && vmRaw === null) return null;

  const vms: VmSpec[] = (vmRaw ?? '').split(',').flatMap((token) => {
    const m = token.match(/^(\d+)c(\d+)g:(\d+)$/);
    if (!m) return [];
    const [, vcpu, ramGb, count] = m.map(Number);
    if (vcpu < 1 || ramGb < 1 || count < 1) return [];
    return [{ vcpu, ramGb, count }];
  });

  return { region: region === 'us-east' ? 'us-east' : 'seoul', vms };
}
