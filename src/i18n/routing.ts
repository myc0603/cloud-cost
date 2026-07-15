import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ko'],
  defaultLocale: 'en',
  // 기본 언어(en)는 프리픽스 없이 루트(/), 한국어는 /ko
  localePrefix: 'as-needed',
});
