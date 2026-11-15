-- PLA-I52-6: the owner's questions about a delivery (El Probador's «Pregúntale a Taller»). Answers live in the
-- project thread. Safe to leave on revert.
ALTER TABLE "tasks" ADD COLUMN "preguntas" jsonb DEFAULT '[]'::jsonb NOT NULL;
