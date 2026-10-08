import { Redirect } from 'expo-router';
// The center item is an action, never a destination. Direct links return home.
export default function PrimaryActionRoute() {
  return <Redirect href="/" />;
}
