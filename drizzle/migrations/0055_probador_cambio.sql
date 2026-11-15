-- PLA-I52-7: the kind of change a delivery is (se_ve, se_comporta, no_se_ve), read by finish from the diff. The
-- card shapes its proof by it, and «solo lo que no se ve» accepts only no_se_ve. Safe to leave on revert.
ALTER TABLE "tasks" ADD COLUMN "cambio" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cambio_check" CHECK ("tasks"."cambio" is null or "tasks"."cambio" in ('se_ve', 'se_comporta', 'no_se_ve'));
