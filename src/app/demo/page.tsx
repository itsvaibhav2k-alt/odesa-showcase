import type { Metadata } from 'next';

import NightGardenPage from '@/components/marketing/night-garden/night-garden-page';

export const metadata: Metadata = {
  title: 'Sample night | Odesa',
  description: 'Run a fictional tenant call through the Odesa sample night.',
};

export default function Page() {
  return <NightGardenPage page='demo' />;
}
