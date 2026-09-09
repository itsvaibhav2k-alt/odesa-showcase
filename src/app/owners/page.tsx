import type { Metadata } from 'next';

import NightGardenPage from '@/components/marketing/night-garden/night-garden-page';

export const metadata: Metadata = {
  title: 'Owners | Odesa',
  description: 'See who Odesa is built for and where the fit is strongest.',
};

export default function Page() {
  return <NightGardenPage page='owners' />;
}
