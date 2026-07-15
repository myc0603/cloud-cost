import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import DataFreshness from '@/components/DataFreshness';
import ScenarioBuilder from '@/components/scenario/ScenarioBuilder';
import { loadMeta, loadPricing } from '@/lib/pricing';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  // 빌드 시점에 스냅샷을 읽어 클라이언트로 내려보낸다 — 데이터 갱신 = 재빌드
  const pricing = {
    seoul: loadPricing('seoul'),
    'us-east': loadPricing('us-east'),
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        <DataFreshness meta={loadMeta()} />
      </header>
      <Suspense>
        <ScenarioBuilder pricing={pricing} />
      </Suspense>
    </main>
  );
}
