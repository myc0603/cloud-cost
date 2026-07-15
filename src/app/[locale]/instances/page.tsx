import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import DataFreshness from '@/components/DataFreshness';
import InstanceTable from '@/components/instances/InstanceTable';
import { loadMeta, loadPricing } from '@/lib/pricing';
import { pageAlternates } from '@/lib/seo';
import type { Region } from '@/lib/schema';

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
  };
}

export default async function InstancesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('instances');

  const regions: Region[] = ['seoul', 'us-east'];
  const skus = regions.flatMap((region) => {
    const pricing = loadPricing(region);
    return Object.values(pricing).flatMap((p) => p.vm);
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle', { count: skus.length })}</p>
        <DataFreshness meta={loadMeta()} />
      </header>
      <InstanceTable skus={skus} />
    </main>
  );
}
