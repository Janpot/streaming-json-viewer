import type { TokenType, TokenValue } from './types';

export type OnToken = (type: TokenType, value?: TokenValue) => void;

type State = 'default' | 'string' | 'string_escape' | 'string_unicode' | 'number' | 'literal';

export interface Tokenizer {
  feed(text: string): void;
  end(): void;
}

export function createTokenizer(onToken: OnToken): Tokenizer {
  let state: State = 'default';
  let strBuf = '';
  let numBuf = '';
  let litBuf = '';
  let uniBuf = '';

  const escapeMap: Record<string, string> = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
  };

  function emitLiteral() {
    if (litBuf === 'true') onToken('true');
    else if (litBuf === 'false') onToken('false');
    else if (litBuf === 'null') onToken('null');
    else throw new Error(`Unknown literal '${litBuf}'`);
  }

  function feed(text: string) {
    let i = 0;
    while (i < text.length) {
      const c = text[i]!;
      switch (state) {
        case 'default':
          if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
            i++;
            break;
          }
          if (c === '{') {
            onToken('lbrace');
            i++;
            break;
          }
          if (c === '}') {
            onToken('rbrace');
            i++;
            break;
          }
          if (c === '[') {
            onToken('lbracket');
            i++;
            break;
          }
          if (c === ']') {
            onToken('rbracket');
            i++;
            break;
          }
          if (c === ':') {
            onToken('colon');
            i++;
            break;
          }
          if (c === ',') {
            onToken('comma');
            i++;
            break;
          }
          if (c === '"') {
            state = 'string';
            strBuf = '';
            i++;
            break;
          }
          if (c === '-' || (c >= '0' && c <= '9')) {
            state = 'number';
            numBuf = c;
            i++;
            break;
          }
          if (c >= 'a' && c <= 'z') {
            state = 'literal';
            litBuf = c;
            i++;
            break;
          }
          throw new Error(`Unexpected character '${c}'`);
        case 'string':
          if (c === '"') {
            onToken('string', strBuf);
            state = 'default';
            i++;
            break;
          }
          if (c === '\\') {
            state = 'string_escape';
            i++;
            break;
          }
          strBuf += c;
          i++;
          break;
        case 'string_escape':
          if (c in escapeMap) {
            strBuf += escapeMap[c];
            state = 'string';
            i++;
          } else if (c === 'u') {
            state = 'string_unicode';
            uniBuf = '';
            i++;
          } else {
            throw new Error(`Bad escape \\${c}`);
          }
          break;
        case 'string_unicode':
          uniBuf += c;
          i++;
          if (uniBuf.length === 4) {
            strBuf += String.fromCharCode(parseInt(uniBuf, 16));
            state = 'string';
          }
          break;
        case 'number':
          if (
            (c >= '0' && c <= '9') ||
            c === '.' ||
            c === 'e' ||
            c === 'E' ||
            c === '+' ||
            c === '-'
          ) {
            numBuf += c;
            i++;
          } else {
            onToken('number', parseFloat(numBuf));
            state = 'default';
          }
          break;
        case 'literal':
          if (c >= 'a' && c <= 'z') {
            litBuf += c;
            i++;
          } else {
            emitLiteral();
            state = 'default';
          }
          break;
      }
    }
  }

  function end() {
    if (state === 'number') {
      onToken('number', parseFloat(numBuf));
      state = 'default';
    } else if (state === 'literal') {
      emitLiteral();
      state = 'default';
    }
    if (state !== 'default') throw new Error('Unexpected end of input');
  }

  return { feed, end };
}
