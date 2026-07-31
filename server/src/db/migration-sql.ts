type SqlLexicalState =
  | 'normal'
  | 'single-quote'
  | 'double-quote'
  | 'backtick'
  | 'line-comment'
  | 'block-comment';

export function splitMariaDbStatements(sql: string): string[] {
  const statements: string[] = [];
  let statement = '';
  let state: SqlLexicalState = 'normal';
  let hasExecutableToken = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];

    if (state === 'line-comment') {
      statement += character;
      if (character === '\n') {
        state = 'normal';
      }
      continue;
    }
    if (state === 'block-comment') {
      statement += character;
      if (character === '*' && next === '/') {
        statement += next;
        index += 1;
        state = 'normal';
      }
      continue;
    }
    if (state !== 'normal') {
      statement += character;
      if (character === '\\' && next !== undefined) {
        statement += next;
        index += 1;
        continue;
      }
      const quote =
        state === 'single-quote'
          ? "'"
          : state === 'double-quote'
            ? '"'
            : '`';
      if (character === quote && next === quote) {
        statement += next;
        index += 1;
      } else if (character === quote) {
        state = 'normal';
      }
      continue;
    }
    if (
      character === '-' &&
      next === '-' &&
      (sql[index + 2] === undefined || /\s/.test(sql[index + 2]!))
    ) {
      statement += '--';
      index += 1;
      state = 'line-comment';
      continue;
    }
    if (character === '#') {
      statement += character;
      state = 'line-comment';
      continue;
    }
    if (character === '/' && next === '*') {
      statement += '/*';
      index += 1;
      state = 'block-comment';
      continue;
    }
    if (character === ';') {
      if (hasExecutableToken) {
        statements.push(statement.trim());
      }
      statement = '';
      hasExecutableToken = false;
      continue;
    }

    statement += character;
    if (character === "'") {
      state = 'single-quote';
      hasExecutableToken = true;
    } else if (character === '"') {
      state = 'double-quote';
      hasExecutableToken = true;
    } else if (character === '`') {
      state = 'backtick';
      hasExecutableToken = true;
    } else if (!/\s/.test(character)) {
      hasExecutableToken = true;
    }
  }

  if (state !== 'normal' && state !== 'line-comment') {
    throw new Error(
      'Migration SQL contains an unterminated quoted value or comment',
    );
  }
  if (hasExecutableToken) {
    statements.push(statement.trim());
  }
  return statements;
}
