# Task 4: Restore planner - Implementation Report

## Summary
Successfully implemented the restore planner module for TabVault, converting a session snapshot into ordered browser restoration steps.

## What Was Implemented

### Files Created
1. **lib/restore-plan.js** (54 lines)
   - UMD wrapper pattern matching existing modules
   - `fitBounds()` helper: validates and filters window bounds based on state and screen dimensions
   - `planRestore()` main function: transforms session into sequential browser automation steps
   - Handles window selection, incognito filtering, tab ordering, pinning, muting, grouping, and discarding

2. **test/restore-plan.test.js** (49 lines)
   - 3 comprehensive test cases covering:
     - Full restoration flow with pinned tabs, groups, and muting
     - Incognito window filtering and bounds constraints
     - Edge case: all-pinned-tabs window restoration

## Testing Results

### TDD Evidence: RED Phase
```
Error: Cannot find module '../lib/restore-plan.js'
Require stack: [E:\\OneDrive\\Sources\\TabVault\\test\\restore-plan.test.js:3:25]
Exit code 1 (3 tests could not run)
```

### Implementation Complete

### TDD Evidence: GREEN Phase
```
TAP version 13
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Full Suite Verification
```
npm test (all 19 tests)
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
```

Test counts by file:
- test/session.test.js: 6 tests (pass)
- test/search.test.js: 3 tests (pass)
- test/exporters.test.js: 2 tests (pass)
- test/snapshots.test.js: 5 tests (pass)
- test/restore-plan.test.js: 3 tests (pass) **[NEW]**

## Files Changed
- **Created:** `lib/restore-plan.js`
- **Created:** `test/restore-plan.test.js`

## Self-Review Findings

### Correctness
- Implementation follows the UMD pattern consistently with existing modules (session.js, search.js, etc.)
- All step operations match the interface specification exactly:
  - createWindow with proper ref naming (w<id>)
  - createTab with window context
  - updateTab for state changes
  - groupTabs with non-pinned member filtering
  - updateGroup with metadata preservation
  - discardTab for memory optimization
- Test assertions verify exact step sequences, not just operation counts

### Logic Verification
- Window selection correctly filters by selectedWindowIds or includes all
- Incognito filtering with precise error reason: "incognito access is not allowed for TabVault"
- First tab selection: finds first non-pinned, falls back to first tab if all pinned
- Tab ordering preserved through index-based sorting
- Bounds validation: only applied to "normal" state, drops oversized windows, returns null for other states
- Group member filtering: excludes pinned tabs from groups (matches Chrome's tab grouping behavior)
- Discard phase: preserves the window's first tab (never discarded)

### Code Quality
- No external dependencies (pure JavaScript)
- Consistent with codebase style and patterns
- Proper use of Boolean() constructor to ensure true booleans
- Defensive defaults: state="normal", title="", color="grey", collapsed=false
- Early returns for skip conditions (incognito, no tabs)

### Edge Cases Covered
1. All-pinned-tabs window opens with first tab
2. Incognito windows rejected or accepted based on flag
3. Oversized bounds dropped for non-normal states
4. Empty groups excluded from steps
5. First tab exemption from discard phase

## Commit Information
- Commit SHA: 588257334a9757b582250f6d26e0a577563d4368
- Branch: feature/tabvault-1.0
- Message: "Add the restore planner"
- Author: Yazeed M
- Co-authors: Claude Fable 5.1

## Issues or Concerns
None. Implementation is complete, all tests pass, and the module integrates properly with the existing test suite without regressions.
