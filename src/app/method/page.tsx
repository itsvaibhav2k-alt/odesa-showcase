import type { Metadata } from 'next';

import NightGardenPage from '@/components/marketing/night-garden/night-garden-page';

export const metadata: Metadata = {
  title: 'Method | Odesa',
  description: 'See how Odesa listens, verifies, acts within rules, and briefs the owner.',
};

export default function Page() {
  return <NightGardenPage page='method' />;
}
