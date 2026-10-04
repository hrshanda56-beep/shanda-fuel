# Canonical work context

`src/modules/context` is the single public contract for the authorised
organisation → legal entity → station context tree.

## Consumers

- Server code reads `resolveCurrentContext(request)` from
  `@/modules/context/server`. It returns an authorised `available` tree, the
  route-aware `current` selection, and the route policy. A `null` current value
  means the authenticated actor has no usable context; it is not an implicit
  all-stations selection.
- `validateRequestedContext(request, selection, { pathname })` revalidates an
  incoming URL, cookie, form, or command-adjacent selection against live
  membership, scope, and RLS-backed rows.
- `contextRoutePolicy(pathname)` is the shared route declaration. Use
  `policy.station === 'required'` before any station command/read, require a
  legal entity when `policy.legalEntity === 'required'`, and use
  `policy.allStationsAllowed` before accepting `current.allStations === true`.
- `buildContextHref(pathname, search, validatedSelection)` is the only shared
  URL builder for context switching. It replaces dynamic station segments and
  preserves only valid context query dimensions for the route.
- The shared shell control is `ContextSelector` in
  `src/design-system/context-selector.tsx`. Feature modules must not create a
  second selector, read the context cookie, or trust client/local-storage IDs.

`ContextSelection.allStations` is explicit. `stationId` being absent does not
mean all stations. A station-required route can never be validated with
`allStations: true` or without a station id.

## Persistence and security boundary

The HTTP-only `shanda-fuel-context` cookie is only a preference hint. It stores
non-secret identifiers and is revalidated on every server resolution. Dynamic
station/legal-entity route context is authoritative for that request, but is
also revalidated; URL, cookie, query-string, client state, and local storage
never grant access. The internal files `queries.ts` and `persistence.ts` are
server-owned and must not be imported by browser components or modified by
feature agents.

The minimum browser integration is the read-only `GET /api/context` and the
validated `POST /api/context` switch operation. The endpoint returns safe
names/codes only; it never returns memberships, role assignments, secrets, or
database credentials.
