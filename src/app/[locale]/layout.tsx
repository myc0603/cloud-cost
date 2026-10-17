import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import FeedbackWidget from '@/components/FeedbackWidget';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { pageAlternates, pageOpenGraph, SITE_URL } from '@/lib/seo';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    metadataBase: new URL(SITE_URL),
    title: t('siteTitle'),
    description: t('siteDescription'),
    alternates: pageAlternates(locale, '/'),
    openGraph: await pageOpenGraph(locale, '/', t('siteTitle'), t('siteDescription')),
    // 네이버 서치어드바이저 소유 확인 (공개값 — 비밀 아님)
    verification: { other: { 'naver-site-verification': '9bd3bf6a32b7666f7594be2854538f8f72e0719e' } },
  };
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('nav');

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <NextIntlClientProvider>
          <nav className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
              <span className="font-bold">{t('brand')}</span>
              <Link href="/" className="text-slate-600 hover:text-slate-900">{t('scenario')}</Link>
              <Link href="/instances" className="text-slate-600 hover:text-slate-900">{t('instances')}</Link>
              <Link href="/methodology" className="text-slate-600 hover:text-slate-900">{t('methodology')}</Link>
              <div className="ml-auto flex items-center gap-4">
                <FeedbackWidget />
                <LocaleSwitcher />
              </div>
            </div>
          </nav>
          {children}
        </NextIntlClientProvider>
        {/* 방문·유입 경로·국가 집계 (쿠키 없음). Vercel 대시보드에서 Analytics를 켜야 수집됨 */}
        <Analytics />
        {/* 실사용자 성능(Core Web Vitals) 집계 (쿠키 없음). Hobby는 종합 점수(RES)만, 최근 30일 1만 이벤트 — 넘으면 수집만 멈춤 */}
        <SpeedInsights />
      </body>
    </html>
  );
}
