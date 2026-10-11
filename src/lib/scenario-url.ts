/**
 * 시나리오 ↔ URL 쿼리스트링 코덱.
 * URL 자체가 저장된 시나리오다 — 서버 저장 없이 주소 복사가 곧 공유.
 * 형식: ?r=seoul&res=vm:2c4g:2,vm:4c8g:1,blk:100,obj:500,eg:1024
 *       (res: 카드 순서대로 "토큰:본문", 본문 형식은 리소스 모듈이 정한다)
 * v0.3 이전 형식(vm=·blk=·obj=·eg=)은 지원하지 않는다 — 열면 기본 시나리오.
 */

import { RESOURCES, resourceDef, type ArchFilter, type Overrides, type Resource, type Scenario } from './estimator';
import type { Provider } from './schema';

const PROVIDERS = new Set<string>(['aws', 'azure', 'gcp']);

const DEF_BY_TOKEN = new Map(Object.values(RESOURCES).map((d) => [d.token, d]));

export function encodeScenario(scenario: Scenario): string {
  const params = new URLSearchParams();
  params.set('r', scenario.region);
  if (scenario.resources.length > 0) {
    params.set('res', scenario.resources.map((r) => {
      const def = resourceDef(r);
      return `${def.token}:${def.encode(r)}`;
    }).join(','));
  }
  return params.toString();
}

/** 파라미터가 아예 없으면 null (호출부에서 기본 시나리오 사용). 깨진 토큰·중복 singleton은 버린다 */
export function decodeScenario(query: string | URLSearchParams): Scenario | null {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  if (params.get('r') === null && params.get('res') === null) return null;

  const resources: Resource[] = [];
  for (const token of (params.get('res') ?? '').split(',')) {
    const i = token.indexOf(':');
    const def = i > 0 ? DEF_BY_TOKEN.get(token.slice(0, i)) : undefined;
    const r = def?.decode(token.slice(i + 1));
    if (!def || !r) continue;
    if (def.singleton && resources.some((x) => x.type === r.type)) continue;
    resources.push(r);
  }

  return {
    region: params.get('r') === 'us-east' ? 'us-east' : 'seoul',
    resources,
  };
}

/**
 * 커스텀 인스턴스 선택 ↔ pick 파라미터. 형식: pick=aws:0:t3.large,gcp:1:n2-standard-2
 * (provider:리소스 인덱스:sku). 자동(최저가) 선택은 저장 안 함 → 비지 않은 override만 담긴다.
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
