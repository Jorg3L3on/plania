CREATE TABLE "digest_reads" (
	"reader" text PRIMARY KEY NOT NULL,
	"cursor" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
