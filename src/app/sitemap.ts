import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { loadMeta } from '@/lib/pricing';
import { localizedPath, SITE_URL } from '@/lib/seo';

/** 검색 엔진에 알릴 페이지 — 페이지를 추가하면 여기에도 추가 */
const PATHS = ['/', '/instances', '/methodology'];

/**
 * /sitemap.xml — 페이지 × 언어 전체 목록 + 언어별 대체 주소(hreflang).
 * lastModified = 가격 수집 시각: 데이터 갱신 = 재배포라 실제 내용이 바뀐 시점과 같다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = loadMeta()?.collectedAt ?? new Date().toISOString();
  return PATHS.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: SITE_URL + localizedPath(locale, path),
      lastModified,
      changeFrequency: 'daily' as const,
      priority: path === '/' ? 1 : 0.8,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [l, SITE_URL + localizedPath(l, path)])),
      },
    })),
  );
}
