-- Purchasing policy: whether a delivery carried by a separate company must have that company's
-- own transport bill. NULL on a supplier override means "follow the company setting"; the
-- company row treats NULL as "not required". RLS, grants and triggers are unchanged.
ALTER TABLE "app"."purchasing_policies"
  ADD COLUMN "require_transport_bill" boolean;
