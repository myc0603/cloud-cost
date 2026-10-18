'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';
import { THEME_KEY, type ThemeMode } from '@/lib/theme';

const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: Monitor, light: Sun, dark: Moon };

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {}
  return 'system';
}

/** 나브바 테마 버튼 — 누를 때마다 시스템 → 라이트 → 다크. 첫 적용은 layout <head>의 THEME_INIT_SCRIPT가 한다. */
export default function ThemeToggle() {
  const t = useTranslations('theme');
  // 서버 렌더에선 저장값을 모르므로 마운트 후에 아이콘을 그린다 (하이드레이션 불일치 방지)
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => setMode(readMode()), []);

  useEffect(() => {
    if (!mode) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle('dark', mode === 'dark' || (mode === 'system' && mq.matches));
    apply();
    if (mode !== 'system') return;
    // 시스템 모드면 OS 설정이 바뀔 때도 따라간다
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  const cycle = () => {
    if (!mode) return;
    const next = NEXT[mode];
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {}
    setMode(next);
  };

  const Icon = ICON[mode ?? 'system'];
  const label = mode ? t('label', { current: t(mode), next: t(NEXT[mode]) }) : undefined;

  return (
    <button
      onClick={cycle}
      aria-label={label}
      title={label}
      className={`text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 ${mode ? '' : 'invisible'}`}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
