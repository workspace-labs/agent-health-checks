# 0001. Two checkers, not one

- Status: accepted
- Date recorded: 2026-11-26

## Context

Installed skills can compete for the same request. A project can contain broken imports. Each question needs different input and evidence.

## Options weighed

A single command could combine both reports. Separate commands let someone choose a set of skill folders or one project and get a verdict for that input.

## Decision

Keep Skills Checker and Project Checker independently installable, each with its own entry point, guide and report contract.

## Consequences

Use Skills Checker for an agent's toolbox and Project Checker for project code. An agent can offer the other checker when a follow-up question needs its evidence.
