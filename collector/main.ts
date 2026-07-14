/**
 * 수집기 진입점 — 프로토타입 단계: GCP VM만 수집한다.
 * 실행: npm run collect:gcp  (GCP_API_KEY 환경변수 또는 .env 필요)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Region } from '../src/lib/schema';
import { GCP_REGION, buildVmSkus, fetchComputeSkus, parseUnitPrices } from './providers/gcp';

// 최소 .env 로더 (의존성 없이)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const apiKey = process.env.GCP_API_KEY;
if (!apiKey) {
  console.error(
    'GCP_API_KEY가 없습니다.\n' +
      '  1) GCP 콘솔에서 Cloud Billing API 활성화 후 API 키 생성\n' +
      '  2) 프로젝트 루트에 .env 파일 생성: GCP_API_KEY=<키>\n' +
      '  (.env는 gitignore에 포함되어 커밋되지 않습니다)',
  );
  process.exit(1);
}

console.log('GCP Compute Engine SKU 수집 중... (수만 건, 수십 초 소요)');
const raw = await fetchComputeSkus(apiKey);
console.log(`원본 SKU ${raw.length.toLocaleString()}건 수신\n`);

const regions: Region[] = ['seoul', 'us-east'];
for (const region of regions) {
  const gcpRegion = GCP_REGION[region];
  const { unitPrices, unmatched } = parseUnitPrices(raw, gcpRegion);
  const vms = buildVmSkus(unitPrices, region);

  const dir = `data/gcp/${region}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/vm.json`, JSON.stringify(vms, null, 2) + '\n');

  console.log(`━━━ ${region} (${gcpRegion}) ━━━`);
  console.log(`패밀리별 단가 (USD/h):`);
  for (const [family, p] of Object.entries(unitPrices)) {
    console.log(`  ${family.padEnd(4)} core=${p.corePerHour ?? '─'}  ramGB=${p.ramGbPerHour ?? '─'}`);
  }
  console.log(`VmSku ${vms.length}건 생성 → ${dir}/vm.json`);

  const samples = ['e2-micro', 'e2-standard-2', 'n2-standard-4'];
  console.log(`검산용 샘플 (GCP 요금 페이지와 대조할 것):`);
  for (const name of samples) {
    const vm = vms.find((v) => v.sku === name);
    if (vm) console.log(`  ${name.padEnd(16)} $${vm.pricePerHour}/h (${vm.vcpu}vCPU/${vm.ramGb}GB)`);
  }

  if (unmatched.length > 0) {
    console.log(`매핑 안 된 VM 단가 라벨 ${unmatched.length}종 (커버리지 확인용):`);
    for (const label of unmatched) console.log(`  - ${label}`);
  }
  console.log();
}
