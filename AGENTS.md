# Project Instructions: Order Fulfillment Automation Platform

## 1. Project Overview

Build a modular, type-safe, versioned order fulfillment platform that automates the operations occurring after a customer places an order on a Shopify store.

The system is responsible for receiving order events, validating requests, preventing duplicate processing, allocating inventory across warehouses, determining fulfillment strategies, selecting shipping options, tracking shipments, and presenting fulfillment progress through a dashboard.

Returns are part of the long-term product scope but are explicitly out of scope for the initial implementation.

### Core engineering objectives

Every implementation must prioritize:

1. **Correctness and reliability:** Prevent unauthorized operations, duplicate processing, invalid inventory allocations, and inconsistent shipment states.
2. **Modularity:** Keep responsibilities separated into clearly defined, reusable modules.
3. **Type safety:** Use explicit types and runtime validation at system boundaries.
4. **Version isolation:** Allow new API, schema, function, and dashboard versions to evolve without rewriting or breaking existing versions.
5. **Architectural consistency:** Follow one documented implementation pattern within each version.
6. **Maintainability:** Keep the codebase understandable, testable, and free from unnecessary abstraction.
7. **Business configurability:** Allow different businesses to configure their fulfillment policies without rewriting the core fulfillment engine.

These are architectural requirements, not optional preferences.

---

## 2. Order Fulfillment Lifecycle

Understand the complete business workflow before implementing individual features. Each stage must have a clearly defined responsibility, input, output, and failure-handling strategy.

### Stage 1: Order Creation and Webhook Reception

1. A customer places an order on a Shopify store.
2. Shopify sends an order-related webhook to the Hono API.
3. The API receives the request and identifies the relevant store, event type, and request metadata.
4. The API verifies the webhook signature using Shopify's documented HMAC verification mechanism and the appropriate store secret.
5. The request is validated against the schema associated with its API or event version.

Reject invalid or unauthorized requests before allowing them to trigger fulfillment operations.

### Stage 2: Authentication, Authorization, and Idempotency

Implement the following concerns as distinct responsibilities:

- **Webhook verification:** Establish that the request originated from a trusted sender and has not been altered.
- **Authentication:** Identify the requesting principal or integration where applicable.
- **Authorization:** Determine whether that principal is permitted to perform the requested operation.
- **Idempotency:** Ensure that retries or duplicate deliveries do not cause the same logical operation to execute more than once.

For webhook processing:

1. Identify the event using the appropriate stable event identifier, delivery identifier, or business-level idempotency key.
2. Persist the identifier and relevant processing metadata in the database using an atomic operation and a database-enforced uniqueness constraint where appropriate.
3. Reject or safely acknowledge duplicate deliveries according to the webhook processing contract.
4. Prevent unauthorized or invalid requests from entering the fulfillment workflow.
5. Record the event's processing state so that failures and retries can be handled reliably.

Do not assume that storing a request ID alone guarantees idempotency. Define the uniqueness scope, transaction boundaries, retry behavior, and handling of concurrent deliveries.

Webhook authenticity, application authentication, and authorization must not be treated as interchangeable mechanisms.

### Stage 3: Background Workflow Processing

Once the request has passed the required verification and validation checks, hand off the work to background workflows.

Use the project's configured workflow infrastructure to execute long-running or retryable operations outside the synchronous API request.

The workflow should receive a validated, versioned input or a durable reference to persisted event data. It must not depend on an in-memory HTTP request remaining available.

Background processing must support:

- Reliable retries and failure recovery.
- Idempotent execution of relevant operations.
- Explicit workflow and shipment states.
- Structured logging and traceable execution.
- Handling of partial failures.
- Safe coordination of concurrent operations.

A successfully accepted webhook must not be confused with a successfully completed fulfillment operation.

### Stage 4: Inventory Evaluation and Warehouse Allocation

The fulfillment engine must determine which warehouses can fulfill an order based on product availability.

1. Retrieve the relevant order lines and quantities.
2. Retrieve inventory availability for eligible warehouses.
3. Exclude warehouses that cannot satisfy the relevant product quantities or other mandatory constraints.
4. Calculate feasible warehouse allocations for the order.
5. Identify whether one warehouse can fulfill the complete order.
6. If no single warehouse can fulfill the complete order, evaluate allocations across multiple warehouses.
7. Produce explicit fulfillment groups that map products and quantities to their assigned warehouses.

The allocation logic must account for quantities, not merely whether a warehouse contains a product.

For example, if an order requires five units of a product and a warehouse has only three available units, that warehouse cannot independently fulfill all five units.

Inventory availability must be defined consistently. Account for reservations, concurrent orders, and inventory changes according to the chosen inventory model.

The allocation engine should produce feasible candidates rather than silently choosing a final commercial shipping decision.

### Stage 5: Fulfillment Group Consolidation and Route Evaluation

After generating feasible warehouse allocations, evaluate whether products or fulfillment groups can be consolidated into fewer shipments or alternative warehouse combinations.

Consider the following illustrative scenarios:

- **Scenario A:** One warehouse contains all required products but is 50 km from the delivery destination.
- **Scenario B:** Two warehouses can provide the required products, with distances of 10 km and 20 km from the destination.
- **Scenario C:** Three warehouses must contribute different products, and each is approximately 70 km from the destination.
- **Scenario D:** Several allocations are feasible, but their shipping costs, delivery estimates, inventory constraints, and operational implications differ.

These scenarios illustrate possible candidates, not predetermined decisions.

The system must distinguish among:

- Inventory allocation.
- Fulfillment group consolidation.
- Warehouse selection.
- Shipment planning.
- Carrier and service selection.

Each stage should consume a defined input and produce a typed result.

Do not assume that the shortest distance necessarily represents the lowest-cost, fastest, or most profitable fulfillment strategy. Actual decisions may depend on carrier pricing, warehouse operating costs, delivery zones, service availability, handling costs, and other business constraints.

### Stage 6: Business Policy and Financial Viability

Different businesses may use different policies to determine whether a fulfillment candidate is commercially viable.

The system must support an explicit decision policy rather than hardcoding a universal answer into the fulfillment engine.

Potential policy approaches include:

**Rule-based decisions**

Evaluate predefined conditions such as maximum shipping cost, maximum delivery time, minimum margin, preferred warehouses, or permitted shipment counts.

**AI-assisted decisions**

Use AI to evaluate or rank feasible candidates when business requirements justify it. AI recommendations must respect hard constraints and provide sufficient information for the decision to be understood and audited.

**Human approval**

Send ambiguous, expensive, exceptional, or commercially sensitive decisions to an authorized person.

These approaches may be combined.

The applicable policy must be configurable where appropriate. AI must not independently authorize financial commitments or override mandatory business constraints unless an explicitly authorized policy permits that behavior.

When a decision requires human approval, the workflow must preserve its state, record the relevant candidates, and resume safely after approval or rejection.

### Stage 7: Customer Preferences and Shipping Strategy

Once feasible warehouse allocations have been established and the applicable business policy has been evaluated, consider the customer's shipping preferences.

Examples include:

- Lowest available shipping cost.
- Fastest available delivery.
- A balance between cost and delivery speed.
- Specific shipping services or delivery constraints.
- Other store-defined preferences and eligibility rules.

Customer preferences must be considered alongside mandatory business constraints, warehouse capabilities, inventory availability, and carrier service availability.

If a preference cannot be satisfied, apply the configured fallback or escalation policy rather than silently violating a requirement.

### Stage 8: Shipment and Carrier Selection

Choose the appropriate shipment configuration based on the selected fulfillment groups and the applicable business rules.

The process may include:

1. Selecting eligible carriers and shipping services.
2. Retrieving rates and delivery estimates.
3. Comparing available options.
4. Applying business rules and customer preferences.
5. Creating shipments through the appropriate carrier integration.
6. Persisting shipment identifiers, carrier information, tracking numbers, and shipment state.
7. Handling carrier errors, timeouts, and uncertain outcomes safely.

Keep carrier-specific API details inside the relevant integration modules. The fulfillment domain must not depend directly on a particular carrier's request or response format.

The number of fulfillment groups does not necessarily equal the number of packages or tracking numbers. Model these relationships explicitly.

### Stage 9: Tracking, Notifications, and Dashboard

After shipment creation, the system must maintain an up-to-date view of fulfillment progress.

1. Receive tracking updates from carrier webhooks or other supported tracking mechanisms.
2. Verify and validate incoming events.
3. Process duplicate and out-of-order events safely.
4. Update the relevant shipment state.
5. Persist the relationship between the shipment, fulfillment group, and original order.
6. Notify the appropriate users when relevant events occur.
7. Expose authorized order and shipment information through the dashboard API.

The dashboard should allow authorized users to inspect fulfillment progress, including relevant information for customers, store owners, managers, and operational staff.

The UI must represent the actual persisted state. Do not imply that a shipment has been dispatched, delivered, or otherwise completed without reliable supporting evidence.

Use explicit authorization and tenant or store isolation when exposing order and shipment information.

### Stage 10: Returns — Future Scope

Returns will be implemented as a separate business workflow after the initial fulfillment lifecycle is established.

Potential future responsibilities include:

- Return eligibility and policy evaluation.
- Return authorization.
- Return shipment creation and tracking.
- Returned inventory receipt and inspection.
- Restocking decisions.
- Refunds or replacements.
- Return-related notifications and audit records.

Do not implement the returns subsystem as part of the initial scope unless explicitly instructed. Design the current architecture so that returns can be introduced without unnecessarily coupling them to the existing fulfillment implementation.

---

## 3. Repository Architecture

The project must be built inside a Turborepo monorepo.

Use the following high-level organization:

- `apps/` — deployable applications.
- `packages/` — reusable modules, contracts, domain logic, integrations, and shared infrastructure.

At minimum, the application layer will contain:

- The Hono API.
- The web dashboard.
- Any additional deployable application explicitly required by the project.

The shared packages layer will contain reusable functionality organized by responsibility.

Examples include:

- `packages/domain/` — domain entities, value objects, business invariants, and domain-level types.
- `packages/application/` — use cases and application orchestration.
- `packages/integrations/` — external API and service integrations.
- `packages/contracts/` — shared request, response, and event contracts where appropriate.
- `packages/infrastructure/` — database access and other technical infrastructure, if required by the established architecture.

These names are illustrative. Inspect the actual repository and its existing conventions before creating or restructuring directories.

**Every directory may contain an `INSTRUCTIONS.md` file.** Read the relevant instructions before modifying files within that directory. Follow their requirements alongside this document.

Do not invent a parallel architecture when the repository already defines an appropriate one.

### Separation of responsibilities

Maintain clear boundaries between:

- HTTP transport and request handling.
- Authentication, authorization, and signature verification.
- Runtime validation and public contracts.
- Application use cases and workflow orchestration.
- Domain rules and fulfillment decisions.
- Database access and persistence.
- External service integrations.
- Background execution.
- Dashboard presentation and client-side state.

An API route should not contain the entire fulfillment algorithm. A carrier integration should not decide general warehouse allocation policy. A dashboard component should not independently reimplement domain business rules.

Expose reusable functionality through well-defined package interfaces rather than copying business logic across applications.

---

## 4. Mandatory Versioning Strategy

Versioning is a fundamental architectural requirement.

Every externally consumed API contract and every version-specific interface must be identifiable, documented, tested, and compatible with the versions that depend on it.

The goal is to allow new functionality to evolve without rewriting existing versions or accidentally changing their behavior.

### 4.1 API versioning

Organize API implementations by explicit version.

For example:

`apps/api/src/v1/`

`apps/api/src/v2/`

Each API version must contain or reference the appropriate version-specific routes, request and response contracts, validation schemas, and handlers.

The exact folder structure must follow the API's `ARCHITECTURE.md` documentation.

A new API version must not silently replace the implementation of an existing version.

For example, if V1 exposes an endpoint that creates a database record using a particular payload, a new payload or materially different behavior must be introduced through the appropriate versioned contract and implementation.

V1 must continue to operate according to its documented contract until it is explicitly deprecated or retired under an approved migration plan.

### 4.2 Version-specific functions

Version-sensitive functions must be organized so that each API version can evolve independently.

For example:

- `packages/application/src/v1/`
- `packages/application/src/v2/`

A version-specific function must not be modified in a way that unexpectedly changes the behavior of an older API version.

When a new API version requires a different function contract or implementation, create a new versioned function rather than rewriting the existing one.

For strict version isolation, each API version must have its own version-specific function entry points, even when the initial payloads are identical.

Unchanged, low-level internal utilities may be shared only when they do not introduce coupling between versioned contracts or cause an older version's behavior to change. Do not duplicate every generic utility merely for the appearance of versioning.

Each versioned function must have explicit input and output types and a clear responsibility.

### 4.3 Version-specific validation schemas

Use Zod for runtime validation where it is the established project standard.

Maintain separate validation schemas for different public API versions and version-sensitive function contracts.

For example:

- `packages/contracts/src/v1/`
- `packages/contracts/src/v2/`

A new schema must not overwrite an older schema when the expected payload, validation rules, or response contract changes.

Schemas must remain consistent with their corresponding types, functions, routes, and tests.

Validation must occur at appropriate system boundaries. TypeScript types alone do not validate incoming HTTP requests, webhook payloads, or external API responses at runtime.

### 4.4 Version-specific tests

Maintain tests that correspond to each versioned contract and implementation.

Examples include:

- V1 API route tests.
- V1 request and response validation tests.
- V1 function tests.
- V1 integration contract tests.
- V1 dashboard compatibility tests where applicable.

New versions must receive their own tests for their intended behavior.

Changes to a newer version must not cause older-version tests to fail unless an explicitly approved compatibility change requires it.

Test shared internal utilities according to their own contracts, while ensuring that every public version remains covered.

### 4.5 Database compatibility and migrations

Database schemas and migrations must be managed separately from application API versioning.

Do not create a new database schema or migration solely because an API version number changes.

Instead, design database changes so that existing API versions can continue operating safely during the transition.

Use backward-compatible migration strategies where necessary, such as introducing new fields before migrating consumers or retiring old fields.

A change to a public API contract, a database schema, or an internal function must be versioned according to its own compatibility requirements.

### 4.6 Dashboard versioning

Dashboard versions must follow a consistent and documented architecture.

When a new dashboard version requires different API contracts, state management, component behavior, or layouts, preserve the existing version where compatibility is required.

Do not silently rewrite older dashboard implementations to accommodate a new API version.

Each dashboard version must clearly identify the API contract it consumes.

Shared UI primitives may be reused when doing so does not create unintended coupling between version-specific behavior.

### 4.7 Integration versioning

External integrations must have explicit, typed interfaces and version-specific implementations when their contracts or behavior change.

For example, a carrier integration or database-facing application function must not be modified in a way that breaks an older API version.

Keep provider-specific payloads and response formats isolated within their integration boundaries. Translate them into stable internal types before passing data into the domain or application layers.

### 4.8 Compatibility rules

For every versioned component, document:

- Its purpose and public interface.
- Its input and output types.
- Its validation requirements.
- Its dependencies.
- The versions of other components it supports.
- Its error-handling behavior.
- Its testing strategy.
- Its deprecation or migration requirements, if applicable.

Never assume that two components are compatible simply because their TypeScript types currently compile.

Compatibility must be established through documented contracts and appropriate tests.

---

## 5. Architectural Consistency Within Each Version

Each version must follow one coherent implementation pattern.

For example, if V1 uses a particular approach for API routing, request validation, authentication, error handling, and response serialization, all V1 endpoints must follow that approach unless a documented exception is necessary.

The same principle applies to dashboard versions, background workflows, integrations, and shared packages.

### Required documentation

Each major application or independently versioned subsystem must have an `ARCHITECTURE.md` file.

Document the following where relevant:

1. The architectural pattern used.
2. The directory and file organization.
3. Naming conventions.
4. The request or data flow.
5. Dependency boundaries.
6. Validation and type definitions.
7. Authentication and authorization.
8. Error handling and logging.
9. Versioning and compatibility rules.
10. Testing conventions.
11. How to add a new feature without breaking existing code.

A developer or AI coding agent should be able to read the architecture document and understand how to implement another feature using the established pattern.

Do not document only what the system does. Explain how its components are organized and how new code is expected to follow the same conventions.

If an architectural change becomes necessary, update the relevant documentation and migrate the affected code deliberately rather than mixing competing patterns within one version.

---

## 6. Type Safety and Reusable Modules

The entire codebase must use clear, explicit types and modular interfaces.

Every reusable function should have a well-defined responsibility, typed inputs, typed outputs, and predictable error behavior.

Where practical, use TypeScript's type inference to reduce unnecessary annotations while keeping public interfaces explicit and understandable.

### Type safety requirements

- Define explicit types for public function parameters and return values.
- Validate untrusted runtime data with appropriate schemas.
- Keep external provider types separate from internal domain types.
- Avoid `any` and unsafe type assertions unless there is a documented justification.
- Use discriminated unions for stateful workflows and other cases where they improve correctness.
- Represent failure conditions explicitly rather than hiding them in loosely typed return values.
- Ensure editor autocomplete and compile-time checks work across package boundaries.
- Keep package exports intentional and well-defined.

Types and validation schemas must describe the same contract. Where supported by the project's tooling, infer TypeScript types from Zod schemas to reduce duplication and prevent inconsistencies.

### Reusability requirements

A reusable capability should be callable from the appropriate application or subsystem without copying its implementation.

For example, external service integrations should live in integration packages, while reusable business operations should live in the appropriate application or domain package.

A function should not depend on a specific HTTP route, dashboard component, or execution environment unless that dependency is explicitly part of its responsibility.

Do not force every module into a universal interface. Design interfaces around actual responsibilities and stable boundaries.

The objective is reusable, well-typed software—not abstraction for its own sake.

---

## 7. Security and Reliability Standards

Security-sensitive behavior must be implemented consistently within each version.

This includes:

- Webhook signature verification.
- Authentication and authorization.
- Input validation.
- Tenant and store isolation.
- Database access controls.
- Idempotency.
- Secret management.
- Error handling.
- Auditability of important operations.

Use the appropriate mechanism for each security boundary. Do not treat successful payload validation as proof of authenticity or authorization.

For background workflows, use durable state and explicit retry policies. Account for concurrent execution, duplicate events, partial completion, and failures occurring after an external service has accepted a request.

For database operations, use transactions and database constraints where required to preserve invariants.

Never log credentials, access tokens, webhook secrets, or unnecessary sensitive customer information.

Security and reliability mechanisms should be reusable where appropriate, documented, and covered by tests.

---

## 8. Integration and Connector Organization

External APIs, databases, and third-party services must be accessed through clearly organized modules.

For example, if the system integrates with Shopify, multiple shipping carriers, a notification provider, and a mapping or distance service, organize these integrations by provider or capability under the established integration package.

Each integration should define:

- Its public interface.
- Input and output types.
- Provider-specific request and response handling.
- Authentication and configuration requirements.
- Runtime validation of untrusted responses where appropriate.
- Timeout and retry behavior.
- Error translation.
- Logging and observability requirements.
- Relevant tests.

Keep provider-specific implementation details out of the core fulfillment domain.

For example, the fulfillment engine should request eligible shipping options through an internal interface rather than directly constructing requests for a specific carrier API.

When replacing or adding a provider, the system should require minimal changes to unrelated application and domain code.

Reuse existing connectors and shared capabilities when they satisfy the requirements. Do not create duplicate integrations or slightly different copies of the same functionality.

---

## 9. Change Tracking and Documentation

Maintain a root-level file named `changes.md`.

**Every project modification must be recorded in this file.**

Update it whenever you create, modify, remove, or restructure code, configuration, documentation, schemas, tests, or other project artifacts.

Each entry should clearly state:

- What changed.
- Why the change was necessary.
- Which modules or versions were affected.
- Any contract, schema, or migration implications.
- The tests or verification performed.
- Any known limitations or follow-up work.

Keep entries concise but sufficiently detailed to understand the history of the project.

Do not claim that tests passed unless they were actually executed and their results were verified.

Preserve existing entries. Do not replace the entire change history with a summary of the latest work.

Update `ARCHITECTURE.md` and relevant `INSTRUCTIONS.md` files whenever implementation changes affect their documented conventions or responsibilities.

---

## 10. AI Coding Agent Operating Procedure

Before making any code changes, follow this procedure.

### Step 1: Inspect the repository

- Examine the Turborepo structure.
- Read the root-level project instructions and relevant directory-level `INSTRUCTIONS.md` files.
- Read the relevant `ARCHITECTURE.md` files.
- Identify existing package boundaries, versioning conventions, tests, and scripts.
- Locate existing implementations before creating new ones.

Do not assume that the repository is empty or that the illustrative folder structure in this document matches its current implementation.

### Step 2: Define the change

Before implementation, determine:

- The business or technical requirement.
- The existing components involved.
- The API, function, schema, integration, and dashboard versions affected.
- The required compatibility guarantees.
- The expected failure cases.
- The tests needed to verify the change.

Prefer the smallest complete implementation that satisfies the requirement.

### Step 3: Implement consistently

- Follow the established architecture for the relevant version.
- Reuse existing modules when appropriate.
- Keep responsibilities separated.
- Preserve existing contracts.
- Introduce new versioned implementations when required.
- Add explicit types and runtime validation.
- Avoid unrelated refactoring.
- Update documentation when necessary.

Do not introduce a new architectural pattern merely because it seems preferable without evaluating its impact on the existing codebase.

### Step 4: Verify the implementation

Run the relevant available checks, including:

- Type checking.
- Linting.
- Unit tests.
- Integration tests where applicable.
- API contract and validation tests.
- Compatibility tests for affected older versions.
- Build checks for affected applications and packages.

Inspect the results and resolve regressions introduced by the change.

If a check cannot be run, state the reason explicitly. Never report an unexecuted check as successful.

### Step 5: Record the change

Update `changes.md` and any affected architectural documentation.

Ensure that the recorded changes match the actual implementation and verified test results.

### Step 6: Report completion

When finishing a task, provide a concise summary of:

1. What was implemented.
2. Which files, packages, or versions were affected.
3. What tests and checks were executed.
4. Whether backward compatibility was preserved.
5. Any unresolved issues or required follow-up work.

Do not claim completion if critical implementation or verification steps remain unfinished.

---

## 11. Code Quality and Design Constraints

The codebase must remain simple, consistent, and easy to navigate as it grows.

Avoid:

- Duplicated business logic.
- Monolithic API handlers.
- Circular dependencies between packages.
- Unnecessary abstractions and excessive indirection.
- Inconsistent naming and error-handling patterns.
- Hidden coupling between API versions.
- Direct provider-specific logic inside domain modules.
- Uncontrolled changes to shared functions.
- Excessive folder nesting without a clear purpose.
- Rewriting existing versions when introducing new behavior.
- Documentation that no longer matches the code.

Prefer:

- Small, cohesive modules.
- Explicit public interfaces.
- Clear dependency direction.
- Predictable data flow.
- Consistent naming conventions.
- Typed contracts and validated boundaries.
- Reusable integrations.
- Focused tests.
- Documented architectural decisions.
- Backward-compatible evolution.

Do not optimize for maximum abstraction or minimum line count. Optimize for correctness, clarity, consistency, and maintainability.

---

## 12. Final Decision Rule

Whenever implementing a feature, use the following order of priorities:

1. Preserve security and business correctness.
2. Preserve existing version contracts and behavior.
3. Follow the documented architecture.
4. Reuse appropriate existing capabilities.
5. Introduce new versioned contracts or implementations where required.
6. Add appropriate tests and verification.
7. Update `changes.md` and relevant documentation.
8. Report the verified outcome accurately.

If a requirement conflicts with an existing architectural rule, do not silently choose one or introduce an undocumented exception. Identify the conflict, evaluate its impact, and seek clarification when the decision materially affects compatibility or system design.

The final objective is a production-oriented fulfillment platform in which every component has a clear responsibility, every public contract is explicit, every version remains predictable, and new functionality can be added without turning the codebase into an inconsistent collection of interconnected implementations.
