/**
 * 수집기 진입점 — 플랫폼별 수집을 오케스트레이션한다.
 * 실행: tsx collector/main.ts [all|gcp|aws]   (기본 all)
 *   - gcp: GCP_API_KEY 환경변수 또는 .env 필요
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Region, VmSku } from '../src/lib/schema';
import { collectAwsVm } from './providers/aws';
import { GCP_REGION, buildVmSkus, fetchComputeSkus, parseUnitPrices } from './providers/gcp';

// 최소 .env 로더 (의존성 없이)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const REGIONS: Region[] = ['seoul', 'us-east'];

function writeVmSnapshot(provider: string, region: Region, vms: VmSku[], samples: string[]) {
  const dir = `data/${provider}/${region}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/vm.json`, JSON.stringify(vms, null, 2) + '\n');
  console.log(`VmSku ${vms.length}건 생성 → ${dir}/vm.json`);
  console.log('검산용 샘플:');
  for (const name of samples) {
    const vm = vms.find((v) => v.sku === name);
    if (vm) console.log(`  ${name.padEnd(16)} $${vm.pricePerHour}/h (${vm.vcpu}vCPU/${vm.ramGb}GB)`);
  }
}

async function collectGcp() {
  const apiKey = process.env.GCP_API_KEY;
  if (!apiKey) {
    console.error('GCP_API_KEY가 없습니다. .env에 GCP_API_KEY=<키>를 설정하세요.');
    process.exit(1);
  }
  console.log('[gcp] Compute Engine SKU 수집 중... (수만 건, 수십 초 소요)');
  const raw = await fetchComputeSkus(apiKey);
  console.log(`[gcp] 원본 SKU ${raw.length.toLocaleString()}건 수신`);

  for (const region of REGIONS) {
    const { unitPrices, unmatched } = parseUnitPrices(raw, GCP_REGION[region]);
    const vms = buildVmSkus(unitPrices, region);
    console.log(`\n━━━ gcp / ${region} ━━━`);
    writeVmSnapshot('gcp', region, vms, ['e2-micro', 'e2-standard-2', 'n2-standard-4']);
    if (unmatched.length > 0) console.log(`매핑 안 된 VM 단가 라벨 ${unmatched.length}종 (미지원 패밀리·Sole Tenancy·Custom 등)`);
  }
}

async function collectAws() {
  for (const region of REGIONS) {
    console.log(`\n━━━ aws / ${region} ━━━`);
    console.log('[aws] 오퍼 CSV 스트리밍 파싱 중... (수백 MB, 수십 초 소요)');
    const vms = await collectAwsVm(region);
    writeVmSnapshot('aws', region, vms, ['t3.medium', 'm5.large', 'c5.xlarge']);
  }
}

const target = process.argv[2] ?? 'all';
if (target === 'gcp' || target === 'all') await collectGcp();
if (target === 'aws' || target === 'all') await collectAws();
if (!['gcp', 'aws', 'all'].includes(target)) {
  console.error(`알 수 없는 대상: ${target} (all | gcp | aws)`);
  process.exit(1);
}
