import type { TokenType, TokenValue } from './types';

export interface ParserHandlers {
  openObject(key: string | number | null): void;
  openArray(key: string | number | null): void;
  closeObject(): void;
  closeArray(): void;
  value(key: string | number | null, v: string | number | boolean | null): void;
}

type Expecting = 'value' | 'value_or_close' | 'key_or_close' | 'key' | 'colon' | 'comma_or_close' | 'done';

export interface Parser {
  onToken(type: TokenType, value?: TokenValue): void;
}

export function createParser(handlers: ParserHandlers): Parser {
  const stack: ('object' | 'array')[] = [];
  let expecting: Expecting = 'value';
  let pendingKey: string | null = null;

  function afterValue() {
    expecting = stack.length === 0 ? 'done' : 'comma_or_close';
  }

  function onToken(type: TokenType, value?: TokenValue) {
    switch (expecting) {
      case 'value':
      case 'value_or_close':
        if (expecting === 'value_or_close' && type === 'rbracket') {
          stack.pop();
          handlers.closeArray();
          afterValue();
          return;
        }
        if (type === 'lbrace') {
          handlers.openObject(pendingKey);
          pendingKey = null;
          stack.push('object');
          expecting = 'key_or_close';
        } else if (type === 'lbracket') {
          handlers.openArray(pendingKey);
          pendingKey = null;
          stack.push('array');
          expecting = 'value_or_close';
        } else {
          let v: string | number | boolean | null;
          if (type === 'string' || type === 'number') v = value as string | number;
          else if (type === 'true') v = true;
          else if (type === 'false') v = false;
          else if (type === 'null') v = null;
          else throw new Error(`Expected value, got ${type}`);
          handlers.value(pendingKey, v);
          pendingKey = null;
          afterValue();
        }
        break;
      case 'key_or_close':
        if (type === 'rbrace') {
          stack.pop();
          handlers.closeObject();
          afterValue();
        } else if (type === 'string') {
          pendingKey = value as string;
          expecting = 'colon';
        } else throw new Error(`Expected key or }, got ${type}`);
        break;
      case 'key':
        if (type === 'string') {
          pendingKey = value as string;
          expecting = 'colon';
        } else throw new Error(`Expected key, got ${type}`);
        break;
      case 'colon':
        if (type === 'colon') expecting = 'value';
        else throw new Error(`Expected ':', got ${type}`);
        break;
      case 'comma_or_close': {
        const top = stack[stack.length - 1];
        if (type === 'comma') expecting = top === 'object' ? 'key' : 'value';
        else if (type === 'rbrace' && top === 'object') {
          stack.pop();
          handlers.closeObject();
          afterValue();
        } else if (type === 'rbracket' && top === 'array') {
          stack.pop();
          handlers.closeArray();
          afterValue();
        } else throw new Error(`Expected ',' or close, got ${type}`);
        break;
      }
      case 'done':
        break;
    }
  }

  return { onToken };
}
