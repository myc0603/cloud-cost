import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, formatMoney } from './display';

const RATE = 1490.48;

test('convert: 월 USD는 그대로', () => {
  assert.equal(convert(730, 'usd', 'month', RATE), 730);
});

test('convert: 기간 환산은 730h/월 관례를 따른다', () => {
  // 월 730달러 = 시간당 정확히 1달러
  assert.equal(convert(730, 'usd', 'hour', RATE), 1);
  assert.equal(convert(730, 'usd', 'day', RATE), 24);
  assert.equal(convert(730, 'usd', 'week', RATE), 168);
});

test('convert: KRW는 환율을 곱한다', () => {
  assert.equal(convert(1, 'krw', 'month', RATE), RATE);
  assert.equal(convert(730, 'krw', 'hour', RATE), RATE);
});

test('formatMoney: USD 월 — 기호와 2자리', () => {
  assert.equal(formatMoney(1234.5, 'usd', 'month', RATE), '$1,234.50');
});

test('formatMoney: 값이 작아지면 소수 자리를 늘린다', () => {
  // 월 $0.80 → 시간당 $0.0011 → 4자리라야 값이 남는다
  assert.equal(formatMoney(0.8, 'usd', 'hour', RATE), '$0.0011');
});

test('formatMoney: KRW는 원 기호에 큰 값은 정수', () => {
  assert.equal(formatMoney(100, 'krw', 'month', RATE), '₩149,048');
});
