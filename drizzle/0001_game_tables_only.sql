CREATE TABLE IF NOT EXISTS "game_prices" (
	"race_date" date NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_name" text NOT NULL,
	"race_id" text,
	"odds_dec" real,
	"strength" real NOT NULL,
	"price_m" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_prices_race_date_snapshot_at_kind_subject_id_pk" PRIMARY KEY("race_date","snapshot_at","kind","subject_id")
);
CREATE TABLE IF NOT EXISTS "login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "stable_picks" (
	"stable_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_name" text NOT NULL,
	"race_id" text,
	"price_m" real NOT NULL,
	"points" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stable_picks_stable_id_kind_subject_id_pk" PRIMARY KEY("stable_id","kind","subject_id")
);
CREATE TABLE IF NOT EXISTS "stables" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"race_date" date NOT NULL,
	"nap_horse_id" text,
	"spend_m" real DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"points" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "game_prices" ADD CONSTRAINT "game_prices_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stable_picks" ADD CONSTRAINT "stable_picks_stable_id_stables_id_fk" FOREIGN KEY ("stable_id") REFERENCES "public"."stables"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stables" ADD CONSTRAINT "stables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "game_prices_card_idx" ON "game_prices" USING btree ("race_date","snapshot_at");
CREATE INDEX IF NOT EXISTS "game_prices_subject_idx" ON "game_prices" USING btree ("kind","subject_id");
CREATE INDEX IF NOT EXISTS "login_tokens_email_idx" ON "login_tokens" USING btree ("email","created_at");
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "stable_picks_stable_idx" ON "stable_picks" USING btree ("stable_id");
CREATE UNIQUE INDEX IF NOT EXISTS "stables_user_date_idx" ON "stables" USING btree ("user_id","race_date");
CREATE INDEX IF NOT EXISTS "stables_date_idx" ON "stables" USING btree ("race_date");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");
