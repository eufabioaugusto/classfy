import { Crown } from 'lucide-react-native';
// Mirrors src/components/plans/PlanCrown.tsx in the web app.
const planColors = { pro: '#e5aa25', premium: '#df3153' } as const;
export function PlanCrown({
  plan,
  size = 12,
}: {
  plan: 'pro' | 'premium';
  size?: number;
}) {
  return (
    <Crown
      size={size}
      color={planColors[plan]}
      fill={planColors[plan]}
      strokeWidth={1.8}
    />
  );
}
