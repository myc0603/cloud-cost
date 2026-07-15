import type { Metadata } from 'next';
import DataFreshness from '@/components/DataFreshness';
import InstanceTable from '@/components/instances/InstanceTable';
import { loadMeta, loadPricing } from '@/lib/pricing';
import type { Region } from '@/lib/schema';

export const metadata: Metadata = {
  title: 'AWS·Azure·GCP 인스턴스 가격 비교표 | 클라우드 비용 비교',
  description:
    'AWS EC2, Azure VM, GCP Compute Engine 인스턴스의 vCPU/RAM 스펙과 시간당·월 가격을 한 표에서 비교합니다. Linux 온디맨드 정가, 서울·미국 동부 리전.',
};

export default function InstancesPage() {
  const regions: Region[] = ['seoul', 'us-east'];
  const skus = regions.flatMap((region) => {
    const pricing = loadPricing(region);
    return Object.values(pricing).flatMap((p) => p.vm);
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">인스턴스 가격 비교표</h1>
        <p className="mt-1 text-sm text-slate-600">
          AWS · Azure · GCP 인스턴스 {skus.length.toLocaleString()}종 — Linux 온디맨드 정가(USD) 기준.
        </p>
        <DataFreshness meta={loadMeta()} />
      </header>
      <InstanceTable skus={skus} />
    </main>
  );
}
