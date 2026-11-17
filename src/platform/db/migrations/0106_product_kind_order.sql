-- Fuel types get a kind and an optional explicit display order, so every screen can list Diesel
-- first, Petrol/Blend second and Gas third (client request) instead of sorting by name.
--
--   kind           DIESEL, D50, PETROL, BLEND, GAS or OTHER. NULL for rows that already exist: the
--                  kind is deliberately not guessed from the name. Those rows sort by name after
--                  the known kinds until someone sets the kind.
--   blend_percent  5, 10, 15 or 20; required when kind is BLEND and not allowed otherwise.
--   display_order  optional explicit position; NULL means "use the default rank of the kind".
--
-- Additive only: three nullable columns and three check constraints that every existing row
-- satisfies (all values are NULL). No default, no rewrite of existing data, no change to RLS,
-- grants or triggers on app.products.
ALTER TABLE app.products ADD COLUMN kind text;
--> statement-breakpoint
ALTER TABLE app.products ADD COLUMN blend_percent smallint;
--> statement-breakpoint
ALTER TABLE app.products ADD COLUMN display_order integer;
--> statement-breakpoint
ALTER TABLE app.products ADD CONSTRAINT products_kind_ck
  CHECK (kind IS NULL OR kind IN ('DIESEL', 'D50', 'PETROL', 'BLEND', 'GAS', 'OTHER'));
--> statement-breakpoint
ALTER TABLE app.products ADD CONSTRAINT products_blend_percent_ck
  CHECK (
    (kind = 'BLEND' AND blend_percent IN (5, 10, 15, 20))
    OR ((kind IS NULL OR kind <> 'BLEND') AND blend_percent IS NULL)
  );
--> statement-breakpoint
ALTER TABLE app.products ADD CONSTRAINT products_display_order_ck
  CHECK (display_order IS NULL OR display_order > 0);
