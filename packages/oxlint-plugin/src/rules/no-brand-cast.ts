import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { docsUrl } from "../internal/ast.ts"

/** The type names that are brands wherever they come from: `Brand.Branded<...>`, Effect's `Brand.Brand<...>`, Zod's `z.BRAND<...>` / `z.$brand<...>`. */
const brandNames = new Set(["Brand", "Branded", "BRAND", "$brand"])

/** Property keys that only a brand declares (`T & { readonly __brand: "UserId" }`). */
const brandKey = /^(__?brand|__publicBrand|__type)$/

/** Ritmo's branded exports, by module: `Clock.Deadline`, `Random.State`, `Entity.Handle`, ... */
const ritmoBrands = new Map<string, ReadonlySet<string>>([
  ["Clock", new Set(["Deadline", "Step", "Duration", "ClockResource"])],
  ["Entity", new Set(["Handle", "EntityId"])],
  ["Random", new Set(["State"])],
  ["Checkpoint", new Set(["Checkpoint", "Rewindable"])]
])

/** The type helpers that read the type out of a schema: `z.infer<typeof X>`, `Schema.Schema.Type<typeof X>`. */
const schemaTypeHelpers = new Set(["infer", "output", "TypeOf", "Infer", "Type"])

/** A schema built with a brand: Zod's `.brand(...)` / `.brand<"X">()`, Effect's `Schema.brand(...)` / `.pipe(Schema.brand(...))`. */
const brandsSchema = /\bbrand\s*(<[^>]*>\s*)?\(/

/** The dotted names of a type name or expression (`Clock.Deadline` gives `["Clock", "Deadline"]`). */
const segments = (node: ESTree.Node): Array<string> | undefined => {
  if (node.type === "Identifier") return [node.name]
  if (node.type === "TSQualifiedName") {
    const left = segments(node.left)
    return left === undefined ? undefined : [...left, node.right.name]
  }
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    const left = segments(node.object)
    return left === undefined ? undefined : [...left, node.property.name]
  }
  return undefined
}

/** Where a local name imported from Ritmo points: `[]` for the package, `["Clock"]` for a module, `["Clock", "Deadline"]` for a type. */
const ritmoImport = (declaration: ESTree.ImportDeclaration, specifier: ESTree.ImportDeclarationSpecifier): Array<string> | undefined => {
  const match = /^@typeonce\/ritmo(\/([A-Za-z0-9]+))?$/.exec(declaration.source.value)
  if (match === null) return undefined
  const module = match[2]
  const base = module === undefined ? [] : [module]
  if (specifier.type === "ImportNamespaceSpecifier") return base
  if (specifier.type !== "ImportSpecifier") return undefined
  const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
  return [...base, imported]
}

/**
 * Simulation code never casts a value to a branded type: a brand stands for a
 * check, and the cast claims it without running it.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Make a branded value through its schema or constructor, not with `as` / `<T>` casts.",
      url: docsUrl("no-brand-cast")
    },
    messages: {
      cast:
        "This casts to `{{type}}`, a branded type: a brand stands for a check the value passed, and the cast claims it without running the check, so an invalid value travels as a valid one (and a save holding it fails to load, or the simulation computes with it). Make the value through its check instead: decode it at the boundary with the schema that brands it (`UserId.parse(raw)` with Zod, `Schema.decodeUnknownSync(UserId)(raw)` with Effect), or with Ritmo's constructor or guard: `Random.seed(n)` / `Random.result(n)`, `Clock.deadline(time, duration)` / `Clock.isDeadline(step)`, `Game.Entity.handle(id)` / `Entity.isHandle(Root)`."
    },
    schema: []
  },
  create(context) {
    const aliases = new Map<string, ESTree.TSType>()
    const interfaces = new Map<string, ESTree.TSInterfaceDeclaration>()
    const values = new Map<string, ESTree.Node>()
    const uniqueSymbols = new Set<string>()
    const imports = new Map<string, Array<string>>()
    const casts: Array<ESTree.TSAsExpression | ESTree.TSTypeAssertion> = []

    /** Whether the value named `name` is a schema built with a brand in this file. */
    const isBrandedSchema = (name: string): boolean => {
      const init = values.get(name)
      return init !== undefined && brandsSchema.test(context.sourceCode.getText(init))
    }

    /** Whether a dotted name is a brand: a brand helper, Ritmo's branded export, or a local brand alias. */
    const namesBrand = (names: Array<string>, hasArguments: boolean, seen: Set<string>): boolean => {
      const [root, ...rest] = names
      if (root === undefined) return false
      const imported = imports.get(root)
      if (imported !== undefined) {
        const [module, type, ...more] = [...imported, ...rest]
        if (module !== undefined && type !== undefined && more.length === 0 && ritmoBrands.get(module)?.has(type) === true) return true
      }
      const last = names[names.length - 1]!
      if (names.length === 1) {
        const alias = aliases.get(root)
        if (alias !== undefined) return !seen.has(root) && isBrand(alias, new Set([...seen, root]))
        const declared = interfaces.get(root)
        if (declared !== undefined) return !seen.has(root) && interfaceIsBrand(declared, new Set([...seen, root]))
        return hasArguments && brandNames.has(root)
      }
      return brandNames.has(last)
    }

    const interfaceIsBrand = (node: ESTree.TSInterfaceDeclaration, seen: Set<string>): boolean =>
      node.body.body.some(memberIsBrand) ||
      node.extends.some((heritage) => {
        const names = segments(heritage.expression)
        return names !== undefined && namesBrand(names, heritage.typeArguments !== null, seen)
      })

    const memberIsBrand = (member: ESTree.TSSignature): boolean => {
      if (member.type !== "TSPropertySignature") return false
      if (!member.computed) return member.key.type === "Identifier" ? brandKey.test(member.key.name) : false
      if (member.key.type === "Identifier" && uniqueSymbols.has(member.key.name)) return true
      return /brand/i.test(context.sourceCode.getText(member.key))
    }

    /** Whether `node` reads the type of a branded schema: `typeof X.Type`, `(typeof X)["Type"]`. */
    const readsBrandedSchema = (node: ESTree.TSType): boolean => {
      if (node.type === "TSTypeQuery") {
        const names = segments(node.exprName)
        return names !== undefined && names.length === 2 && names[1] === "Type" && isBrandedSchema(names[0]!)
      }
      if (node.type === "TSIndexedAccessType" && node.objectType.type === "TSTypeQuery") {
        const names = segments(node.objectType.exprName)
        const index = node.indexType
        return names !== undefined && names.length === 1 && isBrandedSchema(names[0]!) &&
          index.type === "TSLiteralType" && index.literal.type === "Literal" && index.literal.value === "Type"
      }
      return false
    }

    const isBrand = (node: ESTree.TSType, seen: Set<string>): boolean => {
      switch (node.type) {
        case "TSIntersectionType":
        case "TSUnionType":
          return node.types.some((type) => isBrand(type, seen))
        case "TSArrayType":
          return isBrand(node.elementType, seen)
        case "TSTypeOperator":
          return node.operator === "readonly" && isBrand(node.typeAnnotation, seen)
        case "TSParenthesizedType":
          return isBrand(node.typeAnnotation, seen)
        case "TSTypeLiteral":
          return node.members.some(memberIsBrand)
        case "TSTypeReference": {
          const names = segments(node.typeName)
          if (names === undefined) return false
          const schema = node.typeArguments?.params[0]
          if (names.length > 1 && schemaTypeHelpers.has(names[names.length - 1]!) && schema?.type === "TSTypeQuery") {
            const target = segments(schema.exprName)
            if (target !== undefined && target.length === 1 && isBrandedSchema(target[0]!)) return true
          }
          return namesBrand(names, node.typeArguments !== null, seen)
        }
        default:
          return readsBrandedSchema(node)
      }
    }

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          const target = ritmoImport(node, specifier)
          if (target !== undefined) imports.set(specifier.local.name, target)
        }
      },
      TSTypeAliasDeclaration(node) {
        aliases.set(node.id.name, node.typeAnnotation)
      },
      TSInterfaceDeclaration(node) {
        interfaces.set(node.id.name, node)
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier") return
        const annotation = node.id.typeAnnotation?.typeAnnotation
        // `declare const brand: unique symbol` names a key no value has; a symbol made at runtime is a real key.
        if (annotation?.type === "TSTypeOperator" && annotation.operator === "unique" && node.init === null) uniqueSymbols.add(node.id.name)
        if (node.init !== null) values.set(node.id.name, node.init)
      },
      TSAsExpression(node) {
        casts.push(node)
      },
      TSTypeAssertion(node) {
        casts.push(node)
      },
      // Declarations may follow the casts that use them, so casts are checked once the file is read.
      "Program:exit"() {
        for (const cast of casts) {
          if (!isBrand(cast.typeAnnotation, new Set())) continue
          context.report({ node: cast, messageId: "cast", data: { type: context.sourceCode.getText(cast.typeAnnotation) } })
        }
      }
    }
  }
})
