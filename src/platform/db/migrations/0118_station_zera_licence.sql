-- ZERA monthly return (#258): the licence details the regulator's form asks for, kept once per station
-- and asked for in the station wizard. Additive only: six nullable columns on an existing table, so the
-- existing row-level security policies, grants and audit already cover them. Nothing is backfilled and
-- nothing is guessed. Local development databases until approved.

ALTER TABLE "app"."stations"
  ADD COLUMN "zera_licence_number" text,
  ADD COLUMN "zera_licence_holder" text,
  ADD COLUMN "zera_ownership" text,
  ADD COLUMN "zera_province" text,
  ADD COLUMN "zera_representative_name" text,
  ADD COLUMN "zera_representative_phone" text,
  ADD COLUMN "zera_representative_email" text;
--> statement-breakpoint
ALTER TABLE "app"."stations"
  ADD CONSTRAINT "stations_zera_licence_number_ck" CHECK (
    "zera_licence_number" IS NULL OR char_length("zera_licence_number") BETWEEN 1 AND 60
  ),
  ADD CONSTRAINT "stations_zera_licence_holder_ck" CHECK (
    "zera_licence_holder" IS NULL OR char_length("zera_licence_holder") BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT "stations_zera_ownership_ck" CHECK (
    "zera_ownership" IS NULL OR "zera_ownership" IN ('COCO', 'CODO', 'DODO')
  ),
  ADD CONSTRAINT "stations_zera_province_ck" CHECK (
    "zera_province" IS NULL OR "zera_province" IN (
      'Bulawayo', 'Harare', 'Manicaland', 'Mashonaland Central', 'Mashonaland East',
      'Mashonaland West', 'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands'
    )
  ),
  ADD CONSTRAINT "stations_zera_representative_name_ck" CHECK (
    "zera_representative_name" IS NULL OR char_length("zera_representative_name") BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT "stations_zera_representative_phone_ck" CHECK (
    "zera_representative_phone" IS NULL OR char_length("zera_representative_phone") BETWEEN 5 AND 40
  ),
  ADD CONSTRAINT "stations_zera_representative_email_ck" CHECK (
    "zera_representative_email" IS NULL OR (
      char_length("zera_representative_email") BETWEEN 3 AND 254
      AND "zera_representative_email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  );
