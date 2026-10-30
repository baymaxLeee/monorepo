# Completion review

For multi-phase or multi-service work, inspect the final affected diff before
handoff. This is the current procedure; its rationale is in the engineering decision.

1. Revisit the applicable playbook and every affected caller, including other
   stacks. Remove paths made obsolete by this change.
2. Check public recipes and, when affected, registration, deployment, generation,
   install and development entry points.
3. Examine failure/cleanup behavior and new duplicated logic. Tests must reject a
   plausible incorrect implementation, not just verify mock calls.
4. Update current documentation and topic decisions in place. Git preserves the
   replaced versions; task logs and old plans must not override current specs.
5. Run missing applicable checks on the final code. Reuse valid passing results;
   only changes or concrete gaps justify repeating them. Report missing tests,
   dependencies and unverified runtime boundaries honestly.

Summarize evidence and gaps in the conversation. Do not append task execution logs
to an ADR or create a separate review report.
