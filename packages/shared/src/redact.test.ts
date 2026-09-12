import { expect, test } from 'vitest'

import { redactEntry } from './redact.ts'

test('keeps the identity of an entry and redacts what it said', () => {
  const redacted = redactEntry({
    type: 'assistant',
    uuid: '4b12c00f-902c-4081-b490-bd764c69760f',
    parentUuid: '13482ad8-954d-4149-8074-baffdbe0b23c',
    sessionId: '456e47f6-e387-59c4-b84c-21c031bb3504',
    agentId: 'adf0b292e3273f8b9',
    requestId: 'req_011CeyFToqHgNsHY9aMUtiTK',
    timestamp: '2026-09-12T09:50:00.000Z',
    apiBlockIndex: 0,
    message: {
      id: 'msg_011CeyFTpJKjmFVjAks1GSD8',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'the AWS key is AKIAIOSFODNN7EXAMPLE' }],
    },
  })

  expect(redacted).toEqual({
    type: 'assistant',
    uuid: '4b12c00f-902c-4081-b490-bd764c69760f',
    parentUuid: '13482ad8-954d-4149-8074-baffdbe0b23c',
    sessionId: '456e47f6-e387-59c4-b84c-21c031bb3504',
    agentId: 'adf0b292e3273f8b9',
    requestId: 'req_011CeyFToqHgNsHY9aMUtiTK',
    timestamp: '2026-09-12T09:50:00.000Z',
    apiBlockIndex: 0,
    message: {
      id: 'msg_011CeyFTpJKjmFVjAks1GSD8',
      role: 'assistant',
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '[redacted:35]' }],
    },
  })
})

test('keeps the whole usage subtree verbatim, because cost is computed from it', () => {
  const usage = {
    input_tokens: 2,
    cache_creation_input_tokens: 20330,
    cache_read_input_tokens: 35869,
    cache_creation: {
      ephemeral_5m_input_tokens: 20330,
      ephemeral_1h_input_tokens: 0,
    },
    output_tokens: 202,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 3 },
    service_tier: 'standard',
    inference_geo: 'not_available',
    speed: 'standard',
    iterations: [
      { input_tokens: 2, output_tokens: 202, type: 'message', model: null },
    ],
  }

  expect(redactEntry({ type: 'assistant', message: { usage } })).toEqual({
    type: 'assistant',
    message: { usage },
  })
})

test('redacts a tool call argument but keeps which tool was called', () => {
  const redacted = redactEntry({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_01VoAcj9Gn3LhyuZoyvxQ2Ab',
          name: 'Bash',
          input: { command: 'psql "postgres://user:hunter2@db/prod"' },
        },
      ],
    },
  })

  expect(redacted).toEqual({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_01VoAcj9Gn3LhyuZoyvxQ2Ab',
          name: 'Bash',
          input: '[redacted:54]',
        },
      ],
    },
  })
})

test('redacts tool output but keeps the call it answers and whether it failed', () => {
  const redacted = redactEntry({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01VoAcj9Gn3LhyuZoyvxQ2Ab',
          is_error: true,
          content: 'FATAL: password authentication failed for user "sessclone"',
        },
      ],
    },
  })

  expect(redacted).toEqual({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01VoAcj9Gn3LhyuZoyvxQ2Ab',
          is_error: true,
          content: '[redacted:58]',
        },
      ],
    },
  })
})

test('keeps a compaction boundary whole and redacts the summary it wrote', () => {
  const boundary = redactEntry({
    type: 'system',
    subtype: 'compact_boundary',
    uuid: '8a4f9db1-712b-422e-a11c-0c7332f69c3d',
    parentUuid: null,
    logicalParentUuid: '7be48ffb-9e2b-45f0-952b-16dffcfcc1dd',
    compactMetadata: {
      trigger: 'manual',
      preTokens: 53991,
      postTokens: 24482,
      durationMs: 11574,
      cumulativeDroppedTokens: 29509,
    },
  })

  expect(boundary).toEqual({
    type: 'system',
    subtype: 'compact_boundary',
    uuid: '8a4f9db1-712b-422e-a11c-0c7332f69c3d',
    parentUuid: null,
    logicalParentUuid: '7be48ffb-9e2b-45f0-952b-16dffcfcc1dd',
    compactMetadata: {
      trigger: 'manual',
      preTokens: 53991,
      postTokens: 24482,
      durationMs: 11574,
      cumulativeDroppedTokens: 29509,
    },
  })

  const summary = redactEntry({
    type: 'user',
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: 'The user asked me to deploy to prod.' },
  })

  expect(summary).toEqual({
    type: 'user',
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: '[redacted:36]' },
  })
})

test('redacts a field it has never heard of rather than passing it through', () => {
  const redacted = redactEntry({
    type: 'assistant',
    rendered: 'Claude Code printed this to the terminal',
    aFieldAddedByAFutureRelease: { secret: 'sk-ant-api03-xxxx' },
  })

  expect(redacted).toEqual({
    type: 'assistant',
    rendered: '[redacted:40]',
    aFieldAddedByAFutureRelease: '[redacted:30]',
  })
})

test('keeps which bookkeeping entry this is and redacts everything it carried', () => {
  const redacted = redactEntry({
    type: 'attachment',
    uuid: 'aef5ad4b-6da3-2cda-2000-000000000000',
    attachment: {
      type: 'hook_result',
      hookEvent: 'PostToolUse',
      hookName: 'stop-hook-git-check',
      toolUseID: 'toolu_01VoAcj9Gn3LhyuZoyvxQ2Ab',
      exitCode: 0,
      durationMs: 42,
      command: 'bash ~/.claude/stop-hook-git-check.sh',
      stdout: 'On branch claude/serene-albattani-xfppyq',
      stderr: '',
    },
  })

  expect(redacted).toEqual({
    type: 'attachment',
    uuid: 'aef5ad4b-6da3-2cda-2000-000000000000',
    attachment: {
      type: 'hook_result',
      hookEvent: 'PostToolUse',
      hookName: 'stop-hook-git-check',
      toolUseID: 'toolu_01VoAcj9Gn3LhyuZoyvxQ2Ab',
      exitCode: 0,
      durationMs: 42,
      command: '[redacted:37]',
      stdout: '[redacted:40]',
      stderr: '[redacted:0]',
    },
  })
})

test('keeps the working directory and the queue operation, which are structure not content', () => {
  const redacted = redactEntry({
    type: 'queue-operation',
    operation: 'enqueue',
    cwd: '/tmp/spike-03',
    sessionId: '107a81c9-c459-44a7-bdb4-86661d276d5b',
    content: 'run the deploy script against prod',
  })

  expect(redacted).toEqual({
    type: 'queue-operation',
    operation: 'enqueue',
    cwd: '/tmp/spike-03',
    sessionId: '107a81c9-c459-44a7-bdb4-86661d276d5b',
    content: '[redacted:34]',
  })
})
