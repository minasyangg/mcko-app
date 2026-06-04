-- Sequences for subject-specific codes
CREATE SEQUENCE IF NOT EXISTS library_code_mat_seq START 1;
CREATE SEQUENCE IF NOT EXISTS library_code_fiz_seq START 1;
CREATE SEQUENCE IF NOT EXISTS library_code_other_seq START 1;

-- Add library_code column
ALTER TABLE library_problems
  ADD COLUMN IF NOT EXISTS library_code text UNIQUE;

-- Auto-generate code on INSERT
CREATE OR REPLACE FUNCTION generate_library_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.library_code IS NULL THEN
    NEW.library_code := CASE
      WHEN NEW.subject = 'Математика' THEN 'МАТ-' || LPAD(nextval('library_code_mat_seq')::text, 5, '0')
      WHEN NEW.subject = 'Физика'     THEN 'ФИЗ-' || LPAD(nextval('library_code_fiz_seq')::text, 5, '0')
      ELSE                                 'ЗАД-' || LPAD(nextval('library_code_other_seq')::text, 5, '0')
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_library_code ON library_problems;
CREATE TRIGGER set_library_code
  BEFORE INSERT ON library_problems
  FOR EACH ROW EXECUTE FUNCTION generate_library_code();

-- Backfill existing rows
UPDATE library_problems SET library_code =
  CASE subject
    WHEN 'Математика' THEN 'МАТ-' || LPAD(nextval('library_code_mat_seq')::text, 5, '0')
    WHEN 'Физика'     THEN 'ФИЗ-' || LPAD(nextval('library_code_fiz_seq')::text, 5, '0')
    ELSE                   'ЗАД-' || LPAD(nextval('library_code_other_seq')::text, 5, '0')
  END
WHERE library_code IS NULL;
