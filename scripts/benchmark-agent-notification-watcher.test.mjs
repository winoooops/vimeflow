import { describe, expect, test } from 'vitest'
import {
  parseBenchmarkArgs,
  parseLinuxProcessSnapshot,
  summarizeSamples,
} from './benchmark-agent-notification-watcher.mjs'

describe('agent notification watcher benchmark', () => {
  test('parses Linux process metrics without depending on command output', () => {
    expect(
      parseLinuxProcessSnapshot({
        status: 'Name:\tvimeflow\nVmRSS:\t2048 kB\nThreads:\t3\n',
        stat: '42 (vimeflow backend) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14',
        fdCount: 7,
        sampledAtNs: 1n,
      })
    ).toEqual({
      sampledAtNs: 1n,
      rssBytes: 2 * 1024 * 1024,
      threads: 3,
      fdCount: 7,
      cpuTicks: 23,
    })
  })

  test('summarizes RSS, CPU, threads, and file descriptors', () => {
    expect(
      summarizeSamples(
        [
          {
            sampledAtNs: 0n,
            rssBytes: 10,
            threads: 2,
            fdCount: 4,
            cpuTicks: 100,
          },
          {
            sampledAtNs: 2_000_000_000n,
            rssBytes: 30,
            threads: 3,
            fdCount: 5,
            cpuTicks: 120,
          },
          {
            sampledAtNs: 4_000_000_000n,
            rssBytes: 20,
            threads: 2,
            fdCount: 4,
            cpuTicks: 140,
          },
        ],
        100
      )
    ).toEqual({
      rssBytesMedian: 20,
      rssBytesMax: 30,
      cpuPercentOneCore: 10,
      threadsMax: 3,
      fdCountMax: 5,
    })
  })

  test('accepts short-run overrides for local smoke baselines', () => {
    expect(
      parseBenchmarkArgs([
        '--mode',
        'treatment',
        '--watchers',
        '2',
        '--warmup-ms',
        '1',
        '--idle-ms',
        '2',
        '--load-ms',
        '3',
        '--output',
        '/tmp/report.json',
      ])
    ).toMatchObject({
      mode: 'treatment',
      watchers: 2,
      warmupMs: 1,
      idleMs: 2,
      loadMs: 3,
      output: '/tmp/report.json',
    })
  })
})
