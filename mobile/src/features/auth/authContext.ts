import { Session, User } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

export type MobileProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  creator_channel_name: string | null;
  plan: string | null;
  bio?: string | null;
  interests?: any;
  difficulties?: any;
  cover_image_url?: string | null;
  expo_push_token?: string | null;
};

export type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: MobileProfile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
