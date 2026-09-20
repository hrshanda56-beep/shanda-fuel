CREATE TABLE "auth"."account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"revoked_at" timestamp,
	"strong_authenticated_at" timestamp,
	"strong_authentication_expires_at" timestamp,
	"strong_authentication_verified" boolean,
	"step_up_level" integer,
	"step_up_expires_at" timestamp,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth"."account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_uidx" ON "auth"."account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth"."verification" USING btree ("identifier");

-- Auth tables are structurally owned by migration_owner; runtime credentials
-- receive only the persistence privileges required by Better Auth.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER SCHEMA auth OWNER TO migration_owner;
    ALTER TABLE auth."user" OWNER TO migration_owner;
    ALTER TABLE auth.session OWNER TO migration_owner;
    ALTER TABLE auth.account OWNER TO migration_owner;
    ALTER TABLE auth.verification OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT USAGE ON SCHEMA auth TO app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth."user", auth.session, auth.account, auth.verification TO app_runtime;
    REVOKE TRUNCATE, TRIGGER, REFERENCES ON auth."user", auth.session, auth.account, auth.verification FROM app_runtime;
  END IF;
END
$$;
