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
