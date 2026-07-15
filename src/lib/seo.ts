import { routing } from '@/i18n/routing';

export const SITE_URL = 'https://howmuchcloud.com';

/** 페이지별 canonical + hreflang 대체 URL — 기본 언어(en)는 프리픽스 없음 */
export function pageAlternates(locale: string, path: string) {
  const suffix = path === '/' ? '' : path;
  const urlFor = (l: string) => (l === routing.defaultLocale ? suffix || '/' : `/${l}${suffix}`);
  return {
    canonical: urlFor(locale),
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, urlFor(l)])),
      'x-default': urlFor(routing.defaultLocale),
    },
  };
}
