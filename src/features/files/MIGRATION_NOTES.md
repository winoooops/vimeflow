# Files Feature Migration Notes

## Status: Partial Migration to Editor Feature

Date: 2026-04-05

## Completed Migrations

The following components have been successfully migrated from `src/features/files/` to `src/features/editor/`:

### ✅ FileTree Component

- **Source**: `src/features/files/components/FileTree.tsx`
- **Destination**: `src/features/editor/components/FileTree.tsx`
- **Changes**: Updated imports to use `../types` from editor feature
- **Tests**: All 13 tests passing

### ✅ FileTreeNode Component

- **Source**: `src/features/files/components/FileTreeNode.tsx`
- **Destination**: `src/features/editor/components/FileTreeNode.tsx`
- **Changes**:
  - Updated imports to use `../types` from editor feature
  - Removed `isDragging` and `isDragTarget` field references (per editor spec)
  - Removed drag-related styling logic
- **Tests**: All 16 tests passing (removed 2 drag-related tests)

### ✅ ContextMenu Component

- **Source**: `src/features/files/components/ContextMenu.tsx`
- **Destination**: `src/features/editor/components/ContextMenu.tsx`
- **Changes**: Updated imports to use `../types` from editor feature
- **Tests**: All 15 tests passing

## Deprecated Components (Pending Removal)

The following components in `src/features/files/components/` are **deprecated** and will be removed once the EditorView is fully functional:

### 🗑️ Breadcrumbs Component

- **File**: `Breadcrumbs.tsx` + `Breadcrumbs.test.tsx`
- **Reason**: Replaced by ExplorerPane header in editor view
- **Action**: Delete after EditorView verification

### 🗑️ DropZone Component

- **File**: `DropZone.tsx` + `DropZone.test.tsx`
- **Reason**: Not in new editor design spec
- **Action**: Delete after EditorView verification

### 🗑️ FileStatusBar Component

- **File**: `FileStatusBar.tsx` + `FileStatusBar.test.tsx`
- **Reason**: Replaced by EditorStatusBar (vim-style status bar)
- **Action**: Delete after EditorView verification

## FilesView Component

### 🔄 To Be Replaced

- **File**: `FilesView.tsx` + `FilesView.test.tsx`
- **Replacement**: `EditorView.tsx` in editor feature
- **Action**: Remove from App.tsx routing after EditorView is integrated

## Removal Checklist

Before removing deprecated components:

- [ ] EditorView fully implemented and tested
- [ ] EditorView integrated into App.tsx
- [ ] All EditorView tests passing
- [ ] Visual verification matches design spec
- [ ] TopTabBar updated (Files tab removed, Editor tab active)
- [ ] No remaining imports of deprecated components

## Timeline

- **Phase 3 (Current)**: Components migrated, deprecated components documented
- **Phase 4**: EditorView components implemented (ExplorerPane, EditorTabs, CodeEditor, EditorStatusBar)
- **Phase 5**: EditorView assembly and App.tsx integration
- **Phase 6**: Cleanup - remove deprecated components and files/ feature directory

## References

- Editor View Spec: `app_spec.md`
- Feature List: `feature_list.json` (Features 9-12)
- Design Reference: `docs/design/files_and_editor/`
