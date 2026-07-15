import { NextResponse } from 'next/server';

// 피드백을 GitHub 이슈로 전달한다.
// - FEEDBACK_GITHUB_TOKEN: 대상 레포에 이슈 쓰기 권한이 있는 fine-grained PAT (필수)
// - FEEDBACK_GITHUB_REPO: 이슈를 만들 레포 (기본: myc0603/cloud-cost)
//   ⚠ public 레포면 제출자 이메일이 공개되므로 private 레포 사용을 권장
const REPO = process.env.FEEDBACK_GITHUB_REPO ?? 'myc0603/cloud-cost';
const MAX_MESSAGE = 2000;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { message, email, website, page, locale } = body ?? {};

  // 허니팟이 채워져 있으면 봇 — 조용히 성공으로 응답
  if (typeof website === 'string' && website.length > 0) {
    return NextResponse.json({ ok: true });
  }
  if (typeof message !== 'string' || message.trim().length === 0 || message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: 'invalid message' }, { status: 400 });
  }
  if (email !== undefined && (typeof email !== 'string' || email.length > 200)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }

  const token = process.env.FEEDBACK_GITHUB_TOKEN;
  if (!token) {
    console.error('feedback: FEEDBACK_GITHUB_TOKEN not set');
    return NextResponse.json({ error: 'not configured' }, { status: 500 });
  }

  const trimmed = message.trim();
  const firstLine = trimmed.split('\n')[0];
  const title = `[피드백] ${firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine}`;
  const issueBody = [
    trimmed,
    '',
    '---',
    `- 이메일: ${typeof email === 'string' && email ? email : '(미기재)'}`,
    `- 페이지: ${typeof page === 'string' ? page.slice(0, 300) : '(unknown)'}`,
    `- 언어: ${typeof locale === 'string' ? locale.slice(0, 10) : '(unknown)'}`,
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ title, body: issueBody }),
  });
  if (!res.ok) {
    console.error('feedback: GitHub issue creation failed', res.status, await res.text());
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
