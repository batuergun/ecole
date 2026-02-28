ALTER TABLE benchmarks DROP CONSTRAINT IF EXISTS benchmarks_model_type_check;
ALTER TABLE benchmarks ADD CONSTRAINT benchmarks_model_type_check
    CHECK (model_type IN ('base', 'finetuned'));
ALTER TABLE benchmarks DROP COLUMN IF EXISTS rouge_l;
ALTER TABLE benchmarks DROP COLUMN IF EXISTS semantic_similarity;
