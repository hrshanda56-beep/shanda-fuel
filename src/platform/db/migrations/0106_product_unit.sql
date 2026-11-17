-- Each fuel is measured in its own unit: petrol and diesel in litres, gas in kilograms. Every fuel
-- that exists today is measured in litres, so the default keeps them exactly as they were.
ALTER TABLE app.products
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'LITRES';

ALTER TABLE app.products
  DROP CONSTRAINT IF EXISTS products_unit_check;
ALTER TABLE app.products
  ADD CONSTRAINT products_unit_check CHECK (unit IN ('LITRES', 'KILOGRAMS'));
