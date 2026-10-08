import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';

// Keep the central action role-aware while opening the native workspace.
export function PublicationMenu() {
  const router = useRouter();
  const { action, canPublish, closePublish } = usePrimaryAction();
  useEffect(() => {
    if (action !== 'publish' || !canPublish) return;
    closePublish();
    router.push('/studio');
  }, [action, canPublish, closePublish, router]);
  return null;
}
