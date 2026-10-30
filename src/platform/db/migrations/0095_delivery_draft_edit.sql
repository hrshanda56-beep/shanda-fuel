-- A delivery that is still a draft can have its details corrected, including which tank takes the
-- fuel and how many litres were received. That changes the delivery's one allocation row, which the
-- application role could only insert until now.
--
-- Only UPDATE is granted (never DELETE). The existing trigger fuel_delivery_allocations_status_guard
-- still rejects any change once the delivery is confirmed or cancelled, and
-- fuel_delivery_allocations_total_guard still rejects allocations that exceed the litres received.
-- Row level security is unchanged. Nothing existing is altered, so this is safe to apply repeatedly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT UPDATE ON app.fuel_delivery_allocations TO app_runtime;
  END IF;
END
$$;
