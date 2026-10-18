import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import DataFreshness from '@/components/DataFreshness';
import InstanceTable from '@/components/instances/InstanceTable';
import { loadMeta, loadPricing } from '@/lib/pricing';
import { pageAlternates, pageOpenGraph } from '@/lib/seo';
import { REGIONS } from '@/lib/regions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: t('instancesTitle'),
    description: t('instancesDescription'),
    alternates: pageAlternates(locale, '/instances'),
    openGraph: await pageOpenGraph(locale, '/instances', t('instancesTitle'), t('instancesDescription')),
  };
}

export default async function InstancesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('instances');

  // 기본 리전(서울) VM만 페이지에 넣는다 — 다른 리전은 고를 때 받아온다. 부제의 종수는 전 리전 합계
  const vmsOf = (region: (typeof REGIONS)[number]) => Object.values(loadPricing(region)).flatMap((p) => p.vm);
  const total = REGIONS.reduce((n, r) => n + vmsOf(r).length, 0);
  const initial = { region: 'seoul' as const, skus: vmsOf('seoul') };
  const meta = loadMeta();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-4xl font-extrabold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('subtitle', { count: total })}</p>
        <DataFreshness meta={meta} />
      </header>
      <InstanceTable initial={initial} usdKrwRate={meta?.usdKrw?.rate ?? null} />
    </main>
  );
}
