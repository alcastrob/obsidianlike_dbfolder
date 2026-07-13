// A small, safe (no eval/Function) expression language for formula columns.
// Grammar (precedence low -> high):
//   expr        := ternaryOr
//   ternaryOr   := logicalOr
//   logicalOr   := logicalAnd ( "||" logicalAnd )*
//   logicalAnd  := equality ( "&&" equality )*
//   equality    := comparison ( ("==" | "!=") comparison )*
//   comparison  := additive ( ("<" | "<=" | ">" | ">=") additive )*
//   additive    := multiplicative ( ("+" | "-") multiplicative )*
//   multiplicative := unary ( ("*" | "/" | "%") unary )*
//   unary       := ("!" | "-")? primary
//   primary     := number | string | boolean | call | identifier | "(" expr ")"
//   call        := identifier "(" (expr ("," expr)*)? ")"
//
// Identifiers resolve against the row's property values (bare name = prop lookup).

export type FormulaValue = string | number | boolean | undefined | FormulaValue[];

type TokenType =
  | "num"
  | "str"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      tokens.push({ type: "str", value: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: "num", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%<>!".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character in formula: '${ch}'`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

type Node =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "ident"; name: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "unary"; op: string; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private expect(type: TokenType): Token {
    const t = this.next();
    if (t.type !== type) throw new Error(`Formula parse error: expected ${type}, got ${t.type}`);
    return t;
  }

  parse(): Node {
    const node = this.parseOr();
    this.expect("eof");
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek().type === "op" && this.peek().value === "||") {
      this.next();
      left = { kind: "binary", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseEquality();
    while (this.peek().type === "op" && this.peek().value === "&&") {
      this.next();
      left = { kind: "binary", op: "&&", left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Node {
    let left = this.parseComparison();
    while (this.peek().type === "op" && ["==", "!="].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseAdditive();
    while (this.peek().type === "op" && ["<", "<=", ">", ">="].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    while (this.peek().type === "op" && ["+", "-"].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    while (this.peek().type === "op" && ["*", "/", "%"].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.peek().type === "op" && ["!", "-"].includes(this.peek().value)) {
      const op = this.next().value;
      return { kind: "unary", op, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.type === "num") {
      this.next();
      return { kind: "num", value: parseFloat(t.value) };
    }
    if (t.type === "str") {
      this.next();
      return { kind: "str", value: t.value };
    }
    if (t.type === "lparen") {
      this.next();
      const node = this.parseOr();
      this.expect("rparen");
      return node;
    }
    if (t.type === "ident") {
      this.next();
      if (t.value === "true") return { kind: "bool", value: true };
      if (t.value === "false") return { kind: "bool", value: false };
      if (this.peek().type === "lparen") {
        this.next();
        const args: Node[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseOr());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseOr());
          }
        }
        this.expect("rparen");
        return { kind: "call", name: t.value, args };
      }
      return { kind: "ident", name: t.value };
    }
    throw new Error(`Formula parse error: unexpected token '${t.value}'`);
  }
}

export function parseFormula(src: string): Node {
  return new Parser(tokenize(src)).parse();
}

function truthy(v: FormulaValue): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function toNum(v: FormulaValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

function toStr(v: FormulaValue): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return v.map(toStr).join(", ");
  return String(v);
}

const FUNCTIONS: Record<string, (args: FormulaValue[]) => FormulaValue> = {
  if: (a) => (truthy(a[0]) ? a[1] : a[2]),
  not: (a) => !truthy(a[0]),
  and: (a) => a.every(truthy),
  or: (a) => a.some(truthy),
  concat: (a) => a.map(toStr).join(""),
  join: (a) => a.slice(1).map(toStr).join(toStr(a[0])),
  lower: (a) => toStr(a[0]).toLowerCase(),
  upper: (a) => toStr(a[0]).toUpperCase(),
  length: (a) => (Array.isArray(a[0]) ? a[0].length : toStr(a[0]).length),
  round: (a) => Math.round(toNum(a[0])),
  floor: (a) => Math.floor(toNum(a[0])),
  ceil: (a) => Math.ceil(toNum(a[0])),
  abs: (a) => Math.abs(toNum(a[0])),
  min: (a) => Math.min(...a.map(toNum)),
  max: (a) => Math.max(...a.map(toNum)),
  contains: (a) => toStr(a[0]).toLowerCase().includes(toStr(a[1]).toLowerCase()),
  isEmpty: (a) => a[0] === undefined || a[0] === "" || (Array.isArray(a[0]) && a[0].length === 0),
  prop: (a) => a[0],
  now: () => new Date().toISOString(),
};

export function evaluateFormula(
  src: string,
  context: Record<string, unknown>
): FormulaValue {
  let ast: Node;
  try {
    ast = parseFormula(src);
  } catch {
    return undefined;
  }
  try {
    return evalNode(ast, context);
  } catch {
    return undefined;
  }
}

function evalNode(node: Node, ctx: Record<string, unknown>): FormulaValue {
  switch (node.kind) {
    case "num":
      return node.value;
    case "str":
      return node.value;
    case "bool":
      return node.value;
    case "ident": {
      const v = ctx[node.name];
      return v as FormulaValue;
    }
    case "unary": {
      const v = evalNode(node.arg, ctx);
      if (node.op === "!") return !truthy(v);
      if (node.op === "-") return -toNum(v);
      return undefined;
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new Error(`Unknown formula function: ${node.name}`);
      if (node.name === "prop") {
        // prop("key") reads directly from context, bypassing arg evaluation of the literal.
        const keyNode = node.args[0];
        const key = keyNode.kind === "str" ? keyNode.value : toStr(evalNode(keyNode, ctx));
        return ctx[key] as FormulaValue;
      }
      const args = node.args.map((a) => evalNode(a, ctx));
      return fn(args);
    }
    case "binary": {
      const { op } = node;
      if (op === "&&") return truthy(evalNode(node.left, ctx)) && truthy(evalNode(node.right, ctx));
      if (op === "||") return truthy(evalNode(node.left, ctx)) || truthy(evalNode(node.right, ctx));
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (op) {
        case "+":
          return typeof l === "string" || typeof r === "string" ? toStr(l) + toStr(r) : toNum(l) + toNum(r);
        case "-":
          return toNum(l) - toNum(r);
        case "*":
          return toNum(l) * toNum(r);
        case "/":
          return toNum(l) / toNum(r);
        case "%":
          return toNum(l) % toNum(r);
        case "==":
          return toStr(l) === toStr(r);
        case "!=":
          return toStr(l) !== toStr(r);
        case "<":
          return toNum(l) < toNum(r);
        case "<=":
          return toNum(l) <= toNum(r);
        case ">":
          return toNum(l) > toNum(r);
        case ">=":
          return toNum(l) >= toNum(r);
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}
