# Modular monolith modules

Each directory under this boundary owns one business capability. New work should normally stay inside a module's `domain`, `application`, `infrastructure`, `schema`, `ui`, and `tests` areas and expose only intentional contracts from its root `index.ts`.

Cross-module consumers use published contracts/application ports, never arbitrary deep imports or direct writes to another module's tables. A0 provides the shape; later workstreams own business behavior.
