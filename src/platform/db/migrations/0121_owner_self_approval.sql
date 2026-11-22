-- Owners never wait on anyone (DEC-057). A delivery loss claim could not be approved by the person
-- who recorded it, enforced by a table check. That rule now has an owner exception, which a check
-- cannot express (it needs the approver's role), so the check is dropped and the approve command
-- enforces "someone else, unless an owner". Non-owners are still refused by the command.
-- Additive in effect: removes one constraint, changes no data. Local development databases only
-- until approved.

ALTER TABLE "app"."fuel_delivery_loss_claims"
  DROP CONSTRAINT IF EXISTS "fuel_delivery_loss_claims_other_person_ck";
