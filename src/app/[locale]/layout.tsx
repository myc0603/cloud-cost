import type { Metadata } from 'next';
import { Noto_Serif_KR } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import FeedbackWidget from '@/components/FeedbackWidget';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import NavLinks from '@/components/NavLinks';
import ThemeToggle from '@/components/ThemeToggle';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { pageAlternates, pageOpenGraph, SITE_URL } from '@/lib/seo';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import '../globals.css';

// 페이지 제목·최저가 숫자용 명조 (font-serif). 한글 글리프가 커서 미리 받지 않고 쓰일 때 받는다
const serif = Noto_Serif_KR({ weight: ['700', '800'], subsets: ['latin'], display: 'swap', preload: false, variable: '--font-noto-serif-kr' });

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
    // html.dark는 THEME_INIT_SCRIPT가 하이드레이션 전에 붙이므로 서버 HTML과 다를 수 있다
    <html lang={locale} className={serif.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* 본문 Pretendard — Google Fonts에 없고 로컬 파일은 2MB라, 쓰인 글자 조각만 받는 CDN 동적 서브셋 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased">
        <NextIntlClientProvider>
          <nav className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {/* 좁은 화면: 1줄 = 브랜드 + 피드백·언어, 2줄 = 메뉴 링크 */}
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 text-sm">
              <Link href="/" className="flex items-center gap-2 whitespace-nowrap text-base font-bold">
                <img src="/icon.svg" alt="" className="size-6" />
                {t('brand')}
              </Link>
              <NavLinks />
              <div className="ml-auto flex items-center gap-4">
                <FeedbackWidget />
                <ThemeToggle />
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
