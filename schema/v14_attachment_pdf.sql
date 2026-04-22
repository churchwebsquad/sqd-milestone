-- ============================================================================
-- v14_attachment_pdf.sql
-- Widen the submission-attachments bucket to accept PDFs. Everything else
-- about the bucket stays the same (10 MB cap bumped here to 20 MB so PDFs
-- with a few scanned pages aren't rejected, public read, staff-only insert).
-- ============================================================================

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ],
  file_size_limit = 20971520  -- 20 MB
WHERE id = 'submission-attachments';
