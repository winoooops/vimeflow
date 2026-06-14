# Button Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `Button` / `IconButton` / `ToolbarButton` family over a package-private `base/button` substrate, migrate the standalone icon/toolbar buttons to it, and add the `vimeflow/no-raw-icon-button` guardrail.

**Architecture:** `base/button/{buttonVariants,BaseButton}` (package-private, fenced by Ring 2) is the single styling + element-contract source; public `Button`/`IconButton`/`ToolbarButton` compose it. Mirrors VIM-119's `base/floating` → `Dropdown`/`Menu`/`Popover`. Spec: `docs/superpowers/specs/2026-06-14-button-primitives-design.md` (codex-clean) — it is the contract; this plan is the steps.

**Tech stack:** React 19 (ref-as-prop, no `forwardRef`), TypeScript, Tailwind v4 (semantic tokens; `aria-pressed:`/`aria-expanded:` variants are first-use in this repo — verify they render), ESLint 9 flat config, Vitest 3 + Testing Library 16.

**Stacked PRs (integration branch `feat/button-primitives` → `main`):** PR1 = T1–T8 (substrate + icon-only), PR2 = T9–T11 (toolbar pills), PR3 = T12–T15 (close-out). Child PRs carry **no** `VIM-124` magic word; only the final → main PR `Closes VIM-124`.

**Commit convention:** conventional-commits subject (commitlint — lowercase after the colon, identifiers in trailing parens). Per `AGENTS.md` / `rules/common/git-workflow.md`, append the co-author trailer `Co-Authored-By: codex <codex@openai.com>` to every commit. The `git commit -m` examples below show the subject only.

---

## File structure

**New (PR1):**
- `src/components/base/button/buttonVariants.ts` (+ `.test.ts`) — variant/size/tone/shape → className.
- `src/components/base/button/BaseButton.tsx` (+ `.test.tsx`) — headless `<button>`.
- `src/components/Button.tsx` (+ `.test.tsx`) — text/primary; re-exports the variant types.
- `src/components/IconButton.tsx` (+ `.test.tsx`) — icon-only.
- `eslint-rules/no-raw-icon-button.js` (+ `eslint-rules/no-raw-icon-button.test.js`) — the guardrail.

**New (PR2):**
- `src/components/ToolbarButton.tsx` (+ `.test.tsx`) — icon + label pill.

**Modified:**
- `eslint.config.js` — register the rule on the existing `vimeflow` plugin; extend the alias regex (PR3).
- Migration call sites (PR1/PR2) and `docs/design/UNIFIED.md`, `rules/typescript/coding-style/CLAUDE.md`, `AGENTS.md` (PR3).

---

# PR1 — substrate + icon-only buttons

## Task 1: Offender inventory (the audit of record)

**Files:** Create `docs/superpowers/plans/2026-06-14-button-primitives-inventory.md`.

- [ ] **Step 1: Enumerate every raw icon button.** Run and capture:

```bash
# Shape A (glyph class on the button) + Shape B (icon span child) + helper-class:
rg -n 'material-symbols-outlined' src --type tsx -l | sort
rg -n '<button' src --type tsx -l | sort
# Helper-derived icon classes (e.g. tabIconClass):
rg -n 'material-symbols-outlined' src -g '!*.test.tsx' -B2 -A2 | rg -n 'function|=>|const .*Class'
```

- [ ] **Step 2: Classify each `<button>` that renders a Material Symbol** into one of: `migrate-now` (standalone icon-only — Shape A or B), `toolbar-pill` (icon + label trigger), `deferred-grouped` (inside a segmented control / tab strip / `Toggle` — VIM-125), `row-menu-exception` (icon **plus** text/input — not an icon button, left raw), or `bespoke` (`SidebarToggle` SVG glyph — out of scope). Record file:line + class for each. This list — not the lint-disable set — is the authoritative audit and the VIM-125 floor (spec §2, §5, §7).

- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/plans/2026-06-14-button-primitives-inventory.md
git commit -m "docs(button-primitives): offender inventory and migration classification"
```

## Task 2: `buttonVariants`

**Files:** Create `src/components/base/button/buttonVariants.ts`, `src/components/base/button/buttonVariants.test.ts`.

- [ ] **Step 1: Write the failing test.**

```ts
import { test, expect } from 'vitest'
import { buttonVariants } from './buttonVariants'

test('defaults to a md pill default variant', () => {
  const cls = buttonVariants()
  expect(cls).toContain('h-[30px]')
  expect(cls).toContain('bg-surface-container-high')
  expect(cls).toContain('focus-visible:ring-1')
})

test('ghost icon sm yields the square icon geometry and ghost tokens', () => {
  const cls = buttonVariants({ variant: 'ghost', size: 'sm', shape: 'icon' })
  expect(cls).toContain('h-[22px] w-[22px]')
  expect(cls).toContain('bg-transparent')
  expect(cls).toContain('hover:bg-surface-container-high')
})

test('active state is keyed off aria-pressed and aria-expanded', () => {
  const cls = buttonVariants({ variant: 'ghost' })
  expect(cls).toContain('aria-pressed:bg-primary/10')
  expect(cls).toContain('aria-expanded:bg-primary/10')
})

test('danger tone is a self-contained error skin (no competing base text)', () => {
  const cls = buttonVariants({ tone: 'danger' })
  expect(cls).toContain('text-error')
  expect(cls).not.toContain('text-on-surface')
})
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/components/base/button/buttonVariants.test.ts`).

- [ ] **Step 3: Implement.** (Tokens only — no hex/rgb; passes `vimeflow/no-hardcoded-colors`.)

```ts
export type ButtonVariant = 'default' | 'ghost' | 'toolbar' | 'primary'

export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonTone = 'default' | 'danger'

export type ButtonShape = 'icon' | 'pill'

export interface ButtonVariantOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  tone?: ButtonTone
  shape?: ButtonShape
}

const BASE =
  'inline-flex shrink-0 items-center justify-center transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ' +
  'disabled:opacity-40 disabled:pointer-events-none'

const VARIANT: Record<ButtonVariant, string> = {
  ghost:
    'bg-transparent text-on-surface-muted hover:bg-surface-container-high hover:text-on-surface ' +
    'aria-pressed:bg-primary/10 aria-pressed:text-primary aria-expanded:bg-primary/10 aria-expanded:text-primary',
  default:
    'bg-surface-container-high text-on-surface hover:bg-surface-container-highest ' +
    'aria-pressed:bg-primary/12 aria-expanded:bg-primary/12',
  toolbar:
    'bg-surface-container-high/60 text-on-surface-variant hover:bg-surface-container-highest/80 hover:text-on-surface ' +
    'aria-pressed:bg-surface-container-highest/80 aria-expanded:bg-surface-container-highest/80 aria-expanded:text-on-surface',
  primary:
    'border border-primary/25 bg-[linear-gradient(180deg,var(--color-primary-dim)_0%,var(--color-primary-deep)_100%)] ' +
    'text-surface-container-lowest ' +
    'shadow-[0_8px_18px_color-mix(in_srgb,var(--color-primary-deep)_20%,transparent),inset_0_1px_0_var(--color-wash-soft)] ' +
    'hover:brightness-110 active:translate-y-px',
}

const DANGER =
  'bg-transparent text-error hover:bg-error/10 hover:text-error ' +
  'aria-pressed:bg-error/15 aria-expanded:bg-error/15'

const SHAPE_SIZE: Record<ButtonShape, Record<ButtonSize, string>> = {
  icon: {
    sm: 'h-[22px] w-[22px] text-[13px] rounded-md',
    md: 'h-7 w-7 text-[17px] rounded-md',
    lg: 'h-8 w-8 text-[19px] rounded-md',
  },
  pill: {
    sm: 'h-[26px] px-2 text-xs rounded-md gap-1.5',
    md: 'h-[30px] px-2.5 text-[13px] rounded-md gap-1.5',
    lg: 'h-9 px-3 text-[15px] rounded-lg gap-2',
  },
}

export const buttonVariants = (options?: ButtonVariantOptions): string => {
  const { variant = 'default', size = 'md', tone = 'default', shape = 'pill' } =
    options ?? {}
  // danger is a self-contained skin; it replaces the variant so no competing
  // text/bg utilities land in the same class string (Tailwind utility order
  // in the generated CSS, not the string, decides — so never emit both).
  const skin = tone === 'danger' ? DANGER : VARIANT[variant]

  return `${BASE} ${SHAPE_SIZE[shape][size]} ${skin}`
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(button-primitives): add buttonVariants substrate`).

## Task 3: `BaseButton`

**Files:** Create `src/components/base/button/BaseButton.tsx`, `BaseButton.test.tsx`.

- [ ] **Step 1: Write the failing test** — asserts: `type="button"` by default; `ref` reaches the `<button>`; `disabled` sets the attribute; a passed `className` appears after the variant classes; `pressed` sets `aria-pressed="true"`; an injected `aria-expanded` flows through.

```tsx
import { test, expect } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { BaseButton } from './BaseButton'

test('defaults type=button and forwards ref + className after variants', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<BaseButton ref={ref} className="mx-2" variant="ghost" shape="icon" />)
  const btn = screen.getByRole('button')
  expect(btn).toHaveAttribute('type', 'button')
  expect(ref.current).toBe(btn)
  expect(btn.className).toMatch(/bg-transparent.*mx-2/s)
})

test('pressed sets aria-pressed; omitted leaves it unset', () => {
  const { rerender } = render(<BaseButton pressed />)
  expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  rerender(<BaseButton />)
  expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
})

test('disabled sets the attribute; an injected aria-expanded flows through ...rest', () => {
  render(<BaseButton disabled aria-expanded />)
  const btn = screen.getByRole('button')
  expect(btn).toBeDisabled()
  expect(btn).toHaveAttribute('aria-expanded', 'true')
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** (React 19 ref-as-prop; `pressed` defaults to `undefined` so non-toggles get no `aria-pressed`):

```tsx
import { type ButtonHTMLAttributes, type ReactElement, type Ref } from 'react'
import {
  buttonVariants,
  type ButtonShape,
  type ButtonSize,
  type ButtonTone,
  type ButtonVariant,
} from './buttonVariants'

export type {
  ButtonShape,
  ButtonSize,
  ButtonTone,
  ButtonVariant,
} from './buttonVariants'

export interface BaseButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  tone?: ButtonTone
  shape?: ButtonShape
  pressed?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
}

export const BaseButton = ({
  variant = 'default',
  size = 'md',
  tone = 'default',
  shape = 'pill',
  pressed = undefined,
  className = '',
  type = 'button',
  ref = undefined,
  ...rest
}: BaseButtonProps): ReactElement => (
  <button
    {...rest}
    ref={ref}
    type={type}
    aria-pressed={pressed}
    className={`${buttonVariants({ variant, size, tone, shape })} ${className}`.trim()}
  />
)
```

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit** (`feat(button-primitives): add BaseButton substrate`).

## Task 4: `Button`

**Files:** Create `src/components/Button.tsx`, `Button.test.tsx`.

- [ ] **Step 1: Failing test** — renders children as label; `leadingIcon` renders an `aria-hidden` Material Symbol; keyboard Enter fires `onClick`; re-exports `ButtonVariant`/`ButtonSize`/`ButtonTone` (a type-only import in the test compiles).
- [ ] **Step 2: Run — FAIL. Step 3: Implement:**

```tsx
import { type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import {
  BaseButton,
  type ButtonSize,
  type ButtonTone,
  type ButtonVariant,
} from '@/components/base/button/BaseButton'

export type { ButtonVariant, ButtonSize, ButtonTone }

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  tone?: ButtonTone
  leadingIcon?: string
  className?: string
  children: ReactNode
}

export const Button = ({
  variant = 'default',
  size = 'md',
  tone = 'default',
  leadingIcon = undefined,
  className = '',
  children,
  ...rest
}: ButtonProps): ReactElement => (
  <BaseButton
    {...rest}
    variant={variant}
    size={size}
    tone={tone}
    shape="pill"
    className={className}
  >
    {leadingIcon !== undefined && (
      <span className="material-symbols-outlined text-[1.1em]" aria-hidden="true">
        {leadingIcon}
      </span>
    )}
    {children}
  </BaseButton>
)
```

> Note: `BaseButton` re-exports the variant types so `Button` (public) is the single import surface; `@/components/Button` re-exports them onward. Confirm the re-export chain keeps `base/` out of feature imports.

- [ ] **Step 4: PASS. Step 5: Commit** (`feat(button-primitives): add Button primitive`).

## Task 5: `IconButton`

**Files:** Create `src/components/IconButton.tsx`, `IconButton.test.tsx`.

- [ ] **Step 1: Failing test** — sets `aria-label` from `label`; renders the icon span `aria-hidden`; renders a `Tooltip` (hover shows `label`); forwards `ref`; **works as a `Menu` trigger** (ref reaches the button, consumer `onClick` fires, `aria-expanded` reflects open). Use the existing `Menu` test pattern (`Menu.test.tsx:190`) as the trigger-composition reference.

```tsx
import { test, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from '@/components/Menu'
import { IconButton } from './IconButton'

test('icon-only: aria-label from label, aria-hidden icon', () => {
  render(<IconButton icon="close" label="Close pane" />)
  const btn = screen.getByRole('button', { name: 'Close pane' })
  // eslint-disable-next-line testing-library/no-node-access -- asserting icon a11y
  expect(btn.querySelector('.material-symbols-outlined')).toHaveAttribute('aria-hidden', 'true')
})

test('serves as a Menu trigger: ref + onClick + aria-expanded', async () => {
  const user = userEvent.setup()
  const spy = vi.fn()
  const ref = createRef<HTMLButtonElement>()
  render(
    <Menu trigger={<IconButton ref={ref} icon="more_vert" label="Actions" onClick={spy} />}>
      <Menu.Item onSelect={vi.fn()}>One</Menu.Item>
    </Menu>
  )
  const btn = screen.getByRole('button', { name: 'Actions' })
  expect(ref.current).toBe(btn)
  await user.click(btn)
  expect(spy).toHaveBeenCalledTimes(1)
  expect(await screen.findByRole('menu')).toBeInTheDocument()
  expect(btn).toHaveAttribute('aria-expanded', 'true')
})
```

- [ ] **Step 2: FAIL. Step 3: Implement** (Tooltip wraps; `ref` + `...rest` forward to `BaseButton`, which Tooltip merges via `useMergeRefs` — spec §4.4):

```tsx
import { type ButtonHTMLAttributes, type ReactElement, type Ref } from 'react'
import { Tooltip } from '@/components/Tooltip'
import {
  BaseButton,
  type ButtonSize,
  type ButtonTone,
  type ButtonVariant,
} from '@/components/base/button/BaseButton'
import { type Placement } from '@/components/base/floating/glassSurface'
import { type ShortcutInput } from '@/lib/formatShortcut'

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label'> {
  icon: string
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  tone?: ButtonTone
  pressed?: boolean
  shortcut?: ShortcutInput
  tooltipPlacement?: Placement
  showTooltip?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
}

export const IconButton = ({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  tone = 'default',
  pressed = undefined,
  shortcut = undefined,
  tooltipPlacement = 'bottom',
  showTooltip = true,
  className = '',
  ref = undefined,
  ...rest
}: IconButtonProps): ReactElement => {
  const button = (
    <BaseButton
      {...rest}
      ref={ref}
      aria-label={label}
      variant={variant}
      size={size}
      tone={tone}
      pressed={pressed}
      shape="icon"
      className={className}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
    </BaseButton>
  )

  return showTooltip ? (
    <Tooltip content={label} shortcut={shortcut} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}
```

> Confirm the `@/lib/formatShortcut` path matches Tooltip's import (`../lib/formatShortcut` from `src/components/`). Verify `showTooltip=false` still keeps `aria-label` (the accessible name must never depend on the tooltip).

- [ ] **Step 4: PASS. Step 5: Commit** (`feat(button-primitives): add IconButton primitive`).

## Task 6: `vimeflow/no-raw-icon-button` rule + registration + grandfather

**Files:** Create `eslint-rules/no-raw-icon-button.js`, `eslint-rules/no-raw-icon-button.test.js`; modify `eslint.config.js`.

- [ ] **Step 1: Write the RuleTester test** (covers Shape A glyph button reports; Shape B icon-span-only reports; icon **plus** text does not; bare span does not; a helper-class case is documented as a rule miss):

```js
import { RuleTester } from 'eslint'
import { test } from 'vitest'
import rule from './no-raw-icon-button.js'

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 2022, sourceType: 'module' } },
})

test('no-raw-icon-button', () => {
  ruleTester.run('no-raw-icon-button', rule, {
    valid: [
      // icon + text label (toolbar pill / row / menu item) — not icon-only
      '<button><span className="material-symbols-outlined" />Label</button>',
      // bare icon, no button ancestor
      '<span className="material-symbols-outlined">add</span>',
      // the primitives render the raw pattern; exemption is via config `ignores`, not the rule
    ],
    invalid: [
      { code: '<button className="material-symbols-outlined">add</button>', errors: [{ messageId: 'rawIconButton' }] }, // Shape A
      { code: '<button><span className="material-symbols-outlined" aria-hidden="true">close</span></button>', errors: [{ messageId: 'rawIconButton' }] }, // Shape B
    ],
  })
})
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement the rule** (mirrors `no-hardcoded-colors.js`):

```js
// eslint-rules/no-raw-icon-button.js
// Bans hand-rolled icon-only buttons: a <button> whose only content is a
// material-symbols-outlined glyph (class on the button itself, or on its
// single child span). Use IconButton (or ToolbarButton for icon + label)
// from @/components. Helper-classed icons are not detected — the offender
// inventory is the authoritative audit for those.
const MARKER = 'material-symbols-outlined'

const classNameText = (opening) => {
  const attr = opening.attributes.find(
    (a) => a.type === 'JSXAttribute' && a.name.name === 'className'
  )
  if (!attr || !attr.value) {
    return ''
  }
  if (attr.value.type === 'Literal') {
    return String(attr.value.value ?? '')
  }
  if (
    attr.value.type === 'JSXExpressionContainer' &&
    attr.value.expression.type === 'TemplateLiteral'
  ) {
    return attr.value.expression.quasis.map((q) => q.value.raw).join(' ')
  }
  return ''
}

const isBlankText = (child) =>
  child.type === 'JSXText' && child.value.trim() === ''

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow hand-rolled icon-only buttons; use IconButton/ToolbarButton from @/components',
    },
    messages: {
      rawIconButton:
        'Raw icon-only <button> — use IconButton from @/components/IconButton (or ToolbarButton for icon + label). There is no @/components barrel; import the specific module.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        const opening = node.openingElement
        if (
          opening.name.type !== 'JSXIdentifier' ||
          opening.name.name !== 'button'
        ) {
          return
        }
        if (classNameText(opening).includes(MARKER)) {
          context.report({ node, messageId: 'rawIconButton' })
          return
        }
        const meaningful = node.children.filter((c) => !isBlankText(c))
        if (
          meaningful.length === 1 &&
          meaningful[0].type === 'JSXElement' &&
          classNameText(meaningful[0].openingElement).includes(MARKER)
        ) {
          context.report({ node, messageId: 'rawIconButton' })
        }
      },
    }
  },
}
```

- [ ] **Step 4: Register on the existing `vimeflow` plugin** in `eslint.config.js` (avoid a second `plugins: { vimeflow }` block — flat-config redefinition). Add the import, hoist a shared plugin const, and add a scoped enablement block:

```js
import noRawIconButton from './eslint-rules/no-raw-icon-button.js'
// …
const vimeflowPlugin = {
  rules: {
    'no-hardcoded-colors': noHardcodedColors,
    'no-raw-icon-button': noRawIconButton,
  },
}
// existing colors block → plugins: { vimeflow: vimeflowPlugin }
// new block:
{
  files: ['src/**/*.tsx'],
  ignores: ['src/components/**'],
  plugins: { vimeflow: vimeflowPlugin },
  rules: { 'vimeflow/no-raw-icon-button': 'error' },
},
```

- [ ] **Step 5: Add the flat-config integration test** — construct an `ESLint` instance against the real `eslint.config.js` and use `lintText(code, { filePath })` with **existing** paths (the `projectService: true` parser rejects non-existent files): for a Shape-A button string, assert a `vimeflow/no-raw-icon-button` message **appears** at `filePath: 'src/App.tsx'` (non-components) and is **absent** at `filePath: 'src/components/Tooltip.tsx'` (the exemption). Filter `result.messages` by `ruleId === 'vimeflow/no-raw-icon-button'` so unrelated rule output on the probe string does not affect the assertion. Do **not** create a fixture file under `src/components/**` — the rule ignores that tree (codex caught both the fixture location and the non-existent `filePath`).
- [ ] **Step 6: Grandfather** — run `npm run lint`; for every reported offender add `// eslint-disable-next-line vimeflow/no-raw-icon-button` (tag grouped-control ones `-- VIM-125`). The inventory (T1) remains the complete audit.
- [ ] **Step 7: Gate green + Commit** (`feat(button-primitives): add no-raw-icon-button guardrail and grandfather offenders`).

## Task 7: Migrate the standalone icon-only buttons

**Files:** `HeaderActions.tsx`, `AgentStatusRail.tsx`, `AgentStatusPanel/Header.tsx`, `ActivityEvent.tsx` (copy), `sessions/Card.tsx` (kebab), `BrowserToolbar.tsx` (nav), `ReviewCommentRow.tsx` (delete), `PriorityPlus.tsx` (trigger) + their tests. Do these as small per-file commits; each deletes its `eslint-disable`.

- [ ] **Worked example — `HeaderActions` close button:**

```tsx
// before:
<Tooltip content="Close pane" placement="bottom">
  <button type="button" aria-label="close pane" onClick={...}
    className="inline-flex h-[22px] w-[22px] ... rounded ... hover:bg-wash-subtle">
    <span className="material-symbols-outlined text-[13px]" aria-hidden="true">close</span>
  </button>
</Tooltip>
// after:
<IconButton icon="close" label="close pane" size="sm" onClick={...} tooltipPlacement="bottom" />
```

- [ ] **Per-site notes:** burner button → `pressed={burnerActive}` + `className` for the `agent-shell-accent` tint; `BrowserToolbar` nav → keep `disabled`, accent hover via `className` (`agent-browser-accent` token); `ReviewCommentRow` delete → `tone="danger"`; `Card` kebab → it is a `Menu` trigger, so pass `<IconButton …/>` as `Menu`'s `trigger` (open tint via injected `aria-expanded`, `showTooltip` per the existing affordance); `PriorityPlus` → icon-only `IconButton`, `Popover` anchor (`ref` → anchor, `pressed={open}`).
- [ ] For each: update the sibling test to query by role/name (not old class strings); delete the `eslint-disable`; run that file's tests; **render in the browser** to confirm the 1–2px size convergence and the `aria-pressed`/`aria-expanded` tints actually paint (Tailwind v4 first-use of those variants — jsdom can't verify). Commit per file (`refactor(button-primitives): migrate <site> to IconButton`).

## Task 8: PR1 gate + open PR1

- [ ] `npm run lint && npm run type-check && npm run test && npm run build` (all green; `git checkout -- src/bindings/` if codex/tsc dirtied them).
- [ ] Run codex review (`codex review --base main`) on the PR1 diff; resolve to clean.
- [ ] Push `feat/button-primitives-pr1`; open PR into `feat/button-primitives` with labels `auto-review` + `auto-approve`; **no `VIM-124` reference** in the title/body.

---

# PR2 — toolbar pills

## Task 9: `ToolbarButton`

**Files:** Create `src/components/ToolbarButton.tsx`, `ToolbarButton.test.tsx`.

- [ ] **Step 1: Failing test** — renders icon + visible label + optional trailing caret; default `variant="toolbar"`; forwards `ref`/`...rest`; serves as a `Menu` trigger with `aria-expanded` driving the open tint.
- [ ] **Step 2–3: Implement:**

```tsx
import { type ButtonHTMLAttributes, type ReactElement, type Ref } from 'react'
import {
  BaseButton,
  type ButtonSize,
  type ButtonTone,
  type ButtonVariant,
} from '@/components/base/button/BaseButton'

interface ToolbarButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  label: string
  icon?: string
  trailingIcon?: string
  variant?: ButtonVariant
  size?: ButtonSize
  tone?: ButtonTone
  pressed?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
}

export const ToolbarButton = ({
  label,
  icon = undefined,
  trailingIcon = undefined,
  variant = 'toolbar',
  size = 'md',
  tone = 'default',
  pressed = undefined,
  className = '',
  ref = undefined,
  ...rest
}: ToolbarButtonProps): ReactElement => (
  <BaseButton
    {...rest}
    ref={ref}
    variant={variant}
    size={size}
    tone={tone}
    pressed={pressed}
    shape="pill"
    className={className}
  >
    {icon !== undefined && (
      <span className="material-symbols-outlined text-[1.1em]" aria-hidden="true">
        {icon}
      </span>
    )}
    <span className="truncate">{label}</span>
    {trailingIcon !== undefined && (
      <span className="material-symbols-outlined text-[1.1em]" aria-hidden="true">
        {trailingIcon}
      </span>
    )}
  </BaseButton>
)
```

- [ ] **Step 4: PASS. Step 5: Commit** (`feat(button-primitives): add ToolbarButton primitive`).

## Task 10: Migrate toolbar pills + `NewSessionButton`

**Files:** `ViewSettingsDropdown.tsx` (Menu trigger), `src/components/Dropdown.tsx` (built-in trigger), `NewSessionButton.tsx` + tests.

- [ ] `ViewSettingsDropdown` trigger → `<ToolbarButton icon=… label=… trailingIcon="expand_more" />` passed as `Menu`'s `trigger`; the open tint comes from the injected `aria-expanded` (no `pressed` prop). Delete its `eslint-disable`.
- [ ] `Dropdown` built-in trigger → adopt `ToolbarButton` internally (`Dropdown` is already a primitive in `src/components/`, so it imports `ToolbarButton` directly; no ring issue). Keep `renderTrigger` working.
- [ ] `NewSessionButton` → `<Button variant="primary" leadingIcon="add" className="<the flex-1/min-max-w/group reveal layout>">New session</Button>`; keep the Tooltip + `aria-keyshortcuts`; the reveal animation stays in `className`. Verify the gradient/shadow/active-translate match in the browser.
- [ ] Update tests; run file tests; **browser-verify**. Commit per file.

## Task 11: PR2 gate + open PR2

- [ ] Gate green; codex review clean; push `feat/button-primitives-pr2` → PR into `feat/button-primitives`; labels `auto-review` + `auto-approve`; no `VIM-124` ref.

---

# PR3 — close-out

## Task 12: Remaining stragglers + ratchet to the VIM-124 floor

- [ ] Migrate any `migrate-now` inventory entries not yet done; delete their disables. Confirm the only remaining `vimeflow/no-raw-icon-button` disables are the `-- VIM-125` grouped-control ones (the floor). Update the inventory doc to mark VIM-124 complete and the VIM-125 remaining list.
- [ ] Commit (`refactor(button-primitives): migrate remaining icon buttons to the floor`).

## Task 13: Alias regex

- [ ] In `eslint.config.js`, extend the `regex/invalid` "shared primitives via `@/components/*` alias" pattern from `(Tooltip|StatusBar|GlassSurface|ResizeHandle|sidebar/)` to add `Button|IconButton|ToolbarButton`. Run lint (no deep relative imports of the new primitives exist). Commit.

## Task 14: Documentation

- [ ] `docs/design/UNIFIED.md` — add §5.10 `Button`, §5.11 `IconButton`, §5.12 `ToolbarButton` (interface block + rules, matching §5.7–5.9 form): import via alias; `base/button` package-private; `IconButton` requires `label`; active state is attribute-driven (`aria-pressed`/`aria-expanded`); grouped controls + `SidebarToggle` out of scope.
- [ ] `rules/typescript/coding-style/CLAUDE.md` — add a Buttons bullet under "Shared UI Primitives".
- [ ] `AGENTS.md` — record the ratchet: VIM-124 floor (grouped offenders tagged `-- VIM-125`) → 0 at VIM-125.
- [ ] Commit (`docs(button-primitives): document Button family contracts and ratchet`).

## Task 15: PR3 gate + open PR3

- [ ] Gate green; codex review clean; push `feat/button-primitives-pr3` → PR into `feat/button-primitives`; labels `auto-review` + `auto-approve`; no `VIM-124` ref.

---

# Final: integration → main

- [ ] After PR1–PR3 merge into `feat/button-primitives`, reconcile `origin/main`, run the full gate, and open `feat/button-primitives` → `main` with **`Closes VIM-124`** in the body (the only PR that references the issue). Auto-review only (the final main merge is the user's gate — no auto-approve).

---

## Self-review checklist (run before handing to execution)

- **Spec coverage:** every spec §4 contract → a task (T2–T5, T9); the guardrail §5 → T6; migrations §7 → T7/T10/T12; rings §6 → T6/T13; docs §9 → T14. ✓
- **Type consistency:** `ButtonVariant`/`ButtonSize`/`ButtonTone`/`ButtonShape` defined in T2, consumed unchanged in T3–T5/T9; re-export chain `base/button → @/components/Button`. ✓
- **No placeholders:** new-file code is complete; migrations give a worked example + per-site notes + the inventory contract.
- **Risk flags carried from the spec:** Tailwind-v4 first-use of `aria-pressed:`/`aria-expanded:` → browser-verify (T7/T10); size convergence → browser-verify; `primary` single consumer → revisit in T10.
