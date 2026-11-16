CREATE TYPE "public"."job_agent" AS ENUM('glm', 'content', 'helper');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" "job_agent" NOT NULL,
	"task" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"result" text,
	"draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_draft_id_content_items_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;