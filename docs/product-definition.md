# Onto: product definition

Onto is an evidence-first architecture explorer for distributed software systems. It turns technical artifacts into a reviewable world model that humans and AI agents can query without treating semantic guesses as ground truth.

## First user outcome

An engineer can open a commerce-system snapshot, see domains and services, trace an operational path, select an assertion, and understand exactly which artifact supports it.

## Invariants

- Facts are observations and retain provenance.
- Inferences and graph assertions retain their supporting facts.
- Ontology definitions are versioned separately from graph instances.
- Canvas position is presentation state and never changes graph meaning.
- Bounded neighborhood queries protect the client from whole-world rendering.

## First slice boundary

The shipped slice implements deterministic OpenAPI and system-manifest extraction, graph projection, system/ontology views, filters, path focus, evidence inspection, layout persistence, and a local re-run workflow. LLM induction, authentication, semantic edits, proposal review, runtime evidence, and source-code parsing follow once the deterministic contracts are stable.
