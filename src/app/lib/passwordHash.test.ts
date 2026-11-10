import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwordHash';

describe('passwordHash', () => {
  it('verifies the right password and rejects wrong ones', async () => {
    const record = await hashPassword('correct horse battery', 1000);
    expect(await verifyPassword('correct horse battery', record)).toBe(true);
    expect(await verifyPassword('wrong password', record)).toBe(false);
    expect(await verifyPassword('', record)).toBe(false);
  });

  it('never stores the password and uses a fresh salt each time', async () => {
    const a = await hashPassword('same password', 1000);
    const b = await hashPassword('same password', 1000);
    expect(JSON.stringify(a)).not.toContain('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('fails closed on corrupted records', async () => {
    expect(await verifyPassword('x', { salt: '###', hash: '###', iterations: 1000 })).toBe(false);
  });
});
