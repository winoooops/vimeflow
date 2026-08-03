#!/usr/bin/env node

import fs from 'node:fs'

const rolloutPath = process.argv[2]
if (!rolloutPath) {
  throw new Error('usage: dummy-codex-agent.mjs <rollout-path>')
}

const agentSessionId = `dummy-codex-${process.pid}`
let turn = 0

const append = (type, payload) => {
  fs.appendFileSync(
    rolloutPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`,
    'utf8'
  )
}

append('session_meta', {
  id: agentSessionId,
  cwd: process.cwd(),
  originator: 'codex_exec',
  cli_version: 'e2e',
  source: 'exec',
  model_provider: 'openai',
})

process.stdin.setEncoding('utf8')
let input = ''

process.stdin.on('data', (chunk) => {
  input += chunk
  const lines = input.split(/\r?\n/)
  input = lines.pop() ?? ''

  for (const line of lines) {
    const [command, countText] = line.trim().split(/\s+/, 2)

    if (command === 'start') {
      turn += 1
      append('turn_context', {
        turn_id: `turn-${turn}`,
        cwd: process.cwd(),
        model: 'gpt-5-codex',
        personality: 'pragmatic',
        effort: 'xhigh',
      })
      append('event_msg', {
        type: 'task_started',
        turn_id: `turn-${turn}`,
        started_at: Math.floor(Date.now() / 1000),
        model_context_window: 200_000,
      })
      append('event_msg', {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
            total_tokens: 2,
          },
          model_context_window: 200_000,
        },
      })
      process.stdout.write(`STARTED ${turn}\n`)
    } else if (command === 'noise') {
      const count = Number.parseInt(countText ?? '', 10)
      if (!Number.isInteger(count) || count < 0 || count > 10_000) {
        process.stdout.write('ERROR noise expects 0..10000\n')
        continue
      }
      for (let index = 0; index < count; index += 1) {
        append('event_msg', {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: index + 1,
              cached_input_tokens: 0,
              output_tokens: 1,
              reasoning_output_tokens: 0,
              total_tokens: index + 2,
            },
            model_context_window: 200_000,
          },
        })
      }
      process.stdout.write(`NOISE ${count}\n`)
    } else if (command === 'complete') {
      append('event_msg', {
        type: 'task_complete',
        turn_id: `turn-${turn}`,
        completed_at: Math.floor(Date.now() / 1000),
        duration_ms: 1_000,
        last_agent_message: 'done',
      })
      process.stdout.write(`COMPLETED ${turn}\n`)
    } else if (command === 'approval') {
      append('event_msg', {
        type: 'exec_approval_request',
        approval_id: `approval-${turn}`,
      })
      process.stdout.write('APPROVAL\n')
    } else if (command === 'question') {
      append('response_item', {
        type: 'function_call',
        name: 'request_user_input',
        call_id: `question-${turn}`,
        arguments: '{}',
      })
      process.stdout.write('QUESTION\n')
    } else if (command === 'error') {
      append('event_msg', {
        type: 'exec_command_end',
        call_id: `error-${turn}`,
        exit_code: 1,
        aggregated_output: 'dummy failure',
      })
      process.stdout.write('ERROR\n')
    } else if (command === 'exit') {
      process.stdout.write('EXITING\n')
      process.exit(0)
    } else if (command !== '') {
      process.stdout.write(`ERROR unknown command: ${command}\n`)
    }
  }
})

process.stdout.write(`READY ${agentSessionId}\n`)
