ALTER TABLE "decisions" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "doc_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "decided_on" date;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedes_id_decisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_supersedes_unique" ON "decisions" USING btree ("supersedes_id") WHERE "decisions"."supersedes_id" is not null;