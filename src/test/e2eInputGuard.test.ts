import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import * as ts from 'typescript'
import { describe, expect, test } from 'vitest'

const E2E_ROOT = path.join(process.cwd(), 'tests/e2e')

const listTypeScriptFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })

  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        return listTypeScriptFiles(fullPath)
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : []
    })
  )

  return nested.flat()
}

const isBrowserKeysCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === 'browser' &&
  node.expression.name.text === 'keys'

const findBrowserKeysCalls = (sourceFile: ts.SourceFile): string[] => {
  const calls: string[] = []

  const visit = (node: ts.Node): void => {
    if (isBrowserKeysCall(node)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile)
      )
      calls.push(
        `${path.relative(process.cwd(), sourceFile.fileName)}:${line + 1}:${character + 1}`
      )
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return calls
}

describe('e2e terminal input guard', () => {
  test('does not use batched browser.keys calls in e2e files', async () => {
    const filePaths = await listTypeScriptFiles(E2E_ROOT)

    expect(filePaths.length).toBeGreaterThan(0)

    const findings = (
      await Promise.all(
        filePaths.map(async (filePath): Promise<string[]> => {
          const source = await readFile(filePath, 'utf8')

          const sourceFile = ts.createSourceFile(
            filePath,
            source,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          )

          return findBrowserKeysCalls(sourceFile)
        })
      )
    ).flat()

    expect(findings).toEqual([])
  })
})
