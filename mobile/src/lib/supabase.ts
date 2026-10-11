import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const memoryStore = new Map<string, string>();

const serverSafeStorage = {
  getItem: async (key: string) => memoryStore.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    memoryStore.set(key, value);
  },
  removeItem: async (key: string) => {
    memoryStore.delete(key);
  },
};

const authStorage = Platform.OS === 'web' && typeof window === 'undefined' ? serverSafeStorage : AsyncStorage;
// Explicitly preserve the SDK's existing default session key.
export const supabaseAuthStorageKey = `sb-${new URL(supabaseUrl || 'https://placeholder.supabase.co').hostname.split('.')[0]}-auth-token`;

export async function storeOAuthCodeVerifier(verifier: string) {
  // Supabase exchangeCodeForSession reads this serialized verifier from storage.
  await authStorage.setItem(`${supabaseAuthStorageKey}-code-verifier`, JSON.stringify(verifier));
}

export async function clearOAuthCodeVerifier() {
  await authStorage.removeItem(`${supabaseAuthStorageKey}-code-verifier`);
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: authStorage,
      storageKey: supabaseAuthStorageKey,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
