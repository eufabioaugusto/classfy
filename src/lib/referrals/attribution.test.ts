import { beforeEach, describe, expect, it } from 'vitest';
import { captureReferral, clearReferralClaim, readReferralClaim, referralShareUrl, REFERRAL_WINDOW_MS } from './attribution';
describe('referral attribution', () => {
  beforeEach(() => { localStorage.clear(); clearReferralClaim(); });
  it('preserves mode, unrelated query, and authentication hash', () => {
    expect(captureReferral('https://classfy.com.br/?mode=explore&ref=ABC123&next=course#access_token=preserve', 1000))
      .toEqual({ code: 'ABC123', cleanPath: '/?mode=explore&next=course#access_token=preserve' });
    expect(readReferralClaim(1001)).toEqual({ code: 'ABC123', expires: 1000 + REFERRAL_WINDOW_MS });
  });
  it('rejects malformed, expired and excessively long-lived claims', () => {
    expect(captureReferral('https://classfy.com.br/?ref=%3Cscript%3E', 1000)?.code).toBeNull();
    expect(readReferralClaim(1001)).toBeNull();
    captureReferral('https://classfy.com.br/?ref=ABC123', 1000);
    expect(readReferralClaim(1000 + REFERRAL_WINDOW_MS)).toBeNull();
    localStorage.setItem('referral_expires', String(1000 + REFERRAL_WINDOW_MS * 2));
    expect(readReferralClaim(1001)).toBeNull();
  });
  it('uses a public production URL even in a local preview', () => {
    expect(referralShareUrl('ABC123')).toBe('https://classfy.com.br/?ref=ABC123');
    expect(referralShareUrl('bad?next=evil')).toBe('');
  });
  it('does not reset attribution on a visit without a referral', () => {
    captureReferral('https://classfy.com.br/?ref=ABC123', 1000);
    expect(captureReferral('https://classfy.com.br/?mode=explore', 1001)).toBeNull();
    expect(readReferralClaim(1002)?.code).toBe('ABC123');
  });
});
