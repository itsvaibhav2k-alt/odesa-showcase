'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface StagedFile {
  readonly file: File;
  readonly preview?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

/**
 * Checks whether a file passes size and type validation.
 *
 * @param file - The file to validate
 * @returns true when the file is within limits and an allowed type
 */
function isValidFile(file: File): boolean {
  return file.size <= MAX_FILE_SIZE && ALLOWED_TYPES.has(file.type);
}

/**
 * Custom hook for staging files before upload.
 *
 * Handles validation (10 MB max, allowed MIME types), object-URL preview
 * creation for images, and cleanup of blob URLs on removal or unmount.
 *
 * @returns staged files array plus helpers to add, remove, and clear them
 */
export function useFileUpload() {
  const [stagedFiles, setStagedFiles] = useState<readonly StagedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Track previews for cleanup on unmount even if state has been cleared
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files);
    const valid = incoming.filter(isValidFile);

    const newStaged: StagedFile[] = valid.map((file) => {
      const isImage = file.type.startsWith('image/');
      const preview = isImage ? URL.createObjectURL(file) : undefined;

      if (preview) {
        previewUrlsRef.current.add(preview);
      }

      return { file, preview };
    });

    setStagedFiles((prev) => [...prev, ...newStaged]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setStagedFiles((prev) => {
      const target = prev[index];
      if (target?.preview) {
        URL.revokeObjectURL(target.preview);
        previewUrlsRef.current.delete(target.preview);
      }
      return [...prev.slice(0, index), ...prev.slice(index + 1)];
    });
  }, []);

  const clearFiles = useCallback(() => {
    setStagedFiles((prev) => {
      for (const staged of prev) {
        if (staged.preview) {
          URL.revokeObjectURL(staged.preview);
          previewUrlsRef.current.delete(staged.preview);
        }
      }
      return [];
    });
  }, []);

  // Revoke any remaining object URLs on unmount
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  return {
    stagedFiles,
    addFiles,
    removeFile,
    clearFiles,
    isUploading,
    setIsUploading,
  } as const;
}
