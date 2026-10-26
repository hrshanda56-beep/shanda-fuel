import {
  isPermissionGranted,
  type AccessScope,
  type AuthorizationActor,
  type PermissionCode,
} from '../../platform/security/permissions';

/**
 * What the person may change in setup, for showing or hiding the forms. This asks whether the
 * permission is held, not whether a fresh identity check is current: station.manage is a
 * high-risk permission, so asking the stricter question hid every form from an owner who had not
 * just re-verified, with a "no permission" message that was untrue. The commands still require
 * the fresh check, and the screen asks for it when someone saves.
 */
export function resolveSetupCapabilities(actor: AuthorizationActor, scope: AccessScope) {
  const can = (permissionCode: PermissionCode) =>
    isPermissionGranted({ actor, permissionCode, requestedScope: scope });
  return {
    capabilities: {
      products: can('station.manage'),
      tanks: can('inventory.tank.manage'),
      forecourt: can('station.manage'),
      shiftTemplates: can('shift.template.manage'),
      priceRequest: can('price.change.request'),
      priceApprove: can('price.change.approve'),
      priceActivate: can('price.change.activate'),
      suppliers: can('supplier.manage'),
    },
  };
}
