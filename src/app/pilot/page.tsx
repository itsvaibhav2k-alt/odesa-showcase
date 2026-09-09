import type { Metadata } from 'next';

import NightGardenPage from '@/components/marketing/night-garden/night-garden-page';

export const metadata: Metadata = {
  title: 'Pilot | Odesa',
  description: 'Learn how the Odesa pilot works and request access.',
};

export default function Page() {
  return <NightGardenPage page='pilot' />;
}
