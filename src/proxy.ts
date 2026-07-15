import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // API·정적 파일 제외한 모든 경로에서 로케일 라우팅
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
