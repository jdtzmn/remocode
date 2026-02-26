CREATE TYPE "public"."action_attempt_status" AS ENUM('accepted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."activity_confidence" AS ENUM('high', 'medium', 'low', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."attention_request_kind" AS ENUM('permission', 'question');--> statement-breakpoint
CREATE TYPE "public"."attention_request_status" AS ENUM('open', 'resolved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('darwin', 'linux', 'windows', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."mobile_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."notification_decision" AS ENUM('sent', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."session_state" AS ENUM('busy', 'retry', 'idle', 'unknown');--> statement-breakpoint
CREATE TABLE "action_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_action_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"status" "action_attempt_status" NOT NULL,
	"error_code" text,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attention_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"kind" "attention_request_kind" NOT NULL,
	"status" "attention_request_status" NOT NULL,
	"payload" jsonb NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_activity" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"is_active" boolean,
	"idle_seconds" integer,
	"frontmost_app" text,
	"terminal_frontmost" boolean,
	"confidence" "activity_confidence",
	"sampled_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_uid" text NOT NULL,
	"name" text,
	"platform" "device_platform",
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" "mobile_platform" NOT NULL,
	"device_name" text,
	"app_version" text,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"decision" "notification_decision" NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"label" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"adapter" text NOT NULL,
	"adapter_version" text NOT NULL,
	"event_type" text NOT NULL,
	"session_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_projections" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"title" text,
	"directory" text,
	"session_state" "session_state" DEFAULT 'unknown' NOT NULL,
	"requires_attention" boolean DEFAULT false NOT NULL,
	"attention_count" integer DEFAULT 0 NOT NULL,
	"last_attention_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"last_status_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"stale_at" timestamp with time zone,
	"is_stale" boolean DEFAULT false NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supabase_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_activity" ADD CONSTRAINT "device_activity_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_projections" ADD CONSTRAINT "session_projections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_projections" ADD CONSTRAINT "session_projections_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_attempts_user_client_action_uq" ON "action_attempts" USING btree ("user_id","client_action_id");--> statement-breakpoint
CREATE INDEX "action_attempts_request_created_idx" ON "action_attempts" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "attention_requests_user_status_opened_idx" ON "attention_requests" USING btree ("user_id","status","opened_at");--> statement-breakpoint
CREATE INDEX "attention_requests_session_status_opened_idx" ON "attention_requests" USING btree ("session_id","status","opened_at");--> statement-breakpoint
CREATE INDEX "device_activity_sampled_at_idx" ON "device_activity" USING btree ("sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_device_uid_uq" ON "devices" USING btree ("user_id","device_uid");--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_push_tokens_expo_push_token_uq" ON "mobile_push_tokens" USING btree ("expo_push_token");--> statement-breakpoint
CREATE INDEX "mobile_push_tokens_user_revoked_idx" ON "mobile_push_tokens" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "notification_log_user_created_idx" ON "notification_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_log_request_created_idx" ON "notification_log" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_access_tokens_token_prefix_uq" ON "personal_access_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "personal_access_tokens_user_revoked_idx" ON "personal_access_tokens" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_event_id_uq" ON "session_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "session_events_user_received_idx" ON "session_events" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "session_events_device_received_idx" ON "session_events" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "session_events_session_received_idx" ON "session_events" USING btree ("session_id","received_at");--> statement-breakpoint
CREATE INDEX "session_events_event_type_received_idx" ON "session_events" USING btree ("event_type","received_at");--> statement-breakpoint
CREATE INDEX "session_projections_user_open_attention_idx" ON "session_projections" USING btree ("user_id","is_open","requires_attention","last_attention_at","last_event_at");--> statement-breakpoint
CREATE INDEX "session_projections_device_open_attention_idx" ON "session_projections" USING btree ("device_id","is_open","requires_attention","last_attention_at","last_event_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_supabase_user_id_uq" ON "users" USING btree ("supabase_user_id");