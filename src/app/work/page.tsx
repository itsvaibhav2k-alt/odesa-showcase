import type { Metadata } from 'next';

import NightGardenPage from '@/components/marketing/night-garden/night-garden-page';

export const metadata: Metadata = {
  title: 'Work | Odesa',
  description: 'See the calls, rent, maintenance, and owner decisions Odesa keeps moving.',
};

export default function Page() {
  return <NightGardenPage page='work' />;
}
