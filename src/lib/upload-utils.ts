// Shared upload validation utilities
// Used by maintenance-actions.ts, vendor-actions.ts, and useDocuments.ts

export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// Document-specific types (broader than image-only)
export const DOCUMENT_ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]
export const DOCUMENT_MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

/**
 * Sanitize a filename to prevent path traversal attacks.
 * Strips directory separators and special characters.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_') // Remove path separators and special chars
    .replace(/\.\./g, '_')          // Remove parent directory references
    .slice(0, 100)                   // Limit length
}
