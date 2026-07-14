import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '클라우드 비용 비교',
  description: 'AWS · Azure · GCP 시나리오 기반 월 비용 비교',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
