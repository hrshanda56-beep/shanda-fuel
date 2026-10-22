import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function hasClientDirective(source: string): boolean {
  const file = ts.createSourceFile(
    'component.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const first = file.statements[0];
  return Boolean(
    first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client',
  );
}

describe('operations client boundary', () => {
  it('recognizes a top-level directive', () => {
    expect(hasClientDirective("'use client'; import { useState } from 'react';")).toBe(true);
  });

  it('rejects misplaced or parenthesized strings', () => {
    expect(hasClientDirective("import 'react'; 'use client';")).toBe(false);
    expect(hasClientDirective("('use client');")).toBe(false);
  });

  it('declares the control room as a client entry point before its imports', () => {
    expect(
      hasClientDirective(
        readFileSync('src/modules/forecourt/ui/operations-control-room.tsx', 'utf8'),
      ),
    ).toBe(true);
  });
});
