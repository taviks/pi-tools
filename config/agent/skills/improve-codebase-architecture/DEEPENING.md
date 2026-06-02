# Deepening

Deepening means changing a cluster of modules so more behavior sits behind a smaller or clearer **Interface**, with better **Locality** and **Leverage**.

Use this document to classify dependencies and choose a testing strategy.

## Dependency categories

| Category | Examples | Deepening strategy | Test strategy |
| --- | --- | --- | --- |
| In-process | pure functions, in-memory state, validation, formatting, policy | Merge or reorganize shallow modules behind one deeper interface. Usually no external adapter. | Test behavior directly through the new module interface. |
| Local-substitutable | filesystem, SQLite/PGLite/local Postgres, in-memory queues, local clock/random providers | Put behavior in the deep module. Keep substitution internal unless callers truly need variation. | Test with the local stand-in or deterministic internal adapter. |
| Remote but owned | internal HTTP/gRPC service, owned worker, owned message consumer | Put domain logic in one deep module. Define a port at the seam only where transport/deployment varies. | Use an in-memory adapter or contract-tested fake for tests; production uses transport adapter. |
| True external | Stripe, Twilio, LLM provider, external identity provider, partner API | Keep external uncertainty behind an injected port. Avoid letting vendor details leak to callers. | Use mock/fake adapters plus contract/smoke tests where appropriate. |

## How to classify

Ask:

1. Does the dependency do I/O?
2. Can the test suite run a faithful local stand-in?
3. Is the remote dependency owned by the same organization/codebase?
4. Does the dependency's behavior vary in production or only in tests?
5. Would exposing this dependency in the external interface improve leverage or just leak implementation?

## Seam discipline

- Do not introduce a port merely because a dependency exists.
- A test fake can justify a seam when the real dependency is remote or non-deterministic.
- For local-substitutable dependencies, prefer testing with the substitute instead of exposing a port to callers.
- Keep internal seams internal unless callers need them.
- If there is only one real adapter and no durability/ownership reason, suspect unnecessary indirection.

## Testing strategy: replace, do not layer forever

When a deepened module interface has adequate behavior tests:

- move caller tests up to observable behavior,
- delete or simplify old shallow-module unit tests that duplicate coverage,
- avoid tests that assert private call order or internal object shape,
- keep focused tests for tricky internal algorithms only when they add signal.

The goal is not more tests. The goal is tests that survive implementation refactors.

## Deepening readiness checklist

Before recommending implementation, answer:

- What facts do callers currently need that they should not need?
- Which behavior would sit behind the new interface?
- Which callers become simpler?
- Which tests become more stable?
- Which dependencies are in-process, local-substitutable, remote-owned, or true external?
- What adapter(s), if any, are justified?
- What old tests or modules might be deleted after replacement coverage exists?

## Common failure modes

- Creating a “service” that only forwards calls.
- Adding an interface for a single implementation with no variation.
- Moving code without moving responsibility.
- Extracting pure functions for easy tests while leaving orchestration bugs in callers.
- Making tests pass by exposing internal seams as public interface.
- Hiding domain language behind technical nouns like “manager”, “helper”, “processor”, or “handler”.
