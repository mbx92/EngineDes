# Architecture

This directory stores implementation-facing architecture documentation that belongs close to the code.

Notion remains the product/architecture source of truth. Local documents should explain code-level realization and link back to requirement/ADR IDs rather than creating conflicting product rules.

## Core boundaries
- Core Platform
- Business Capabilities
- Business Modules
- Accounting Mapping / Business Events

## Financial invariant
Business Module -> Business Event -> Core Services -> Accounting Mapping -> Accounting Engine -> Reporting.

Do not introduce a module-specific ledger or hard-coded account mapping.
