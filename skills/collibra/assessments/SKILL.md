# Assessments Lifecycle Workflow

Conduct, fill in, and submit Collibra assessments (e.g. AI use-case reviews, privacy impact assessments).

## When to use

- The user wants to run/conduct an assessment against an asset
- Answering or reviewing questions on an existing assessment
- Submitting or retaking an assessment

## Steps

1. **`list_assessment_templates`** — find the template (filter by name; note `retakePermission`).
2. **`create_assessment`** — instantiate from the template, optionally linked to an asset (e.g. an AI Use Case). The response includes the unanswered questions with their `questionId`s.
3. **`edit_assessment`** — answer questions with typed `set_answer` ops (by `questionId`; the answer type is inferred for already-answered questions, otherwise pass `answer_type`). Batch multiple answers in ONE call — the PATCH is atomic.
4. Review with **`get_assessment`** — verify all required questions are answered.
5. Submit via **`edit_assessment`** with a `set_status` op → `SUBMITTED`.
6. To revise a submitted assessment: **`retake_assessment`** (creates a new revision referencing the original).

## Rules

- Prefer `edit_assessment` over the deprecated `update_assessment` (raw JSON, no preview).
- ITEMS (choice) questions take `items: [...]`, not `value`.
- ASSETS / USERORGROUPS / ATTACHMENTS answer types are not supported — tell the user to fill those in the Collibra UI.
- Resolve owner/assignee UUIDs with `find_users` first.
