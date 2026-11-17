CREATE TYPE "public"."worker_attempt_status" AS ENUM('running', 'done', 'failed', 'escalated', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_tier" AS ENUM('small', 'big');--> statement-breakpoint
CREATE TYPE "public"."worker_job_kind" AS ENUM('social_post', 'website_edit', 'website_build', 'outreach_draft', 'research_brief');--> statement-breakpoint
CREATE TYPE "public"."worker_job_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "worker_control" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"worker_id" uuid,
	"status" "worker_attempt_status" DEFAULT 'running' NOT NULL,
	"reason" text,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worker_job_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "worker_job_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"seq" integer NOT NULL,
	"source" text DEFAULT 'worker' NOT NULL,
	"payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "worker_job_kind" NOT NULL,
	"tier" "job_tier" NOT NULL,
	"skill" text NOT NULL,
	"skill_version" integer NOT NULL,
	"system" text NOT NULL,
	"prompt" text NOT NULL,
	"max_tokens" integer NOT NULL,
	"status" "worker_job_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"allow_small_fallback" boolean DEFAULT false NOT NULL,
	"claimed_by" uuid,
	"lease_expires_at" timestamp with time zone,
	"result" text,
	"model" text,
	"schedule_id" uuid,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'Africa/Johannesburg' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"kind" "worker_job_kind" NOT NULL,
	"skill" text NOT NULL,
	"tier" "job_tier" NOT NULL,
	"allow_small_fallback" boolean DEFAULT false NOT NULL,
	"prompt" text NOT NULL,
	"max_tokens" integer NOT NULL,
	"last_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_url" text,
	"source_sha" text,
	"license" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"max_tier" "job_tier" NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_claim_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_name_unique" UNIQUE("name"),
	CONSTRAINT "workers_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "worker_job_attempts" ADD CONSTRAINT "worker_job_attempts_job_id_worker_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."worker_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_job_attempts" ADD CONSTRAINT "worker_job_attempts_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_job_events" ADD CONSTRAINT "worker_job_events_job_id_worker_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."worker_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_claimed_by_workers_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_schedule_id_worker_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."worker_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_job_attempts_job_attempt" ON "worker_job_attempts" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_job_events_job_attempt_seq" ON "worker_job_events" USING btree ("job_id","attempt","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_jobs_schedule_due" ON "worker_jobs" USING btree ("schedule_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "worker_jobs_status_run_after" ON "worker_jobs" USING btree ("status","run_after");
--> statement-breakpoint
CREATE FUNCTION "worker_job_events_append_only"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'worker_job_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "worker_job_events_no_change" BEFORE UPDATE OR DELETE ON "worker_job_events" FOR EACH ROW EXECUTE FUNCTION "worker_job_events_append_only"();
--> statement-breakpoint
INSERT INTO "worker_control" ("id", "paused") VALUES (1, false) ON CONFLICT DO NOTHING;
