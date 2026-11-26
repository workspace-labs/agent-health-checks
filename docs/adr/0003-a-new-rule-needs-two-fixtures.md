# 0003. A new rule needs a fixture that fires and one that stays quiet

- Status: accepted
- Date recorded: 2026-11-26

## Context

A rule can miss a real problem. It can also report the same problem on a healthy input with a similar name or shape.

## Options weighed

One triggering example demonstrates detection. A nearby clean example also tests where the rule should stop.

## Decision

For each new rule, add a small fixture that produces its finding or notice code and a similar fixture where the code must be absent.

## Consequences

Both examples run in the ordinary test suite. A regression identifies whether the checker lost a finding or started raising a false alarm.
