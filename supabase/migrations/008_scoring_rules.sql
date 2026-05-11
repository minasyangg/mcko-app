-- Правила оценивания: шаблон баллов для типа теста
CREATE TABLE IF NOT EXISTS scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  exam_type text,          -- ВПР, ОГЭ, ЕГЭ, ...
  grade text,              -- 8, 9, 11, ...
  subject text,            -- Математика, Физика, ...
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, exam_type, grade, subject)
);

-- Элементы правила: макс. балл для каждого номера задания
CREATE TABLE IF NOT EXISTS scoring_rule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES scoring_rules(id) ON DELETE CASCADE,
  task_number integer NOT NULL,
  max_score numeric NOT NULL DEFAULT 1,
  note text,
  UNIQUE (rule_id, task_number)
);

-- RLS
ALTER TABLE scoring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_rule_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scoring_rules: org read"
  ON scoring_rules FOR SELECT
  USING (organization_id = auth_org());

CREATE POLICY "scoring_rules: teacher manage"
  ON scoring_rules FOR ALL
  USING (organization_id = auth_org() AND auth_role() IN ('teacher', 'admin'));

CREATE POLICY "scoring_rule_items: org read"
  ON scoring_rule_items FOR SELECT
  USING (rule_id IN (SELECT id FROM scoring_rules WHERE organization_id = auth_org()));

CREATE POLICY "scoring_rule_items: teacher manage"
  ON scoring_rule_items FOR ALL
  USING (rule_id IN (SELECT id FROM scoring_rules WHERE organization_id = auth_org()))
  WITH CHECK (rule_id IN (SELECT id FROM scoring_rules WHERE organization_id = auth_org()));
