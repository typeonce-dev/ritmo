import ts from "typescript6"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"

export interface Component { slot: string; name: string; fields: string[] | null; write: boolean; offset: number; mark: number }
export interface Query { name: string; components: Component[] }
export interface Resource { name: string; fields: string[] | null; offset: number }
export interface Kernel { id: number; name: string; file: string; line: number; start: number; end: number; game: string; arguments: string[]; queries: Query[]; resources: Resource[]; layouts: Record<string, string[] | null>; hash: string; code: string }
export interface Diagnostic { name: string; file: string; line: number; reason: string; rule: string }
export interface Analysis { kernels: Kernel[]; interpreted: Diagnostic[] }
export class Ineligible extends Error { readonly node: ts.Node; constructor(message: string, node: ts.Node) { super(message); this.node = node } }
export const analyze = (entry: string): Analysis => {
  const configPath = ts.findConfigFile(dirname(entry), ts.sys.fileExists)
  const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : { config: {} }
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, configPath ? dirname(configPath) : dirname(entry)).options
  const program = ts.createProgram([entry], { ...options, noEmit: true }), checker = program.getTypeChecker()
  const kernels: Kernel[] = [], interpreted: Diagnostic[] = []
  const fail = (message: string, node: ts.Node): never => { throw new Ineligible(message, node) }
  const unparen = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) ? unparen(node.expression) : node
  const definition = (node: ts.Expression, visited = new Set<ts.Symbol>()): ts.Expression => {
    node = unparen(node)
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node)
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
      if (symbol && !visited.has(symbol)) {
        visited.add(symbol)
        const decl = symbol.valueDeclaration
        if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return definition(decl.initializer, visited)
      }
    }
    return node
  }
  const properties = (node: ts.Expression): ts.PropertyAssignment[] => {
    const obj = definition(node)
    if (!ts.isObjectLiteralExpression(obj)) return fail("Use a statically declared object literal", node)
    return obj.properties.map((p) => {
      if (ts.isShorthandPropertyAssignment(p)) return ts.factory.createPropertyAssignment(p.name, p.name)
      if (!ts.isPropertyAssignment(p) || !p.name || ts.isComputedPropertyName(p.name)) return fail("Object spreads and computed properties stay interpreted", p)
      return p
    })
  }
  const propName = (node: ts.PropertyAssignment): string => node.name.getText().replace(/^["']|["']$/g, "")
  const isNumber = (type: ts.Type): boolean => !!(type.flags & ts.TypeFlags.NumberLike) || type.isIntersection() && type.types.some(isNumber)
  const layout = (type: ts.Type, node: ts.Node): string[] | null => {
    if (isNumber(type)) return null
    if (!(type.flags & ts.TypeFlags.Object) && !type.isIntersection()) return fail("Only numbers and objects containing only numeric fields compile", node)
    const fields = checker.getPropertiesOfType(type).filter((f) => !(f.name === "__publicBrand" && f.declarations?.some((d) => /[\\/]internal[\\/]brand(?:\.d)?\.ts$/.test(d.getSourceFile().fileName))))
    if (fields.some((f) => f.flags & ts.SymbolFlags.Optional || !isNumber(checker.getTypeOfSymbolAtLocation(f, node)))) return fail("Only numbers and objects containing only numeric fields compile", node)
    return fields.map((f) => f.name).sort()
  }
  const descriptor = (expr: ts.Expression): { name: string; fields: string[] | null; constructed: boolean; immutable: boolean } => {
    const type = checker.getTypeAtLocation(expr), name = checker.getPropertyOfType(type, "name")
    if (!name) return fail("Use a statically resolved component or resource descriptor", expr)
    const nameType = checker.getTypeOfSymbolAtLocation(name, expr)
    if (!nameType.isStringLiteral()) return fail("Descriptor name must be a string literal", expr)
    const props = checker.getPropertiesOfType(type), marker = props.find((p) => (p.name === "~ritmo/Descriptor" || p.name.startsWith("__@descriptorTypeId")))
    const phantom = marker && checker.getTypeOfSymbolAtLocation(marker, expr)
    const value = phantom && checker.getPropertyOfType(phantom, "_Value")
    const signature = value && checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(value, expr), ts.SignatureKind.Call)[0]
    if (!signature) return fail("Cannot resolve the descriptor's numeric value type", expr)
    return { name: nameType.value, fields: layout(checker.getReturnTypeOfSignature(signature), expr),
      constructed: props.some((p) => p.name.startsWith("__@descriptorConstruction")), immutable: definition(expr).getText().includes("immutable: true") }
  }
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || file.fileName.includes("node_modules") || /packages\/(core|browser|render|pixi|math|devtools|native)\/src\//.test(file.fileName.replaceAll("\\", "/"))) continue
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "System") {
        const [nameNode, specNode, callbackNode] = node.arguments
        if (!nameNode || !ts.isStringLiteral(nameNode) || !specNode || !callbackNode) { ts.forEachChild(node, visit); return }
        const name = nameNode.text
        try {
          const callback = definition(callbackNode)
          if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) fail("Use one inline arrow or function callback", callback)
          const queries: Query[] = [], resources: Resource[] = [], layouts: Record<string, string[] | null> = Object.create(null)
          for (const property of properties(specNode)) {
            const key = propName(property)
            if (key !== "queries" && key !== "resources") fail(`${key} stays interpreted; the first subset accepts queries and read-only numeric resources`, property)
            if (key === "queries") for (const item of properties(property.initializer)) {
              const query = definition(item.initializer)
              if (!ts.isCallExpression(query) || !ts.isPropertyAccessExpression(query.expression) || query.expression.name.text !== "Query" || !query.arguments[0]) fail("Use a statically declared Game.Query", item)
              const components: Component[] = []; let offset = 0, mark = 0
              for (const field of properties((query as ts.CallExpression).arguments[0]!)) {
                const fieldName = propName(field)
                if (fieldName === "with" || fieldName === "without") {
                  if (!ts.isArrayLiteralExpression(field.initializer)) fail("Use literal component filter arrays", field)
                  continue
                }
                if (fieldName !== "selection") fail(`${fieldName} filters stay interpreted`, field)
                for (const selected of properties(field.initializer)) {
                  const access = definition(selected.initializer)
                  if (!ts.isCallExpression(access) || !ts.isPropertyAccessExpression(access.expression) || !["read", "write"].includes(access.expression.name.text) || !access.arguments[0]) fail("Only read and write query selections compile", selected)
                  const call = access as ts.CallExpression, data = descriptor(call.arguments[0]!), write = (call.expression as ts.PropertyAccessExpression).name.text === "write"
                  if (write && data.immutable) fail("Immutable components cannot be written by kernels", selected)
                  layouts[data.name] = data.fields
                  components.push({ slot: propName(selected), name: data.name, fields: data.fields, write, offset, mark: write ? mark++ : -1 })
                  offset += data.fields?.length ?? 1
                }
              }
              queries.push({ name: propName(item), components })
            }
            if (key === "resources") {
              let offset = 0
              for (const item of properties(property.initializer)) {
                const access = definition(item.initializer)
                if (!ts.isCallExpression(access) || !ts.isPropertyAccessExpression(access.expression) || access.expression.name.text !== "readResource" || !access.arguments[0]) fail("Resources must use readResource", item)
                const data = descriptor((access as ts.CallExpression).arguments[0]!)
                resources.push({ name: propName(item), fields: data.fields, offset }); offset += data.fields?.length ?? 1
              }
            }
          }
          if (!queries.length) fail("A kernel needs at least one per-entity query", node)
          const emitter = new Emitter(checker, queries, resources, definition, fail)
          const code = emitter.emit(callback as ts.ArrowFunction | ts.FunctionExpression)
          const hash = createHash("sha256").update(JSON.stringify({ queries, resources })).digest("hex")
          kernels.push({ id: 0, name, file: file.fileName, line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, start: node.getStart(), end: node.end,
            game: node.expression.expression.getText(file), arguments: node.arguments.map((a) => a.getText(file)), queries, resources, layouts, hash, code })
        } catch (error) {
          if (!(error instanceof Ineligible)) throw error
          const source = error.node.getSourceFile() ?? file
          interpreted.push({ name, file: source.fileName, line: source.getLineAndCharacterOfPosition(Math.max(0, error.node.pos)).line + 1, reason: error.message, rule: "packages/native/README.md#compiled-subset" })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  kernels.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).forEach((k, id) => { k.id = id })
  interpreted.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return { kernels, interpreted }
}

type Value = { kind: "scalar"; code: string } | { kind: "object"; fields: Record<string, Value> } | { kind: "query"; index: number } | { kind: "cell"; query: number; component: Component; slot: string } | { kind: "resource"; resource: Resource }
const scalar = (code: string): Value => ({ kind: "scalar", code })
const object = (fields: Record<string, Value>): Value => ({ kind: "object", fields })
class Emitter {
  #next = 0; #depth = 0
  #env = new Map<string, Value>()
  #lines: string[] = []
  readonly checker: ts.TypeChecker; readonly queries: Query[]; readonly resources: Resource[]
  readonly definition: (n: ts.Expression) => ts.Expression
  readonly fail: (message: string, node: ts.Node) => never
  constructor(checker: ts.TypeChecker, queries: Query[], resources: Resource[], definition: (n: ts.Expression) => ts.Expression, fail: (message: string, node: ts.Node) => never) {
    this.checker = checker; this.queries = queries; this.resources = resources; this.definition = definition; this.fail = fail
  }
  fresh(prefix = "v") { return `${prefix}_${this.#next++}` }
  line(code: string) { this.#lines.push(code) }
  number(value: Value, node: ts.Node): string { return value.kind === "scalar" ? value.code : this.fail("Use a numeric or boolean expression here", node) }
  get(cell: Extract<Value, { kind: "cell" }>): Value {
    const column = (i: number) => scalar(`args->queries[${cell.query}].columns[${cell.component.offset + i}][${cell.slot}]`)
    return cell.component.fields === null ? column(0) : object(Object.fromEntries(cell.component.fields.map((f, i) => [f, column(i)])))
  }
  expr(raw: ts.Expression): Value {
    const n = ts.isAsExpression(raw) || ts.isNonNullExpression(raw) || ts.isSatisfiesExpression(raw) || ts.isParenthesizedExpression(raw) ? raw.expression : raw
    if (n !== raw) return this.expr(n)
    if (ts.isNumericLiteral(n)) { const value = Number(n.text.replaceAll("_", "")); return scalar(!Number.isFinite(value) ? "INFINITY" : Number.isInteger(value) && !String(value).includes("e") ? `${value}.0` : String(value)) }
    if (n.kind === ts.SyntaxKind.TrueKeyword) return scalar("1.0")
    if (n.kind === ts.SyntaxKind.FalseKeyword) return scalar("0.0")
    if (ts.isIdentifier(n)) {
      const known = this.#env.get(n.text); if (known) return known
      let symbol = this.checker.getSymbolAtLocation(n)
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol)
      const builtin = symbol?.declarations?.some((d) => /lib\.es5\.d\.ts$/.test(d.getSourceFile().fileName))
      if (builtin && n.text === "NaN") return scalar("NAN")
      if (builtin && n.text === "Infinity") return scalar("INFINITY")
      const declaration = symbol?.valueDeclaration
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const && ts.isVariableStatement(declaration.parent.parent) && ts.isSourceFile(declaration.parent.parent.parent)) {
        const type = this.checker.getTypeAtLocation(n)
        const numeric = (t: ts.Type): boolean => !!(t.flags & ts.TypeFlags.NumberLike) || t.isIntersection() && t.types.some(numeric)
        const d = this.definition(n)
        if (numeric(type) && d !== n && !ts.isIdentifier(d)) return this.expr(d)
      }
      return this.fail(`Use numeric locals or module-level const numbers; ${n.text} is captured or mutable`, n)
    }
    if (ts.isObjectLiteralExpression(n)) {
      const fields: Record<string, Value> = Object.create(null)
      for (const p of n.properties) {
        if (ts.isShorthandPropertyAssignment(p)) fields[p.name.text] = this.expr(p.name)
        else if (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name)) fields[p.name.getText().replace(/^["']|["']$/g, "")] = this.expr(p.initializer)
        else this.fail("Object spreads and computed fields stay interpreted", p)
      }
      return object(fields)
    }
    if (ts.isPropertyAccessExpression(n)) {
      const parent = this.expr(n.expression)
      if (parent.kind === "object" && parent.fields[n.name.text]) return parent.fields[n.name.text]!
      return this.fail(`Property ${n.name.text} is outside the numeric subset`, n)
    }
    if (ts.isPrefixUnaryExpression(n)) {
      const value = this.number(this.expr(n.operand), n.operand)
      if (n.operator === ts.SyntaxKind.ExclamationToken) return scalar(`(!rn_truth(${value}))`)
      if (n.operator === ts.SyntaxKind.MinusToken) return scalar(`(-(${value}))`)
      if (n.operator === ts.SyntaxKind.PlusToken) return scalar(`(+(${value}))`)
      return this.fail("Use arithmetic unary +, - or boolean !", n)
    }
    if (ts.isBinaryExpression(n)) {
      const left = this.number(this.expr(n.left), n.left), right = this.number(this.expr(n.right), n.right)
      const op = n.operatorToken.getText()
      if (op === "%") return scalar(`fmod(${left}, ${right})`)
      if (op === "&&") return scalar(`(rn_truth(${left}) ? (${right}) : (${left}))`)
      if (op === "||") return scalar(`(rn_truth(${left}) ? (${left}) : (${right}))`)
      if (["+", "-", "*", "/", "<", ">", "<=", ">=", "===", "!=="].includes(op)) return scalar(`((${left}) ${op === "===" ? "==" : op === "!==" ? "!=" : op} (${right}))`)
      return this.fail(`Operator ${op} stays interpreted`, n)
    }
    if (ts.isConditionalExpression(n)) return scalar(`(rn_truth(${this.number(this.expr(n.condition), n.condition)}) ? ${this.number(this.expr(n.whenTrue), n.whenTrue)} : ${this.number(this.expr(n.whenFalse), n.whenFalse)})`)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const access = n.expression, method = access.name.text
      if (ts.isIdentifier(access.expression) && access.expression.text === "Math") {
        const symbol = this.checker.getSymbolAtLocation(access.expression)
        if (!symbol?.declarations?.some((d) => /lib\.es5\.d\.ts$/.test(d.getSourceFile().fileName))) this.fail("Use the built-in Math object; shadowed functions stay interpreted", n)
        const fn: Record<string, string> = { abs: "fabs", sqrt: "sqrt", floor: "floor", ceil: "ceil", trunc: "trunc", round: "rn_round", sign: "rn_sign", min: "rn_min", max: "rn_max" }
        if (!fn[method]) return this.fail(`Math.${method} stays interpreted to preserve exact numeric semantics`, n)
        const args = n.arguments.map((a) => this.number(this.expr(a), a))
        if (method === "min" || method === "max") {
          let result = method === "min" ? "INFINITY" : "(-INFINITY)"
          for (const arg of args) result = `${fn[method]}(${result}, ${arg})`
          return scalar(result)
        }
        if (args.length !== 1) return this.fail(`Math.${method} requires exactly one numeric argument`, n)
        return scalar(`${fn[method]}(${args[0]})`)
      }
      const parent = this.expr(access.expression)
      if (method === "get" && n.arguments.length === 0) {
        if (parent.kind === "cell") return this.get(parent)
        if (parent.kind === "resource") {
          const r = parent.resource, field = (i: number) => scalar(`args->resources[${r.offset + i}]`)
          return r.fields === null ? field(0) : object(Object.fromEntries(r.fields.map((f, i) => [f, field(i)])))
        }
      }
      return this.fail(`${method}() stays interpreted; use numeric cell get/set/update and query each`, n)
    }
    return this.fail(`${ts.SyntaxKind[n.kind]} stays interpreted`, n)
  }
  bind(name: ts.BindingName, value: Value, declare: boolean): void {
    if (ts.isObjectBindingPattern(name)) {
      if (value.kind !== "object") return this.fail("Destructure an eligible numeric object or query match", name)
      for (const item of name.elements) {
        if (item.dotDotDotToken || item.initializer) this.fail("Rest and default bindings stay interpreted", item)
        const key = item.propertyName?.getText().replace(/^["']|["']$/g, "") ?? item.name.getText()
        if (!value.fields[key]) this.fail(`Unknown numeric binding ${key}`, item)
        this.bind(item.name, value.fields[key]!, declare)
      }
    } else if (ts.isIdentifier(name)) {
      if (declare && value.kind === "scalar") { const local = this.fresh(); this.line(`double ${local} = ${value.code}; (void)${local};`); this.#env.set(name.text, scalar(local)) }
      else if (declare && value.kind === "object") {
        const fields: Record<string, Value> = Object.create(null)
        for (const [key, val] of Object.entries(value.fields)) { const local = this.fresh(); this.line(`double ${local} = ${this.number(val, name)}; (void)${local};`); fields[key] = scalar(local) }
        this.#env.set(name.text, object(fields))
      } else this.#env.set(name.text, value)
    } else this.fail("Array destructuring stays interpreted", name)
  }
  statement(n: ts.Statement): void {
    if (ts.isBlock(n)) { const previous = new Map(this.#env); this.line("{"); n.statements.forEach((s) => this.statement(s)); this.line("}"); this.#env = previous; return }
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) { if (!d.initializer) this.fail("Initialize numeric locals", d); this.bind(d.name, this.expr(d.initializer!), true) }
      return
    }
    if (ts.isForOfStatement(n)) {
      if (++this.#depth > 2) this.fail("At most two nested query loops compile", n)
      const expression = n.expression
      if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== "each") this.fail("for-of requires queries.name.each()", n)
      const q = this.expr(((expression as ts.CallExpression).expression as ts.PropertyAccessExpression).expression)
      if (q.kind !== "query") this.fail("for-of requires a query", expression)
      const index = (q as Extract<Value, { kind: "query" }>).index, query = this.queries[index]!, iterator = this.fresh("i"), slot = this.fresh("slot")
      if (!ts.isVariableDeclarationList(n.initializer) || n.initializer.declarations.length !== 1) this.fail("Use one const binding in each query loop", n)
      const binding = (n.initializer as ts.VariableDeclarationList).declarations[0]!, previous = new Map(this.#env)
      this.line(`for (int32_t ${iterator}=0; ${iterator}<args->queries[${index}].count; ${iterator}++) {`)
      this.line(`int32_t ${slot}=args->queries[${index}].slots[${iterator}]; (void)${slot};`)
      this.bind(binding.name, object({ data: object(Object.fromEntries(query.components.map((c) => [c.slot, { kind: "cell", query: index, component: c, slot } as Value]))) }), false)
      this.statement(n.statement); this.line("}"); this.#env = previous; this.#depth--; return
    }
    if (ts.isIfStatement(n)) { this.line(`if (rn_truth(${this.number(this.expr(n.expression), n.expression)}))`); this.line("{"); this.statement(n.thenStatement); this.line("}"); if (n.elseStatement) { this.line("else {"); this.statement(n.elseStatement); this.line("}") } return }
    if (ts.isReturnStatement(n)) { if (n.expression) this.fail("Validation and value-returning callbacks stay interpreted", n); this.line("return;"); return }
    if (ts.isContinueStatement(n) || ts.isBreakStatement(n)) { if (n.label) this.fail("Labeled jumps stay interpreted", n); this.line(ts.isContinueStatement(n) ? "continue;" : "break;"); return }
    if (ts.isExpressionStatement(n)) {
      const e = n.expression
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ["set", "update"].includes(e.expression.name.text)) {
        const target = this.expr(e.expression.expression)
        if (target.kind !== "cell" || !target.component.write) this.fail("Write a writable numeric cell", e)
        const cell = target as Extract<Value, { kind: "cell" }>, arg = e.arguments[0]
        if (!arg || e.arguments.length !== 1) this.fail("Cell writes require one value", e)
        let value: Value
        if (e.expression.name.text === "update") {
          if (!ts.isArrowFunction(arg!) || arg!.parameters.length !== 1 || ts.isBlock(arg!.body)) this.fail("Use update((value) => ({ numeric fields }))", e)
          const fn = arg as ts.ArrowFunction, previous = new Map(this.#env)
          this.bind(fn.parameters[0]!.name, this.get(cell), false); value = this.expr(fn.body as ts.Expression); this.#env = previous
        } else value = this.expr(arg!)
        const vals = cell.component.fields === null ? [value] : cell.component.fields.map((f) => value.kind === "object" && value.fields[f] ? value.fields[f]! : this.fail(`Write every field, including ${f}`, e))
        const temporaries = vals.map((v) => { const name = this.fresh(); this.line(`double ${name}=${this.number(v, e)};`); return name })
        temporaries.forEach((v, i) => this.line(`if (!rn_journal_write(args, ${cell.query}, ${cell.component.offset + i}, ${cell.component.mark}, ${cell.slot}, ${v})) return;`))
        return
      }
      if (ts.isBinaryExpression(e) && ["=", "+=", "-=", "*=", "/="].includes(e.operatorToken.getText())) { const left = this.number(this.expr(e.left), e.left); if (!/^v_[0-9]+$/.test(left)) this.fail("Assign numeric locals; write components through their cell", e.left); this.line(`${left} ${e.operatorToken.getText()} ${this.number(this.expr(e.right), e.right)};`); return }
      if (ts.isPostfixUnaryExpression(e) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(e.operator)) { const target = this.number(this.expr(e.operand), e.operand); if (!/^v_[0-9]+$/.test(target)) this.fail("Increment numeric locals only", e); this.line(`${target}${e.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--"};`); return }
      this.fail("Only numeric local assignments and cell writes compile as statements", n)
    }
    if (ts.isWhileStatement(n)) { this.line(`while (rn_truth(${this.number(this.expr(n.expression), n.expression)}))`); this.line("{"); this.statement(n.statement); this.line("}"); return }
    if (ts.isEmptyStatement(n)) return
    this.fail(`${ts.SyntaxKind[n.kind]} stays interpreted`, n)
  }
  emit(callback: ts.ArrowFunction | ts.FunctionExpression): string {
    if (callback.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || callback.asteriskToken) this.fail("Async and generator callbacks stay interpreted", callback)
    if (callback.parameters.length !== 1) this.fail("Destructure the system context in one parameter", callback)
    this.bind(callback.parameters[0]!.name, object({
      queries: object(Object.fromEntries(this.queries.map((q, index) => [q.name, { kind: "query", index } as Value]))),
      resources: object(Object.fromEntries(this.resources.map((r) => [r.name, { kind: "resource", resource: r } as Value])))
    }), false)
    if (!ts.isBlock(callback.body)) this.fail("Use a block callback with numeric statements", callback.body)
    this.line("(void)args;"); this.statement(callback.body as ts.Block)
    return this.#lines.join("\n")
  }
}
