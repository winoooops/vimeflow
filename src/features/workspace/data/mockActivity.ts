import type {
  AgentActivity,
  FileChange,
  ToolCall,
  TestResult,
} from '../../sessions/types'

// File changes for active session (running)
const activeFileChanges: FileChange[] = [
  {
    id: 'fc-1',
    path: 'src/auth/middleware.ts',
    type: 'new',
    linesAdded: 48,
    linesRemoved: 0,
    timestamp: '2026-04-07T03:46:15Z',
  },
  {
    id: 'fc-2',
    path: 'src/auth/types.ts',
    type: 'modified',
    linesAdded: 12,
    linesRemoved: 3,
    timestamp: '2026-04-07T03:47:02Z',
  },
  {
    id: 'fc-3',
    path: 'src/routes/auth.ts',
    type: 'modified',
    linesAdded: 5,
    linesRemoved: 1,
    timestamp: '2026-04-07T03:47:28Z',
  },
]

// Tool calls for active session
const activeToolCalls: ToolCall[] = [
  {
    id: 'tc-1',
    tool: 'Read',
    args: 'src/auth/types.ts',
    status: 'done',
    timestamp: '2026-04-07T03:45:32Z',
    duration: 120,
  },
  {
    id: 'tc-2',
    tool: 'Write',
    args: 'src/auth/middleware.ts (48 lines)',
    status: 'done',
    timestamp: '2026-04-07T03:46:15Z',
    duration: 1500,
  },
  {
    id: 'tc-3',
    tool: 'Edit',
    args: 'src/auth/types.ts (+12 -3)',
    status: 'done',
    timestamp: '2026-04-07T03:47:02Z',
    duration: 800,
  },
  {
    id: 'tc-4',
    tool: 'Bash',
    args: 'npm test src/auth',
    status: 'running',
    timestamp: '2026-04-07T03:47:30Z',
  },
]

// Test results for active session
const activeTestResults: TestResult[] = [
  {
    id: 'tr-1',
    file: 'src/auth/middleware.test.ts',
    passed: 4,
    failed: 1,
    total: 5,
    failures: [
      {
        id: 'tf-1',
        name: 'should reject invalid tokens',
        file: 'src/auth/middleware.test.ts',
        line: 45,
        message: 'Expected 401 but received 500',
      },
    ],
    timestamp: '2026-04-07T03:47:30Z',
  },
]

// Agent activity for all sessions
export const mockAgentActivity: AgentActivity[] = [
  // Session 1 (running): auth middleware
  {
    fileChanges: activeFileChanges,
    toolCalls: activeToolCalls,
    testResults: activeTestResults,
    contextWindow: {
      used: 75000,
      total: 200000,
      percentage: 37,
      emoji: '😊',
    },
    usage: {
      sessionDuration: 154, // 2m 34s
      turnCount: 12,
      messages: { sent: 142, limit: 200 },
      tokens: { input: 45000, output: 30000, total: 75000 },
      cost: { amount: 0.45, currency: 'USD' },
    },
  },

  // Session 2 (paused): login bug fix
  {
    fileChanges: [
      {
        id: 'fc-4',
        path: 'src/components/LoginForm.tsx',
        type: 'modified',
        linesAdded: 8,
        linesRemoved: 2,
        timestamp: '2026-04-07T03:31:45Z',
      },
    ],
    toolCalls: [
      {
        id: 'tc-5',
        tool: 'Edit',
        args: 'src/components/LoginForm.tsx',
        status: 'done',
        timestamp: '2026-04-07T03:31:45Z',
        duration: 600,
      },
    ],
    testResults: [],
    contextWindow: {
      used: 42000,
      total: 200000,
      percentage: 21,
      emoji: '😊',
    },
    usage: {
      sessionDuration: 135, // 2m 15s
      turnCount: 8,
      messages: { sent: 87, limit: 200 },
      tokens: { input: 25000, output: 17000, total: 42000 },
      cost: { amount: 0.25, currency: 'USD' },
    },
  },

  // Session 3 (completed): api refactor
  {
    fileChanges: [
      {
        id: 'fc-5',
        path: 'src/api/users.ts',
        type: 'modified',
        linesAdded: 28,
        linesRemoved: 15,
        timestamp: '2026-04-07T02:30:00Z',
      },
      {
        id: 'fc-6',
        path: 'src/api/auth.ts',
        type: 'modified',
        linesAdded: 22,
        linesRemoved: 10,
        timestamp: '2026-04-07T02:35:00Z',
      },
      {
        id: 'fc-7',
        path: 'tests/api.test.ts',
        type: 'modified',
        linesAdded: 45,
        linesRemoved: 12,
        timestamp: '2026-04-07T02:40:00Z',
      },
    ],
    toolCalls: [
      {
        id: 'tc-6',
        tool: 'Edit',
        args: 'src/api/users.ts',
        status: 'done',
        timestamp: '2026-04-07T02:30:00Z',
        duration: 1200,
      },
      {
        id: 'tc-7',
        tool: 'Edit',
        args: 'src/api/auth.ts',
        status: 'done',
        timestamp: '2026-04-07T02:35:00Z',
        duration: 900,
      },
      {
        id: 'tc-8',
        tool: 'Edit',
        args: 'tests/api.test.ts',
        status: 'done',
        timestamp: '2026-04-07T02:40:00Z',
        duration: 1500,
      },
      {
        id: 'tc-9',
        tool: 'Bash',
        args: 'npm test',
        status: 'done',
        timestamp: '2026-04-07T02:42:00Z',
        duration: 3200,
      },
    ],
    testResults: [
      {
        id: 'tr-2',
        file: 'tests/api.test.ts',
        passed: 28,
        failed: 0,
        total: 28,
        failures: [],
        timestamp: '2026-04-07T02:42:00Z',
      },
    ],
    contextWindow: {
      used: 120000,
      total: 200000,
      percentage: 60,
      emoji: '😐',
    },
    usage: {
      sessionDuration: 2700, // 45m
      turnCount: 24,
      messages: { sent: 156, limit: 200 },
      tokens: { input: 70000, output: 50000, total: 120000 },
      cost: { amount: 0.72, currency: 'USD' },
    },
  },

  // Session 4 (running, different project): portfolio update
  {
    fileChanges: [
      {
        id: 'fc-8',
        path: 'src/styles/theme.css',
        type: 'modified',
        linesAdded: 15,
        linesRemoved: 8,
        timestamp: '2026-04-06T18:25:00Z',
      },
      {
        id: 'fc-9',
        path: 'src/components/Hero.tsx',
        type: 'modified',
        linesAdded: 12,
        linesRemoved: 5,
        timestamp: '2026-04-06T18:30:00Z',
      },
    ],
    toolCalls: [
      {
        id: 'tc-10',
        tool: 'Edit',
        args: 'src/styles/theme.css',
        status: 'done',
        timestamp: '2026-04-06T18:25:00Z',
        duration: 800,
      },
      {
        id: 'tc-11',
        tool: 'Edit',
        args: 'src/components/Hero.tsx',
        status: 'done',
        timestamp: '2026-04-06T18:30:00Z',
        duration: 700,
      },
    ],
    testResults: [],
    contextWindow: {
      used: 38000,
      total: 200000,
      percentage: 19,
      emoji: '😊',
    },
    usage: {
      sessionDuration: 912, // 15m 12s
      turnCount: 10,
      messages: { sent: 64, limit: 200 },
      tokens: { input: 22000, output: 16000, total: 38000 },
      cost: { amount: 0.23, currency: 'USD' },
    },
  },

  // Session 5 (completed, different project): rate limiting
  {
    fileChanges: [
      {
        id: 'fc-10',
        path: 'src/middleware/rateLimit.ts',
        type: 'new',
        linesAdded: 65,
        linesRemoved: 0,
        timestamp: '2026-04-05T12:30:00Z',
      },
      {
        id: 'fc-11',
        path: 'src/config/rateLimit.config.ts',
        type: 'new',
        linesAdded: 25,
        linesRemoved: 0,
        timestamp: '2026-04-05T12:35:00Z',
      },
    ],
    toolCalls: [
      {
        id: 'tc-12',
        tool: 'Write',
        args: 'src/middleware/rateLimit.ts',
        status: 'done',
        timestamp: '2026-04-05T12:30:00Z',
        duration: 1800,
      },
      {
        id: 'tc-13',
        tool: 'Write',
        args: 'src/config/rateLimit.config.ts',
        status: 'done',
        timestamp: '2026-04-05T12:35:00Z',
        duration: 600,
      },
    ],
    testResults: [
      {
        id: 'tr-3',
        file: 'tests/middleware/rateLimit.test.ts',
        passed: 12,
        failed: 0,
        total: 12,
        failures: [],
        timestamp: '2026-04-05T12:55:00Z',
      },
    ],
    contextWindow: {
      used: 95000,
      total: 200000,
      percentage: 47,
      emoji: '😊',
    },
    usage: {
      sessionDuration: 3000, // 50m
      turnCount: 18,
      messages: { sent: 124, limit: 200 },
      tokens: { input: 55000, output: 40000, total: 95000 },
      cost: { amount: 0.57, currency: 'USD' },
    },
  },
]
