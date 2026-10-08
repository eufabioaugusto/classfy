import { nextRealtimeTopic } from '@/lib/realtimeTopic';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/features/auth/authContext';
import {
  resolveCreatorRole,
  type CreatorRole,
} from '@/features/navigation/primaryAction';
import { supabase } from '@/lib/supabase';

type Action = 'classy' | 'publish' | null;
type PrimaryActionValue = {
  action: Action;
  canPublish: boolean;
  roleLoading: boolean;
  openClassy: () => void;
  openPublish: () => void;
  closeClassy: () => void;
  closePublish: () => void;
};
const PrimaryActionContext = createContext<PrimaryActionValue | null>(null);
export function PrimaryActionProvider({ children }: PropsWithChildren) {
  const { user, profile } = useAuth();
  const owner = user?.id || null;
  const [selection, setSelection] = useState<{
    owner: string | null;
    action: Action;
  }>({ owner, action: null });
  const [roles, setRoles] = useState<{
    owner: string | null;
    role: CreatorRole;
    loading: boolean;
  }>({ owner, role: 'user', loading: !!owner });
  const roleLoading = !!owner && (roles.owner !== owner || roles.loading);
  const canPublish = !!owner && roles.owner === owner && roles.role !== 'user';
  const action =
    selection.owner === owner && (selection.action !== 'publish' || canPublish)
      ? selection.action
      : null;
  useEffect(() => {
    let active = true;
    let revision = 0;
    setSelection({ owner, action: null });
    setRoles({ owner, role: 'user', loading: !!owner });
    if (!owner) return;
    const load = async () => {
      const request = ++revision;
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', owner);
      if (!active || request !== revision) return;
      const role = error
        ? 'user'
        : resolveCreatorRole((data || []).map((item) => item.role));
      setRoles({ owner, role, loading: false });
      if (role === 'user')
        setSelection((previous) =>
          previous.owner === owner && previous.action === 'publish'
            ? { owner, action: null }
            : previous,
        );
    };
    void load();
    const channel = supabase
      .channel(nextRealtimeTopic(`mobile-primary-role-${owner}`))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_roles',
          filter: `user_id=eq.${owner}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      active = false;
      revision++;
      foreground.remove();
      void supabase.removeChannel(channel);
    };
  }, [owner, profile?.creator_status]);
  const openClassy = useCallback(
    () => setSelection({ owner, action: 'classy' }),
    [owner],
  );
  const openPublish = useCallback(() => {
    if (canPublish) setSelection({ owner, action: 'publish' });
  }, [owner, canPublish]);
  const closeClassy = useCallback(
    () =>
      setSelection((previous) =>
        previous.action === 'classy' ? { owner, action: null } : previous,
      ),
    [owner],
  );
  const closePublish = useCallback(
    () =>
      setSelection((previous) =>
        previous.action === 'publish' ? { owner, action: null } : previous,
      ),
    [owner],
  );
  const value = useMemo(
    () => ({
      action,
      canPublish,
      roleLoading,
      openClassy,
      openPublish,
      closeClassy,
      closePublish,
    }),
    [
      action,
      canPublish,
      roleLoading,
      openClassy,
      openPublish,
      closeClassy,
      closePublish,
    ],
  );
  return (
    <PrimaryActionContext.Provider value={value}>
      {children}
    </PrimaryActionContext.Provider>
  );
}
export function usePrimaryAction() {
  const value = useContext(PrimaryActionContext);
  if (!value)
    throw new Error(
      'usePrimaryAction must be used inside PrimaryActionProvider',
    );
  return value;
}
