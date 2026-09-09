import { describe, it, expect } from 'vitest';
import { formatAgoPhrase } from '@/lib/today/format';

describe('format', () => {
  describe('formatAgoPhrase', () => {
    it("should not append ' ago' when the label is 'just now'", () => {
      // Act
      const result = formatAgoPhrase('checked', 'just now');

      // Assert
      expect(result).toBe('checked just now');
    });

    it("should append ' ago' for a normal relative label", () => {
      const result = formatAgoPhrase('checked', '11m');

      expect(result).toBe('checked 11m ago');
    });

    it("should respect the 'Refreshed' verb with 'just now'", () => {
      const result = formatAgoPhrase('Refreshed', 'just now');

      expect(result).toBe('Refreshed just now');
    });

    it("should respect the 'Refreshed' verb with a normal label", () => {
      const result = formatAgoPhrase('Refreshed', '2h');

      expect(result).toBe('Refreshed 2h ago');
    });
  });
});
