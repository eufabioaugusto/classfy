import { Redirect, useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingPlaceholder } from '@/components/LoadingPlaceholder';

// Visual QA without slowing real requests or changing production data.
export default function LoadingPreview() {
  const { variant } = useLocalSearchParams<{ variant?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  const layout = variant === 'discovery' ? 'discovery' : variant === 'dashboard' ? 'dashboard' : 'home';
  return <AppScreen edgeToEdge header={<NavigationHeader title="Prévia de carregamento" back />}>
    <LoadingPlaceholder variant={layout} inset={layout !== 'discovery'} />
  </AppScreen>;
}
