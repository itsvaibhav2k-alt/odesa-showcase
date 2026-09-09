const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatRelativeTime(date: Date | string): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - then.getTime();

  if (diff < 0) {
    return 'just now';
  }

  if (diff < MINUTE) {
    return 'just now';
  }

  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return `${minutes} min ago`;
  }

  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  if (diff < 2 * DAY) {
    return 'Yesterday';
  }

  if (diff < WEEK) {
    const days = Math.floor(diff / DAY);
    return `${days} days ago`;
  }

  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
