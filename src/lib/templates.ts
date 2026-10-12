/**
 * 시나리오 템플릿 — "구성도를 넣으면 가격이 나온다"를 빈 화면 없이 바로 보여주는 출발점.
 * 규모는 예시값이다.
 * 이름은 messages의 scenario.templateName.{id}.
 */

import type { Resource } from './estimator';

export type TemplateId = 'web' | 'k8sApi' | 'static' | 'batch';

export const TEMPLATES: { id: TemplateId; resources: Resource[] }[] = [
  {
    id: 'web',
    resources: [
      { type: 'lb', count: 1, gb: 500 },
      { type: 'vm', vcpu: 2, ramGb: 4, count: 2 }, // 웹
      { type: 'db', engine: 'postgres', vcpu: 2, ramGb: 8, storageGb: 100, ha: false, count: 1 },
      { type: 'cache', memoryGb: 1, ha: false, count: 1 },
      { type: 'block', gb: 100 },
      { type: 'egress', gb: 500 },
    ],
  },
  {
    id: 'k8sApi',
    resources: [
      { type: 'k8s', clusters: 1, node: { vcpu: 4, ramGb: 16, count: 3 } },
      { type: 'db', engine: 'postgres', vcpu: 4, ramGb: 16, storageGb: 200, ha: true, count: 1 },
      { type: 'cache', memoryGb: 6, ha: true, count: 1 },
      { type: 'lb', count: 1, gb: 1024 },
      { type: 'nat', count: 1, gb: 500 },
      { type: 'block', gb: 200 },
      { type: 'egress', gb: 2048 },
    ],
  },
  {
    id: 'static',
    resources: [
      { type: 'object', gb: 500 },
      { type: 'egress', gb: 2048 },
    ],
  },
  {
    id: 'batch',
    resources: [
      { type: 'vm', vcpu: 8, ramGb: 32, count: 4 },
      { type: 'nat', count: 1, gb: 2048 },
      { type: 'block', gb: 1024 },
      { type: 'object', gb: 5120 },
    ],
  },
];
