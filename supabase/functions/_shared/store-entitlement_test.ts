import { assertEquals } from 'https://deno.land/std@0.190.0/testing/asserts.ts';
import { activeStoreProvider } from './store-entitlement.ts';
const now = Date.parse('2026-10-11T12:00:00Z');
Deno.test('somente vigência futura e fonte oficial protegida identificam assinatura da loja', () => {
  const profile = {plan:'premium',plan_expires_at:'2026-11-11T12:00:00Z',entitlement_source:'apple'};
  assertEquals(activeStoreProvider(profile, now), 'apple');
  assertEquals(activeStoreProvider({...profile,entitlement_source:'google'},now), 'google');
  for (const patch of [{plan:'free'},{plan_expires_at:null},{plan_expires_at:'invalid'},
    {plan_expires_at:'2026-10-11T12:00:00Z'},{entitlement_source:'stripe'},{entitlement_source:'legacy'}]) {
    assertEquals(activeStoreProvider({...profile,...patch}, now), null);
  }
});
