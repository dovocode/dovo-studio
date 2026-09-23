import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import { isImageAttachment } from '@dovo/protocol'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun } from '../types.js'
export async function* claudeInput(run: AgentRun): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    ...(run.sessionId
      ? {
          session_id: run.sessionId,
        }
      : {}),
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: run.prompt,
        },
        ...(run.attachments ?? []).filter(isImageAttachment).map((file) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: decode(
              Schema.Literal('image/png', 'image/jpeg', 'image/gif', 'image/webp'),
              file.mime,
            ),
            data: file.data,
          },
        })),
      ],
    },
  }
}
