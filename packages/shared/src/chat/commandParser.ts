import type { ChatChannel } from '../types/chat.js';

export type CommandResult =
  | { kind: 'message'; content: string }
  | { kind: 'channel'; channel: Exclude<ChatChannel, 'system'>; content?: string }
  | { kind: 'help' }
  | { kind: 'invite'; username: string }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'leave' }
  | { kind: 'report'; content: string }
  | { kind: 'error'; error: 'unknown_command' | 'invalid_arguments' | 'missing_arguments' };

const channelCommands: Record<string, Exclude<ChatChannel, 'system'>> = {
  team: 'team',
  region: 'region',
  global: 'global',
};

export function parseChatCommand(input: string): CommandResult {
  if (!input.startsWith('/')) return { kind: 'message', content: input };
  const match = input.match(/^\/([^ ]+)(?: (.*))?$/s);
  if (!match) return { kind: 'error', error: 'unknown_command' };
  const command = match[1]!;
  const rawArgs = match[2];
  const args = rawArgs === undefined ? [] : rawArgs.split(' ');
  const content = rawArgs ?? '';
  if (command in channelCommands) {
    return rawArgs === undefined
      ? { kind: 'channel', channel: channelCommands[command]! }
      : { kind: 'channel', channel: channelCommands[command]!, content };
  }
  if (command === 'help') return args.length ? { kind: 'error', error: 'invalid_arguments' } : { kind: 'help' };
  if (command === 'accept') return args.length ? { kind: 'error', error: 'invalid_arguments' } : { kind: 'accept' };
  if (command === 'reject') return args.length ? { kind: 'error', error: 'invalid_arguments' } : { kind: 'reject' };
  if (command === 'leave') return args.length ? { kind: 'error', error: 'invalid_arguments' } : { kind: 'leave' };
  if (command === 'invite') return args.length === 1 && args[0] ? { kind: 'invite', username: args[0] } : { kind: 'error', error: args.length === 0 ? 'missing_arguments' : 'invalid_arguments' };
  if (command === 'report') return content.trim() ? { kind: 'report', content } : { kind: 'error', error: 'missing_arguments' };
  return { kind: 'error', error: 'unknown_command' };
}
