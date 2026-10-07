# Phase 0.5 visual review artifacts

These screenshots were captured from the local Phase 0.5 application shell with
Playwright's screenshot CLI after the responsive, light-mode, and dark-mode
review pass.

| Artifact | Viewport | Scheme |
| --- | --- | --- |
| `today-390-dark.png` | 390 × 844 | dark |
| `today-390-light.png` | 390 × 844 | light |
| `today-768-light.png` | 768 × 1024 | light |
| `today-1440-light.png` | 1440 × 900 | light |
| `signin-390-light.png` | 390 × 844 | light |
| `signin-390-dark.png` | 390 × 844 | dark |

The browser review also covered the tablet drawer, mobile More hub, desktop
account and appearance menus, and the fixed mobile navigation bar.

## Entry and access acceptance set

The guarded local visual fixture captured each state at 390px and 1440px in
both light and dark themes:

- `entry-signin-*.png`
- `entry-no-authorised-context-*.png`
- `entry-unavailable-*.png`
- `entry-choose-context-*.png`

The fixture is test-only and production-disabled. It does not provide or
simulate authorization; it renders the already-defined presentation states so
their composition can be reviewed independently of local database availability.
