ALTER TABLE training_runs ADD COLUMN logs TEXT DEFAULT '';
ALTER TABLE training_runs ADD COLUMN current_step INT DEFAULT 0;
ALTER TABLE training_runs ADD COLUMN total_steps INT;
ALTER TABLE training_runs ADD COLUMN grad_norm FLOAT;
ALTER TABLE training_runs ADD COLUMN learning_rate_current FLOAT;
