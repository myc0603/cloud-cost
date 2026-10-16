import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';

/** 대표 도메인 — www 없는 주소는 www로 308 리다이렉트되므로 canonical·sitemap은 반드시 www */
export const SITE_URL = 'https://www.howmuchcloud.com';

/** 로케일별 경로 — 기본 언어(en)는 프리픽스 없음. 예: ('ko', '/instances') → '/ko/instances' */
export function localizedPath(locale: string, path: string) {
  const suffix = path === '/' ? '' : path;
  return locale === routing.defaultLocale ? suffix || '/' : `/${locale}${suffix}`;
}

/** 페이지별 canonical + hreflang 대체 URL */
export function pageAlternates(locale: string, path: string) {
  const urlFor = (l: string) => localizedPath(l, path);
  return {
    canonical: urlFor(locale),
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, urlFor(l)])),
      'x-default': urlFor(routing.defaultLocale),
    },
  };
}

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

const OG_LOCALE: Record<string, string> = { ko: 'ko_KR', en: 'en_US' };

/** 페이지별 Open Graph — 자식 페이지의 openGraph는 부모 것을 통째로 덮어쓰므로 페이지마다 호출 */
export async function pageOpenGraph(locale: string, path: string, title: string, description: string) {
  const t = await getTranslations({ locale, namespace: 'nav' });
  return {
    title,
    description,
    url: localizedPath(locale, path),
    siteName: t('brand'),
    locale: OG_LOCALE[locale],
    type: 'website' as const,
    images: [{ url: localizedPath(locale, '/og-image'), ...OG_IMAGE_SIZE, alt: t('brand') }],
  };
}
