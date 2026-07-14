/**
 * 수집기 진입점 — 플랫폼별 수집을 오케스트레이션한다.
 * 실행: tsx collector/main.ts [all|gcp|aws|azure]   (기본 all)
 *   - gcp: GCP_API_KEY 환경변수 또는 .env 필요
 * 산출: data/{provider}/{region}/vm.json · storage.json · egress.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { EgressTier, Region, StorageSku, VmSku } from '../src/lib/schema';
import { collectAws } from './providers/aws';
import { collectAzureEgress, collectAzureStorage, collectAzureVm } from './providers/azure';
import {
  GCP_REGION,
  buildVmSkus,
  fetchComputeSkus,
  fetchGcsSkus,
  parseGcpEgress,
  parseGcpStorage,
  parseUnitPrices,
} from './providers/gcp';

// 최소 .env 로더 (의존성 없이)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const REGIONS: Region[] = ['seoul', 'us-east'];

interface Snapshot {
  vms: VmSku[];
  storage: StorageSku[];
  egress: EgressTier | null;
}

function writeSnapshot(provider: string, region: Region, snap: Snapshot, vmSamples: string[]) {
  const dir = `data/${provider}/${region}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/vm.json`, JSON.stringify(snap.vms, null, 2) + '\n');
  writeFileSync(`${dir}/storage.json`, JSON.stringify(snap.storage, null, 2) + '\n');
  writeFileSync(`${dir}/egress.json`, JSON.stringify(snap.egress, null, 2) + '\n');

  console.log(`VmSku ${snap.vms.length}건 · 스토리지 ${snap.storage.length}종 · egress ${snap.egress ? `구간 ${snap.egress.tiers.length}개(무료 ${snap.egress.freeGb}GB)` : '없음'} → ${dir}/`);
  for (const name of vmSamples) {
    const vm = snap.vms.find((v) => v.sku === name);
    if (vm) console.log(`  ${name.padEnd(16)} $${vm.pricePerHour}/h (${vm.vcpu}vCPU/${vm.ramGb}GB)`);
  }
  for (const s of snap.storage) console.log(`  ${s.kind.padEnd(16)} $${s.pricePerGbMonth}/GB·월`);
}

async function collectGcp() {
  const apiKey = process.env.GCP_API_KEY;
  if (!apiKey) {
    console.error('GCP_API_KEY가 없습니다. .env에 GCP_API_KEY=<키>를 설정하세요.');
    process.exit(1);
  }
  console.log('[gcp] Compute Engine + Cloud Storage SKU 수집 중... (수만 건, 수십 초 소요)');
  const [compute, gcs] = await Promise.all([fetchComputeSkus(apiKey), fetchGcsSkus(apiKey)]);
  console.log(`[gcp] 원본 SKU ${(compute.length + gcs.length).toLocaleString()}건 수신`);

  for (const region of REGIONS) {
    const gcpRegion = GCP_REGION[region];
    const { unitPrices, unmatched } = parseUnitPrices(compute, gcpRegion);
    console.log(`\n━━━ gcp / ${region} ━━━`);
    writeSnapshot('gcp', region, {
      vms: buildVmSkus(unitPrices, region),
      storage: parseGcpStorage(compute, gcs, gcpRegion, region),
      egress: parseGcpEgress(compute, gcpRegion, region),
    }, ['e2-micro', 'e2-standard-2', 'n2-standard-4']);
    if (unmatched.length > 0) console.log(`매핑 안 된 VM 단가 라벨 ${unmatched.length}종 (미지원 패밀리·Sole Tenancy·Custom 등)`);
  }
}

async function collectAwsAll() {
  for (const region of REGIONS) {
    console.log(`\n━━━ aws / ${region} ━━━`);
    console.log('[aws] EC2 + S3 오퍼 CSV 스트리밍 파싱 중... (수백 MB, 수십 초 소요)');
    const snap = await collectAws(region);
    writeSnapshot('aws', region, snap, ['t3.medium', 'm5.large', 'c5.xlarge']);
  }
}

async function collectAzureAll() {
  for (const region of REGIONS) {
    console.log(`\n━━━ azure / ${region} ━━━`);
    console.log('[azure] Retail Prices API 수집 중...');
    const [vms, storage, egress] = await Promise.all([
      collectAzureVm(region),
      collectAzureStorage(region),
      collectAzureEgress(region),
    ]);
    writeSnapshot('azure', region, { vms, storage, egress }, ['Standard_B2s', 'Standard_D2s_v5', 'Standard_F4s_v2']);
  }
}

const target = process.argv[2] ?? 'all';
if (!['gcp', 'aws', 'azure', 'all'].includes(target)) {
  console.error(`알 수 없는 대상: ${target} (all | gcp | aws | azure)`);
  process.exit(1);
}
if (target === 'gcp' || target === 'all') await collectGcp();
if (target === 'aws' || target === 'all') await collectAwsAll();
if (target === 'azure' || target === 'all') await collectAzureAll();
