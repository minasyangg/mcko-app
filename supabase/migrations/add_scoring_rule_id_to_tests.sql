-- add_scoring_rule_id_to_tests
-- Recorded as applied in the live DB (2026-05-13) but never committed as a file.
-- Corresponds to commit ae82289 "feat: persist scoring_rule_id on tests + fix publish button logic".

alter table tests add column if not exists scoring_rule_id uuid references scoring_rules(id) on delete set null;
