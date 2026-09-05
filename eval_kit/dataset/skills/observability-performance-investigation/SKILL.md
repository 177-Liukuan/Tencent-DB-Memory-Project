---
name: observability-performance-investigation
description: >
  Use when investigating latency, throughput, memory, CPU, metric cardinality, tracing gaps, SLO alerts, or performance regressions. The skill requires a reproducible baseline, measurement under the same workload, and evidence linking a change to the observed result.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: observability-performance
---

# Observability Performance Investigation

## When to Use

- Investigating a performance regression
- Adding or reviewing metrics and traces
- Diagnosing memory or resource leaks
- Defining SLO-based alerts

## Core Workflow

1. State the symptom and success metric.
2. Capture a reproducible baseline.
3. Instrument the suspected path with bounded-cardinality telemetry.
4. Change one primary factor.
5. Repeat the same workload and compare evidence.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Latency Regression | `references/latency-regression.md` | Read when the task directly involves this topic |
| Metric Cardinality | `references/metric-cardinality.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Use the same dataset and load profile before/after.
- Control metric label cardinality.
- Keep raw evidence and limitations.

### MUST NOT DO

- Claim improvement from a different workload.
- Put user IDs in metric labels.
- Optimize before identifying the bottleneck.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
