import styles from './landing.module.css';

/**
 * Maps a space-separated string of artifact class names to their
 * locally-scoped CSS-module equivalents, so the ported markup can keep the
 * original BEM class strings (e.g. "btn btn--primary btn--lg").
 */
export const c = (names: string): string =>
  names
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => styles[name] ?? name)
    .join(' ');

export { styles };
