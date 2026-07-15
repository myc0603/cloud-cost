import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import DataFreshness from '@/components/DataFreshness';
import { loadMeta } from '@/lib/pricing';
import { pageAlternates } from '@/lib/seo';
import { MethodologyEn, MethodologyKo } from './content';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: t('methodologyTitle'),
    description: t('methodologyDescription'),
    alternates: pageAlternates(locale, '/methodology'),
  };
}

export default async function MethodologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('methodology');

  const meta = loadMeta();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <DataFreshness meta={meta} />
      </header>
      {locale === 'ko' ? <MethodologyKo meta={meta} /> : <MethodologyEn meta={meta} />}
    </main>
  );
}
