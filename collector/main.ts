/**
 * 수집기 진입점 — 플랫폼별 수집을 오케스트레이션한다.
 * 실행: tsx collector/main.ts [all|gcp|aws|azure] [--force]
 *   - gcp: GCP_API_KEY 환경변수 또는 .env 필요
 *   - --force: 검증 실패를 무시하고 기록 (실제 대규모 가격 개편일 때만)
 * 산출: data/{provider}/{region}/vm.json · storage.json · egress.json + data/meta.json
 *
 * 흐름: 전부 수집 → 기존 스냅샷과 검증 → 하나라도 이상하면 아무것도 쓰지 않고
 * 실패 종료(exit 1) → CI가 실패하면 커밋이 없고 GitHub이 알림을 보낸다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Meta, Region } from '../src/lib/schema';
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
import { validateSnapshot, type Snapshot } from './validate';

// 최소 .env 로더 (의존성 없이)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const REGIONS: Region[] = ['seoul', 'us-east'];

interface Job {
  provider: string;
  region: Region;
  snap: Snapshot;
  vmSamples: string[];
}

function readOldSnapshot(provider: string, region: Region): Snapshot | null {
  const dir = `data/${provider}/${region}`;
  if (!existsSync(`${dir}/vm.json`)) return null;
  const read = <T>(file: string, fallback: T): T =>
    existsSync(`${dir}/${file}`) ? JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) : fallback;
  return { vms: read('vm.json', []), storage: read('storage.json', []), egress: read('egress.json', null) };
}

function writeSnapshot({ provider, region, snap, vmSamples }: Job) {
  const dir = `data/${provider}/${region}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/vm.json`, JSON.stringify(snap.vms, null, 2) + '\n');
  writeFileSync(`${dir}/storage.json`, JSON.stringify(snap.storage, null, 2) + '\n');
  writeFileSync(`${dir}/egress.json`, JSON.stringify(snap.egress, null, 2) + '\n');

  console.log(`\n━━━ ${provider} / ${region} ━━━`);
  console.log(`VmSku ${snap.vms.length}건 · 스토리지 ${snap.storage.length}종 · egress ${snap.egress ? `구간 ${snap.egress.tiers.length}개(무료 ${snap.egress.freeGb}GB)` : '없음'} → ${dir}/`);
  for (const name of vmSamples) {
    const vm = snap.vms.find((v) => v.sku === name);
    if (vm) console.log(`  ${name.padEnd(16)} $${vm.pricePerHour}/h (${vm.vcpu}vCPU/${vm.ramGb}GB)`);
  }
  for (const s of snap.storage) console.log(`  ${s.kind.padEnd(16)} $${s.pricePerGbMonth}/GB·월`);
}

/** 환율(USD→KRW) — 무료 API, 실패해도 수집을 막지 않는다 (기존 값 유지) */
async function fetchUsdKrw(): Promise<Meta['usdKrw']> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const body = (await res.json()) as { rates?: { KRW?: number }; time_last_update_utc?: string };
    if (body.rates?.KRW) {
      return { rate: +body.rates.KRW.toFixed(2), at: new Date(body.time_last_update_utc ?? Date.now()).toISOString() };
    }
  } catch {
    // 무시 — 아래에서 기존 값 유지
  }
  console.warn('⚠ 환율 조회 실패 — 기존 값 유지');
  const old = existsSync('data/meta.json') ? (JSON.parse(readFileSync('data/meta.json', 'utf8')) as Meta) : null;
  return old?.usdKrw ?? null;
}

async function collectGcpJobs(): Promise<Job[]> {
  const apiKey = process.env.GCP_API_KEY;
  if (!apiKey) {
    console.error('GCP_API_KEY가 없습니다. .env에 GCP_API_KEY=<키>를 설정하세요.');
    process.exit(1);
  }
  console.log('[gcp] Compute Engine + Cloud Storage SKU 수집 중... (수만 건, 수십 초 소요)');
  const [compute, gcs] = await Promise.all([fetchComputeSkus(apiKey), fetchGcsSkus(apiKey)]);
  console.log(`[gcp] 원본 SKU ${(compute.length + gcs.length).toLocaleString()}건 수신`);

  return REGIONS.map((region) => {
    const gcpRegion = GCP_REGION[region];
    const { unitPrices, unmatched } = parseUnitPrices(compute, gcpRegion);
    if (unmatched.length > 0) console.log(`[gcp/${region}] 매핑 안 된 VM 단가 라벨 ${unmatched.length}종`);
    return {
      provider: 'gcp',
      region,
      snap: {
        vms: buildVmSkus(unitPrices, region),
        storage: parseGcpStorage(compute, gcs, gcpRegion, region),
        egress: parseGcpEgress(compute, gcpRegion, region),
      },
      vmSamples: ['e2-micro', 'e2-standard-2', 'n2-standard-4'],
    };
  });
}

async function collectAwsJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const region of REGIONS) {
    console.log(`[aws/${region}] EC2 + S3 + DataTransfer 오퍼 CSV 스트리밍 파싱 중... (수백 MB)`);
    jobs.push({ provider: 'aws', region, snap: await collectAws(region), vmSamples: ['t3.medium', 'm5.large', 'c5.xlarge'] });
  }
  return jobs;
}

async function collectAzureJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const region of REGIONS) {
    console.log(`[azure/${region}] Retail Prices API 수집 중...`);
    const [vms, storage, egress] = await Promise.all([
      collectAzureVm(region),
      collectAzureStorage(region),
      collectAzureEgress(region),
    ]);
    jobs.push({ provider: 'azure', region, snap: { vms, storage, egress }, vmSamples: ['Standard_B2s', 'Standard_D2s_v5', 'Standard_F4s_v2'] });
  }
  return jobs;
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const target = args.find((a) => !a.startsWith('--')) ?? 'all';
if (!['gcp', 'aws', 'azure', 'all'].includes(target)) {
  console.error(`알 수 없는 대상: ${target} (all | gcp | aws | azure)`);
  process.exit(1);
}

// 1) 수집 (메모리)
const jobs: Job[] = [];
if (target === 'gcp' || target === 'all') jobs.push(...(await collectGcpJobs()));
if (target === 'aws' || target === 'all') jobs.push(...(await collectAwsJobs()));
if (target === 'azure' || target === 'all') jobs.push(...(await collectAzureJobs()));

// 2) 검증 — 하나라도 이상하면 아무것도 쓰지 않는다
const allErrors = jobs.flatMap((j) => validateSnapshot(`${j.provider}/${j.region}`, readOldSnapshot(j.provider, j.region), j.snap));
if (allErrors.length > 0) {
  console.error('\n✖ 검증 실패 — 수집기 버그 가능성. 기존 데이터를 유지합니다.');
  for (const e of allErrors) console.error(`  - ${e}`);
  if (!force) {
    console.error('실제 가격 개편이 맞다면 --force로 재실행하세요.');
    process.exit(1);
  }
  console.warn('--force 지정됨 — 검증 실패를 무시하고 기록합니다.');
}

// 3) 기록
for (const job of jobs) writeSnapshot(job);
const meta: Meta = { collectedAt: new Date().toISOString(), usdKrw: await fetchUsdKrw() };
writeFileSync('data/meta.json', JSON.stringify(meta, null, 2) + '\n');
console.log(`\nmeta.json 갱신 — 수집 시각 ${meta.collectedAt}, USD/KRW ${meta.usdKrw?.rate ?? '없음'}`);
