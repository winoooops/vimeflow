import type { Message, ConversationItem } from '../types'

/**
 * Mock conversation messages for the Chat View UI.
 */
export const mockMessages: Message[] = [
  {
    id: 'msg-1',
    sender: 'user',
    content:
      'Can you help me refactor the `handleUserInput()` function to use async/await instead of promises?',
    timestamp: '2026-03-31T14:23:15Z',
  },
  {
    id: 'msg-2',
    sender: 'agent',
    status: 'completed',
    content:
      'I can help you with that refactoring. Let me analyze the current implementation and suggest improvements.',
    timestamp: '2026-03-31T14:23:22Z',
    codeSnippets: [
      {
        language: 'typescript',
        filename: 'src/utils/inputHandler.ts',
        code: `export const handleUserInput = async (input: string): Promise<void> => {
  try {
    const validated = await validateInput(input)
    const result = await processInput(validated)
    await saveResult(result)
    console.log('Input processed successfully')
  } catch (error: unknown) {
    logger.error('Failed to process input', error)
    throw new Error(getErrorMessage(error))
  }
}`,
      },
    ],
  },
  {
    id: 'msg-3',
    sender: 'user',
    content:
      'That looks great! Can you also add proper error handling for the `validateInput()` step?',
    timestamp: '2026-03-31T14:25:47Z',
  },
  {
    id: 'msg-4',
    sender: 'agent',
    status: 'thinking',
    content:
      'Analyzing the validation logic and determining the best error handling strategy...',
    timestamp: '2026-03-31T14:25:51Z',
    codeSnippets: [
      {
        language: 'typescript',
        filename: 'src/utils/validator.ts',
        code: `import { z } from 'zod'

const inputSchema = z.object({
  text: z.string().min(1, 'Input cannot be empty'),
  type: z.enum(['command', 'message']),
})

export const validateInput = async (input: string): Promise<ValidatedInput> => {
  try {
    const parsed = JSON.parse(input)
    const validated = inputSchema.parse(parsed)
    return validated
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new ValidationError(\`Invalid input: \${error.errors[0].message}\`)
    }
    throw new Error('Failed to parse input JSON')
  }
}`,
      },
    ],
  },
]

/**
 * Mock conversation items for the sidebar.
 */
export const mockConversations: ConversationItem[] = [
  {
    id: 'conv-1',
    title: 'Refactor input handler to async/await',
    timestamp: '2026-03-31T14:23:15Z',
    hasSubThreads: true,
    active: true,
  },
  {
    id: 'conv-2',
    title: 'Implement user authentication flow',
    timestamp: '2026-03-31T11:15:30Z',
    hasSubThreads: false,
    active: false,
  },
  {
    id: 'conv-3',
    title: 'Debug API response caching issue',
    timestamp: '2026-03-31T09:42:18Z',
    hasSubThreads: true,
    active: false,
  },
  {
    id: 'conv-4',
    title: 'Add TypeScript strict mode',
    timestamp: '2026-03-30T16:28:05Z',
    hasSubThreads: false,
    active: false,
  },
  {
    id: 'conv-5',
    title: 'Setup Vitest for unit testing',
    timestamp: '2026-03-30T14:05:42Z',
    hasSubThreads: false,
    active: false,
  },
]

/**
 * Agent status data for the context panel.
 */
export interface AgentStatus {
  modelName: string
  progress: number
  latency: string
  tokens: string
  systemHealth: 'online' | 'offline' | 'warning'
}

export const mockAgentStatus: AgentStatus = {
  modelName: 'Claude 3.5 Sonnet',
  progress: 67,
  latency: '142ms',
  tokens: '12,847',
  systemHealth: 'online',
}

/**
 * Recent actions for the context panel timeline.
 */
export interface RecentAction {
  id: string
  action: string
  timestamp: string
  status: 'success' | 'pending' | 'error'
}

export const mockRecentActions: RecentAction[] = [
  {
    id: 'action-1',
    action: 'Code generation',
    timestamp: '2026-03-31T14:25:51Z',
    status: 'pending',
  },
  {
    id: 'action-2',
    action: 'Type checking',
    timestamp: '2026-03-31T14:23:22Z',
    status: 'success',
  },
  {
    id: 'action-3',
    action: 'File analysis',
    timestamp: '2026-03-31T14:23:18Z',
    status: 'success',
  },
  {
    id: 'action-4',
    action: 'Syntax validation',
    timestamp: '2026-03-31T14:23:15Z',
    status: 'success',
  },
]
