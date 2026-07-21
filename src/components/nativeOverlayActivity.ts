const NATIVE_OVERLAY_ACTIVITY_TOOL_KINDS = [
  'edit',
  'bash',
  'read',
  'write',
  'grep',
  'glob',
  'plan',
  'wait',
  'agent',
  'web',
  'interaction',
  'external',
  'meta',
] as const

type NativeOverlayActivityToolKind =
  (typeof NATIVE_OVERLAY_ACTIVITY_TOOL_KINDS)[number]

export type NativeOverlayActivityEventKind =
  | NativeOverlayActivityToolKind
  | 'think'
  | 'user'

interface NativeOverlayActivityEventBase {
  id: string
  timestamp: string
  status: 'running' | 'done' | 'failed'
  body: string
  isTestFile?: boolean
}

export type NativeOverlayActivityEvent =
  | (NativeOverlayActivityEventBase & {
      kind: NativeOverlayActivityToolKind
      tool: string
      label: string
      durationMs: number | null
      diff?: { added: number; removed: number }
      bashResult?: { passed: number; total: number }
      resultPreview?: string | null
    })
  | (NativeOverlayActivityEventBase & { kind: 'think' | 'user' })

export type NativeOverlayActivityToolEvent = Extract<
  NativeOverlayActivityEvent,
  { tool: string }
>

export interface NativeOverlayActivityPopoverPayload {
  kind: 'popover'
  popover: 'activity'
  ariaLabel: string
  event: NativeOverlayActivityEvent
  activateActionId?: string
}

export interface NativeOverlayActivityPopoverRequest {
  surfaceId: string
  kind: 'popover'
  anchorRect: { x: number; y: number; width: number; height: number }
  placement: string
  payload: NativeOverlayActivityPopoverPayload
  theme?: {
    id?: string
    colorScheme?: string
    variables: Record<string, string>
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isActivityToolKind = (
  value: unknown
): value is NativeOverlayActivityToolKind =>
  NATIVE_OVERLAY_ACTIVITY_TOOL_KINDS.some((kind) => kind === value)

const isCountPair = (value: unknown, first: string, second: string): boolean =>
  isRecord(value) &&
  isFiniteNumber(value[first]) &&
  isFiniteNumber(value[second])

const isActivityEvent = (
  value: unknown
): value is NativeOverlayActivityEvent => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.timestamp !== 'string' ||
    (value.status !== 'running' &&
      value.status !== 'done' &&
      value.status !== 'failed') ||
    typeof value.body !== 'string' ||
    (value.isTestFile !== undefined && typeof value.isTestFile !== 'boolean')
  ) {
    return false
  }

  if (value.kind === 'think' || value.kind === 'user') {
    return true
  }

  return (
    isActivityToolKind(value.kind) &&
    typeof value.tool === 'string' &&
    typeof value.label === 'string' &&
    (value.durationMs === null || isFiniteNumber(value.durationMs)) &&
    (value.diff === undefined || isCountPair(value.diff, 'added', 'removed')) &&
    (value.bashResult === undefined ||
      isCountPair(value.bashResult, 'passed', 'total')) &&
    (value.resultPreview === undefined ||
      value.resultPreview === null ||
      typeof value.resultPreview === 'string')
  )
}

export const isNativeOverlayActivityPopoverPayload = (
  value: unknown
): value is NativeOverlayActivityPopoverPayload =>
  isRecord(value) &&
  value.kind === 'popover' &&
  value.popover === 'activity' &&
  typeof value.ariaLabel === 'string' &&
  isActivityEvent(value.event) &&
  (value.activateActionId === undefined ||
    typeof value.activateActionId === 'string')

export const isNativeActivityPopoverRequest = (
  value: unknown
): value is NativeOverlayActivityPopoverRequest =>
  isRecord(value) &&
  value.kind === 'popover' &&
  isNativeOverlayActivityPopoverPayload(value.payload)
