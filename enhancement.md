# Enhancement Request: Multi-Select Metrics Dropdown for DeepEval Evaluation

## 1. Summary

Add a **Dropdown with MultiSelect** control to the **Metrics Evaluation** tab (Tab 3 of `PromptSchemaManager.js`) so users can explicitly choose which DeepEval metrics to run, instead of always evaluating all metrics.

## 2. Current Behavior (As-Is)

- Location: [client/src/components/processing/PromptSchemaManager.js](client/src/components/processing/PromptSchemaManager.js) — Tab 3 "Metrics Evaluation".
- User selects **one test case** from a single-select `Select` dropdown.
- Clicking **Evaluate** calls `evaluateMetrics(testCase, context, userStory)`.
- Inside `evaluateMetrics`, the request payload hardcodes:
  ```js
  metric: 'all'
  ```
- The payload is POSTed directly from the browser to the external DeepEval service at `http://localhost:8000/eval`.
- DeepEval always returns results for every supported metric:
  - `faithfulness`
  - `answer_relevancy`
  - `contextual_precision`
  - `contextual_recall`
  - `hallucination`
- There is no way for the user to run a subset of metrics.

## 3. Requested Enhancement (To-Be)

1. **UI**: Add a MUI `Select` with `multiple` prop (checkboxes + chips) next to/near the existing "Select Test Case to Evaluate" control, listing the 5 supported metrics.
2. **Behavior**:
   - Default selection: all metrics (preserves current behavior when user does nothing).
   - User can check/uncheck individual metrics.
   - "Evaluate" button remains disabled unless a test case AND at least one metric are selected.
3. **Data flow**: Replace the hardcoded `metric: 'all'` with the selected metric list (comma-separated string or array, depending on what the DeepEval `/eval` endpoint accepts) and pass it through `evaluateMetrics(...)`.
4. **Results rendering**: Only render score cards for the metrics that were actually requested/returned (existing rendering logic already maps over `results`, so no structural change should be needed there — verify during implementation).

## 4. Mandatory Constraint

> **[MANDATORY] Do NOT change any existing functionality or UI.**
> - No existing component, route, endpoint, prop, or visual layout may be altered, removed, or restyled outside of the new Metrics multi-select control and its direct wiring.
> - The existing single test-case dropdown, Evaluate button placement/behavior, results grid, color coding, and error handling must remain exactly as-is when "all metrics" are selected (i.e., default behavior is 100% backward compatible).
> - All other tabs/components (`ConvertToJson`, `EmbeddingsStore`, `QuerySearch`, `BM25Search`, `HybridSearch`, `RerankingSearch`, `QueryPreprocessing`, `SummarizationDedup`, `Settings`) are out of scope and must not be touched.
> - No changes to `server/index.js` API contracts used by other components.

## 5. Phase-by-Phase Implementation Plan

> **Process**: Each phase below must be reviewed and explicitly approved before starting the next phase.

### Phase 1 — Discovery & Design (no code changes)
- Confirm exact DeepEval `/eval` endpoint contract for selecting specific metrics (does it accept a comma-separated string, an array, or repeated calls per metric?).
- Confirm the 5 metric keys/labels to show in the UI (`faithfulness`, `answer_relevancy`, `contextual_precision`, `contextual_recall`, `hallucination`).
- Finalize UI placement/mockup (text description) of the multi-select next to the test-case dropdown, without altering existing layout width/spacing.
- **Deliverable**: Confirmed design notes (this document updated if needed).

### Phase 2 — State & UI Scaffolding
- Add new local state, e.g. `selectedMetrics` (array, default = all 5 metrics selected).
- Add a new MUI multi-select `FormControl` + `Select multiple` + `MenuItem` with `Checkbox`/`ListItemText`, rendered as an additional item in the existing flex row (does not resize/remove existing controls).
- No wiring to `evaluateMetrics` yet — purely additive UI state.
- **Deliverable**: New dropdown visible and functional (selection state updates), existing UI/behavior unchanged.

### Phase 3 — Wire Selection into Evaluation Call
- Update `evaluateMetrics` signature/call site to accept selected metrics.
- Replace hardcoded `metric: 'all'` with the selected metrics value, defaulting to `'all'` when every metric is selected (keeps payload identical to today for the default case).
- Update the Evaluate button's `disabled` condition to also require `selectedMetrics.length > 0`.
- **Deliverable**: Selected metrics are sent to DeepEval; behavior with "all selected" is functionally identical to current behavior.

### Phase 4 — Results Rendering Verification
- Verify the existing results-rendering block correctly displays only the metrics returned by DeepEval (filtered subset), including average-score calculation and the special hallucination inversion handling.
- Adjust only if the subset selection breaks the existing rendering logic (e.g., average calc assuming all 5 metrics present) — minimal, targeted fix only.
- **Deliverable**: Correct rendering for both full and partial metric selections.

### Phase 5 — Testing & Validation
- Manual test matrix:
  - All metrics selected (default) → confirm output identical to pre-enhancement behavior.
  - Single metric selected → confirm only that metric's card renders correctly.
  - Multiple (but not all) metrics selected → confirm correct subset + average.
  - No metric selected → confirm Evaluate button is disabled.
- Confirm no regressions in other tabs/components (smoke check).
- **Deliverable**: Test results summary; sign-off for merge.

#### Phase 5 Results (live browser test, 2026-09-04)
- Ran the Complete RAG Pipeline live against real Mongo/Mistral/Groq services; dropdown
  populated with 7 test cases (5 reference + 2 generated) with no regressions.
- No test case selected → Evaluate button disabled. ✅
- Default load state → all 5 metrics pre-selected. ✅
- All metrics unchecked → Evaluate button disabled. ✅
- Exactly 1 metric ("faithfulness") selected → Evaluate button enabled. ✅
- Clicked Evaluate (all metrics, real test case) → request sent to
  `http://localhost:8000/eval`; DeepEval service was not running, and the existing
  error UI ("⚠️ Evaluation Error: Failed to fetch... Make sure the DeepEval server is
  running on http://localhost:8000") displayed correctly and unchanged.
- Smoke check: BM25 Search tab renders normally — no regressions from this change.
- **Not yet verified** (requires live DeepEval): actual metric score card rendering,
  average score calc, and hallucination inversion for all/single/subset selections.
  User will validate these with DeepEval running locally.

### Phase 6 — Documentation
- Update [README.md](README.md) enhancement section with final implementation notes and screenshots/description if needed.
- **Deliverable**: Documentation finalized.

## 6. Approval Gate

⚠️ Do not proceed past **Phase 1** without explicit user approval. After each phase's deliverable is presented, wait for approval before starting the next phase.
