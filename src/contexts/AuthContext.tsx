import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { getSafeErrorPayload, logAppEvent } from "@/lib/appLogger";

type AppRole = 'user' | 'creator' | 'admin';
type PlanType = 'free' | 'pro' | 'premium';
type CreatorStatus = 'none' | 'pending' | 'approved' | 'rejected';

interface UserProfile {
  plan: PlanType;
  plan_expires_at: string | null;
  creator_status: CreatorStatus;
  creator_channel_name: string | null;
  avatar_url: string | null;
  display_name: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: AppRole;
  profile: UserProfile | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole>('user');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const navigate = useNavigate();
  const { checkDailyLogin } = useRewardSystem();
  
  // Track if we've already processed the initial session
  const hasProcessedSession = useRef(false);
  // Track the last user ID we processed daily login for
  const lastDailyLoginUserId = useRef<string | null>(null);
  // Track an in-flight daily login check to avoid racing getSession and INITIAL_SESSION
  const dailyLoginInFlightUserId = useRef<string | null>(null);
  // Track a user whose daily login should only run once the tab becomes visible
  const pendingVisibleDailyLoginUserId = useRef<string | null>(null);

  const fetchUserProfile = async (userId: string) => {
    try {
      // Fetch profile data
      const { data: profileData } = await supabase
        .from('profiles')
        .select('plan, plan_expires_at, creator_status, creator_channel_name, avatar_url, display_name')
        .eq('id', userId)
        .single();

      if (profileData) {
        setProfile(profileData);
      }

      // Fetch all user roles (user can have multiple)
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (rolesData && rolesData.length > 0) {
        // Priority: admin > creator > user
        const roles = rolesData.map(r => r.role);
        if (roles.includes('admin')) {
          setRole('admin');
        } else if (roles.includes('creator')) {
          setRole('creator');
        } else {
          setRole('user');
        }
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchUserProfile(user.id);
    }
  };

  const verifySubscription = async (userId?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-subscription');
      
      if (!error && data) {
        console.log('Subscription verified:', data);
        const profileUserId = userId || user?.id;
        if (profileUserId) {
          await fetchUserProfile(profileUserId);
        }
      }
    } catch (error) {
      console.error('Error verifying subscription:', error);
    }
  };

  // Handle daily login check - only once per session per user
  const handleDailyLogin = async (userId: string) => {
    // Prevent duplicate calls for the same user in this session
    if (lastDailyLoginUserId.current === userId || dailyLoginInFlightUserId.current === userId) {
      console.log('Daily login already checked for this user in this session');
      return;
    }

    dailyLoginInFlightUserId.current = userId;

    try {
      const processed = await checkDailyLogin(userId);
      if (processed !== false) {
        lastDailyLoginUserId.current = userId;
      }
    } finally {
      if (dailyLoginInFlightUserId.current === userId) {
        dailyLoginInFlightUserId.current = null;
      }
    }
  };

  const requestDailyLoginWhenVisible = (userId: string) => {
    if (window.location.pathname === '/reset-password') {
      return;
    }

    if (lastDailyLoginUserId.current === userId || dailyLoginInFlightUserId.current === userId) {
      return;
    }

    if (document.visibilityState === 'visible') {
      pendingVisibleDailyLoginUserId.current = null;
      handleDailyLogin(userId);
      return;
    }

    pendingVisibleDailyLoginUserId.current = userId;
  };

  useEffect(() => {
    const processPendingVisibleDailyLogin = () => {
      const pendingUserId = pendingVisibleDailyLoginUserId.current;

      if (!pendingUserId || document.visibilityState !== 'visible') {
        return;
      }

      pendingVisibleDailyLoginUserId.current = null;
      handleDailyLogin(pendingUserId);
    };

    document.addEventListener('visibilitychange', processPendingVisibleDailyLogin);
    window.addEventListener('focus', processPendingVisibleDailyLogin);

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state change:', event);
        
        setSession(session);
        setUser(session?.user ?? null);
        
        // Only process for specific events, not every state change
        if (session?.user) {
          // Only fetch profile on meaningful events
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
            setTimeout(() => {
              fetchUserProfile(session.user.id);
              
              // Daily login only counts when the tab becomes visibly active to the user.
              if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && window.location.pathname !== '/reset-password') {
                requestDailyLoginWhenVisible(session.user.id);
              }
              
              verifySubscription(session.user.id);
            }, 0);
          }
        } else {
          setProfile(null);
          setRole('user');
          lastDailyLoginUserId.current = null;
          dailyLoginInFlightUserId.current = null;
          pendingVisibleDailyLoginUserId.current = null;
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchUserProfile(session.user.id).finally(() => setLoading(false));

        // Only check daily login once on initial page load, and never on the reset-password page
        // (opening a recovery link creates a session but is not a real login)
        if (!hasProcessedSession.current && window.location.pathname !== '/reset-password') {
          hasProcessedSession.current = true;
          requestDailyLoginWhenVisible(session.user.id);
        } else {
          hasProcessedSession.current = true;
        }
        
        verifySubscription(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', processPendingVisibleDailyLogin);
      window.removeEventListener('focus', processPendingVisibleDailyLogin);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (!error) {
      navigate("/");
    }
    
    return { error };
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const redirectUrl = `${window.location.origin}/`;

    await logAppEvent({
      source: "auth_context",
      event: "supabase_signup_request_started",
      context: { email, redirectUrl, hasDisplayName: !!displayName.trim() },
    });
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          display_name: displayName,
        }
      }
    });

    if (error) {
      await logAppEvent({
        level: "error",
        source: "auth_context",
        event: "supabase_signup_request_failed",
        message: error.message,
        context: { email, error: getSafeErrorPayload(error) },
      });
    } else {
      await logAppEvent({
        source: "auth_context",
        event: "supabase_signup_request_succeeded",
        context: {
          email,
          userId: data.user?.id,
          hasSession: !!data.session,
        },
      });
    }
    
    if (!error && data.user) {
      // Check for referral code and create conversion
      const refCode = localStorage.getItem('referral_code');
      const refExpires = localStorage.getItem('referral_expires');
      
      if (refCode && refExpires && Date.now() < Number(refExpires)) {
        await supabase.functions.invoke('track-referral-conversion', {
          body: {
            referral_code: refCode,
            referred_user_id: data.user.id
          }
        }).catch(console.error);
        
        // Clear referral data
        localStorage.removeItem('referral_code');
        localStorage.removeItem('referral_expires');
      }
      
      navigate("/");
    }
    
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setRole('user');
    navigate("/auth");
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, role, profile, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
