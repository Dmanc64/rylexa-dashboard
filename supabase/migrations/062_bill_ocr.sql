-- ============================================================================
-- Migration 062: Smart Bill Entry (AI Invoice OCR)
--
-- Extends the bills table with OCR metadata produced by the analyze-bill
-- edge function (GPT-4o Mini). The raw extracted payload is retained in
-- ocr_extracted_fields so downstream features (duplicate detection,
-- line-item drill-down, GL-coding model training) can use it.
-- ============================================================================

BEGIN;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS ocr_extracted_fields jsonb,
  ADD COLUMN IF NOT EXISTS ocr_confidence       numeric(3,2) CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS ocr_model            text,
  ADD COLUMN IF NOT EXISTS ocr_processed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_reviewed         boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bills.ocr_extracted_fields IS 'Raw structured output from the analyze-bill edge function (vendor_name, invoice_number, invoice_date, due_date, amount, line_items[], suggested_category, summary).';
COMMENT ON COLUMN public.bills.ocr_confidence IS 'Model-reported confidence score 0.00–1.00 for the extraction as a whole.';
COMMENT ON COLUMN public.bills.ocr_model IS 'Model identifier that produced the extraction (e.g. gpt-4o-mini).';
COMMENT ON COLUMN public.bills.ocr_processed_at IS 'When the OCR extraction was performed.';
COMMENT ON COLUMN public.bills.ocr_reviewed IS 'True once a human has reviewed and confirmed the OCR-populated fields before submission.';

-- Feature flag so the UI can toggle the Scan-with-AI affordance.
INSERT INTO public.feature_flags (key, value, description)
VALUES ('ap_smart_bill_entry', true, 'AI-assisted invoice OCR for bill creation')
ON CONFLICT (key) DO NOTHING;

COMMIT;
