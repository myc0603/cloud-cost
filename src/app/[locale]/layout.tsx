import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import FeedbackWidget from '@/components/FeedbackWidget';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { pageAlternates, SITE_URL } from '@/lib/seo';
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
      </body>
    </html>
  );
}
