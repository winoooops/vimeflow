import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

interface BridgeHooks {
  'tool.execute.before': (
    input: { sessionID: string; tool: string; callID: string },
    output: { args: Record<string, unknown> }
  ) => Promise<void>
}

const importBridge = async (): Promise<BridgeHooks> => {
  const module = await import('./vimeflow-opencode-bridge.ts')

  return module.VimeflowOpencodeBridge({}) as Promise<BridgeHooks>
}

describe('VimeflowOpencodeBridge', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.VIMEFLOW_OPENCODE_BRIDGE_DIR
  })

  test('redacts credential key args before writing bridge JSONL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vimeflow-opencode-bridge-'))
    process.env.VIMEFLOW_OPENCODE_BRIDGE_DIR = dir

    try {
      const bridge = await importBridge()

      await bridge['tool.execute.before'](
        { sessionID: 'session-redact', tool: 'cloud', callID: 'call-redact' },
        {
          args: {
            accessKey: 'access-key-value',
            apiSecretKey: 'api-secret-key-value',
            awsSecretAccessKey: 'aws-secret-access-key-value',
            authKey: 'auth-key-value',
            encryptionKey: 'encryption-key-value',
            kmsEncryptionKey: 'kms-encryption-key-value',
            myAccessKey: 'my-access-key-value',
            safeKeyLabel: 'customer-key-alias',
            secretAccessKey: 'secret-access-key-value',
            secretKey: 'secret-key-value',
            signingKey: 'signing-key-value',
            webhookSigningKey: 'webhook-signing-key-value',
          },
        }
      )

      const line = readFileSync(join(dir, 'session-redact.jsonl'), 'utf8')
      const record = JSON.parse(line) as { args: Record<string, unknown> }

      expect(record.args).toMatchObject({
        accessKey: '[redacted]',
        apiSecretKey: '[redacted]',
        awsSecretAccessKey: '[redacted]',
        authKey: '[redacted]',
        encryptionKey: '[redacted]',
        kmsEncryptionKey: '[redacted]',
        myAccessKey: '[redacted]',
        safeKeyLabel: 'customer-key-alias',
        secretAccessKey: '[redacted]',
        secretKey: '[redacted]',
        signingKey: '[redacted]',
        webhookSigningKey: '[redacted]',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
