import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import DataFreshness from '@/components/DataFreshness';
import ScenarioBuilder from '@/components/scenario/ScenarioBuilder';
import { loadMeta, loadPricing } from '@/lib/pricing';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  // 빌드 시점에 기본 리전(서울)만 페이지에 넣는다 — 다른 리전은 고를 때 /pricing/{region}.json에서 받는다
  const initialPricing = { seoul: loadPricing('seoul') };
  const meta = loadMeta();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-4xl font-extrabold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-base text-slate-600 dark:text-slate-300">{t('subtitle')}</p>
        <DataFreshness meta={meta} />
      </header>
      <Suspense>
        <ScenarioBuilder initialPricing={initialPricing} usdKrwRate={meta?.usdKrw?.rate ?? null} />
      </Suspense>
    </main>
  );
}
