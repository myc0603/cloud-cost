import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { OG_IMAGE_SIZE } from '@/lib/seo';

// 파일 컨벤션(opengraph-image) 대신 일반 라우트 — 자동 주입 URL이 /en/... 이라 리다이렉트를 타고,
// 자식 페이지 openGraph에 덮여 사라지기 때문. URL은 pageOpenGraph()에서 직접 넣는다.
export const dynamic = 'force-static';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const BRAND = 'How Much Cloud';
// 막대 길이는 일부러 같게 — 특정 클라우드가 비싸다는 인상을 주지 않도록
const BARS = [
  { name: 'AWS', color: '#f59e0b' },
  { name: 'Azure', color: '#3b82f6' },
  { name: 'GCP', color: '#ef4444' },
];

/** 기본 폰트엔 한글이 없어 Google Fonts에서 쓰인 글자만 subset으로 받아온다 (빌드 시점 1회) */
async function loadFont(weight: number, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!src) throw new Error(`OG 폰트 로드 실패 (weight ${weight})`);
  return (await fetch(src)).arrayBuffer();
}

export async function GET(_req: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const headline = t('ogHeadline');
  const subtitle = t('ogSubtitle');

  const text = BRAND + headline + subtitle + BARS.map((b) => b.name).join('') + '$';
  const [regular, bold] = await Promise.all([loadFont(400, text), loadFont(700, text)]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          padding: '0 80px',
          gap: 70,
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'Noto Sans KR',
        }}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 40 }}>
            {/* src/app/icon.svg와 같은 모양 — satori는 SVG <text>를 못 그려서 $는 div로 겹친다 */}
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 16,
                background: '#059669',
                display: 'flex',
                position: 'relative',
              }}
            >
              <svg width="72" height="72" viewBox="0 0 24 24">
                <g transform="translate(1.44 1.68) scale(0.88)">
                  <path
                    d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z"
                    fill="#ffffff"
                  />
                </g>
              </svg>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 30,
                  display: 'flex',
                  justifyContent: 'center',
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: '#059669',
                }}
              >
                $
              </div>
            </div>
            <span style={{ fontSize: 36, fontWeight: 700 }}>{BRAND}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 66, fontWeight: 700, lineHeight: 1.2 }}>
            {headline.split('\n').map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
          <div style={{ fontSize: 30, color: '#475569', marginTop: 28 }}>{subtitle}</div>
        </div>
        <div
          style={{
            width: 430,
            display: 'flex',
            flexDirection: 'column',
            gap: 30,
            padding: '44px 40px',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            borderRadius: 28,
          }}
        >
          {BARS.map((b) => (
            <div key={b.name} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 26, fontWeight: 700 }}>{b.name}</span>
              <div style={{ display: 'flex', height: 34, borderRadius: 10, background: '#f1f5f9' }}>
                <div style={{ width: '75%', height: '100%', borderRadius: 10, background: b.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...OG_IMAGE_SIZE,
      fonts: [
        { name: 'Noto Sans KR', data: regular, weight: 400, style: 'normal' },
        { name: 'Noto Sans KR', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
}
