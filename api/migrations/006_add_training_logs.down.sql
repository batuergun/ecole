ALTER TABLE training_runs DROP COLUMN IF EXISTS logs;
ALTER TABLE training_runs DROP COLUMN IF EXISTS current_step;
ALTER TABLE training_runs DROP COLUMN IF EXISTS total_steps;
ALTER TABLE training_runs DROP COLUMN IF EXISTS grad_norm;
ALTER TABLE training_runs DROP COLUMN IF EXISTS learning_rate_current;
