-- One cost pool per fuel (#314, DEC-058). A fuel can have more than one tank, and the tanks of one
-- fuel are treated as one for cost and stock: a sale is not taken from a named tank, so one tank can
-- be empty while another holds the fuel.
--
-- Each tank now names the tank its pool is kept on (cost_pool_tank_id). Every tank that exists today
-- is its own pool, so every stock, cost and sale figure stays exactly as it was. Only a tank added
-- later to a fuel that already has a tank joins that tank's pool.
--
-- The check that refuses negative stock now looks at the pool's total instead of one tank. For a tank
-- on its own the two are the same number, so the same movements are accepted or refused as before.
-- Local development databases until approved.

ALTER TABLE "app"."tanks" ADD COLUMN "cost_pool_tank_id" uuid;
--> statement-breakpoint
-- Backfill (the table is FORCE row security, so the owner needs it off for this one statement).
ALTER TABLE "app"."tanks" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "app"."tanks" SET "cost_pool_tank_id" = "id";
--> statement-breakpoint
ALTER TABLE "app"."tanks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."tanks" ALTER COLUMN "cost_pool_tank_id" SET NOT NULL;
--> statement-breakpoint
-- A pool is made of tanks of one fuel at one station: the pool tank must be the same station and fuel.
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_cost_pool_fk"
  FOREIGN KEY ("tenant_id", "station_id", "cost_pool_tank_id", "product_id")
  REFERENCES "app"."tanks" ("tenant_id", "station_id", "id", "product_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "tanks_cost_pool_idx" ON "app"."tanks" ("tenant_id", "station_id", "cost_pool_tank_id");
--> statement-breakpoint

-- A tank that is added without naming a pool is its own pool.
CREATE OR REPLACE FUNCTION app.tanks_default_cost_pool()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cost_pool_tank_id IS NULL THEN
    NEW.cost_pool_tank_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tanks_default_cost_pool_trg BEFORE INSERT ON app.tanks
  FOR EACH ROW EXECUTE FUNCTION app.tanks_default_cost_pool();
--> statement-breakpoint

-- A tank's pool cannot change once the tank has stock history: its movements and costs were
-- priced in that pool.
CREATE OR REPLACE FUNCTION app.tanks_cost_pool_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cost_pool_tank_id IS DISTINCT FROM OLD.cost_pool_tank_id AND EXISTS (
    SELECT 1 FROM app.inventory_movements
    WHERE tenant_id = OLD.tenant_id AND station_id = OLD.station_id AND tank_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'a tank with stock history cannot move to another cost pool';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tanks_cost_pool_guard_trg BEFORE UPDATE ON app.tanks
  FOR EACH ROW EXECUTE FUNCTION app.tanks_cost_pool_guard();
--> statement-breakpoint

-- The stock check looks at the whole pool. The pool's own tank is locked, so two people posting at
-- the same moment queue up instead of both passing the check. For a tank on its own that is the
-- same tank that was locked before.
CREATE OR REPLACE FUNCTION app.a4_prevent_negative_stock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance numeric(18,3);
  pool_tank uuid;
BEGIN
  SELECT cost_pool_tank_id INTO pool_tank FROM app.tanks
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = NEW.tank_id;
  PERFORM 1 FROM app.tanks
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = pool_tank FOR UPDATE;
  SELECT COALESCE(SUM(m.quantity_litres), 0) INTO balance
  FROM app.inventory_movements m
  JOIN app.tanks t ON t.tenant_id = m.tenant_id AND t.station_id = m.station_id AND t.id = m.tank_id
  WHERE m.tenant_id = NEW.tenant_id AND m.station_id = NEW.station_id
    AND t.cost_pool_tank_id = pool_tank;
  IF balance < 0 THEN RAISE EXCEPTION 'inventory movement would create negative stock'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.tanks_default_cost_pool() OWNER TO migration_owner;
    ALTER FUNCTION app.tanks_cost_pool_guard() OWNER TO migration_owner;
  END IF;
END
$$;
