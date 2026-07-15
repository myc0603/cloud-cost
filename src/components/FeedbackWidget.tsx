'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** 나브바의 "피드백" 버튼 + 드롭다운 폼. 제출하면 /api/feedback이 GitHub 이슈로 전달한다. */
export default function FeedbackWidget() {
  const t = useTranslations('feedback');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // 허니팟 — 사람은 비워둔다
  const [status, setStatus] = useState<Status>('idle');

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) setStatus('idle');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, email, website, page: window.location.href, locale }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('sent');
      setMessage('');
      setEmail('');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900"
      >
        {t('button')}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          <div className="mb-2 flex items-start justify-between">
            <span className="text-sm font-semibold">{t('title')}</span>
            <button onClick={() => setOpen(false)} aria-label={t('close')} className="text-slate-400 hover:text-slate-900">
              ✕
            </button>
          </div>

          {status === 'sent' ? (
            <p className="py-4 text-center text-sm text-emerald-700">{t('sent')}</p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-2">
              <p className="text-xs text-slate-500">{t('description')}</p>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                {t('messageLabel')}
                <textarea
                  required
                  rows={4}
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t('placeholder')}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              </label>
              {/* 허니팟: 화면에 안 보이는 필드 — 봇이 채우면 서버가 조용히 버린다 */}
              <input
                type="text"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                {t('emailLabel')}
                <input
                  type="email"
                  maxLength={200}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              </label>
              <button
                type="submit"
                disabled={status === 'sending'}
                className="mt-1 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {status === 'sending' ? t('sending') : t('submit')}
              </button>
              {status === 'error' && <p className="text-xs text-red-600">{t('error')}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
