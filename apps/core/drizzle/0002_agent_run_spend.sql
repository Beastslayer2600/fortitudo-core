ALTER TABLE "agent_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL;