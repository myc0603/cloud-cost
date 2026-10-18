'use client';

import { useEffect, useState } from 'react';

/**
 * 정수 입력 — 입력 중에는 빈칸·중간값을 허용하고(백스페이스로 다 지울 수 있게),
 * 유효한 값(정수, min 이상)일 때만 onChange로 올린다. 포커스가 빠질 때 유효하지 않으면 마지막 값으로 되돌린다.
 */
export default function NumberField({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));

  // 바깥에서 값이 바뀌면(템플릿 적용 등) 표시도 맞춘다. 입력 중인 같은 값은 건드리지 않음
  useEffect(() => {
    setText((t) => (t !== '' && Number(t) === value ? t : String(value)));
  }, [value]);

  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
      {label}
      <input
        type="number"
        min={min}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= min) onChange(n);
        }}
        onBlur={() => {
          const n = parseInt(text, 10);
          if (Number.isNaN(n) || n < min) setText(String(value));
        }}
        className="w-24 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
      />
    </label>
  );
}
