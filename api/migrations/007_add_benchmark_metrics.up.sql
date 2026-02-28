ALTER TABLE benchmarks ADD COLUMN semantic_similarity FLOAT;
ALTER TABLE benchmarks ADD COLUMN rouge_l FLOAT;
ALTER TABLE benchmarks DROP CONSTRAINT IF EXISTS benchmarks_model_type_check;
ALTER TABLE benchmarks ADD CONSTRAINT benchmarks_model_type_check
    CHECK (model_type IN ('base', 'finetuned', 'teacher'));
