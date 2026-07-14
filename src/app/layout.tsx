import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '클라우드 비용 비교',
  description: 'AWS · Azure · GCP 시나리오 기반 월 비용 비교',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <nav className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
            <span className="font-bold">클라우드 비용 비교</span>
            <a href="/" className="text-slate-600 hover:text-slate-900">시나리오 견적</a>
            <a href="/instances" className="text-slate-600 hover:text-slate-900">인스턴스 비교표</a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
