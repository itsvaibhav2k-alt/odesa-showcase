import { NIGHT_GARDEN_PAGES, type NightGardenPageKey } from './content';
import NightGardenShell from './night-garden-shell';

export default function NightGardenPage({ page }: { page: NightGardenPageKey }) {
  const record = NIGHT_GARDEN_PAGES[page];
  return <NightGardenShell html={record.html} pageClass={record.pageClass} />;
}