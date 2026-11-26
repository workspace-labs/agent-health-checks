# 0002. Diagnosis is not treatment

- Status: accepted
- Date recorded: 2026-11-26

## Context

Both checkers inspect content supplied by others. Some findings identify a risk that needs human judgment, and the available evidence can change after a scan.

## Options weighed

Automatic repairs could save a step. They would also give an inspection of untrusted material the power to change somebody's work.

## Decision

Each checker ends with a read-only report. A person decides whether to authorize a separate repair.

## Consequences

The original evidence stays available for verification. A later scan can show what changed after an authorized repair.
