/**
 * Math typed into a number field, as in design tools: `1015/51` gives that
 * value, and an operator first (`*2`, `/2`, `+0.5`) applies to the value
 * already there. Only numbers, `+ - * /`, brackets, and signs are read; it
 * never runs code.
 */

/**
 * The value of `text` given the field's `current` value; undefined when it
 * is not a number or an expression of numbers, or divides by zero. `*`, `/`,
 * or `+` first applies to the current value; a `-` first is a sign, so "-1"
 * is minus one (typing after the value, "20-1", subtracts).
 */
export const evaluate = (text: string, current: number | undefined): number | undefined => {
  const source = text.trim()
  if (source === "") return undefined
  const relative = /^[*/+]/.test(source)
  if (relative && current === undefined) return undefined
  const value = parse(relative ? `(${current})${source}` : source)
  return value === undefined || !Number.isFinite(value) ? undefined : value
}

const parse = (source: string): number | undefined => {
  const tokens = source.match(/\d*\.?\d+(?:e[+-]?\d+)?|\d+\.|[-+*/()]|\S/gi) ?? []
  let at = 0
  const peek = (): string | undefined => tokens[at]

  // expression := term (("+" | "-") term)*
  const expression = (): number | undefined => {
    let value = term()
    while (value !== undefined && (peek() === "+" || peek() === "-")) {
      const operator = tokens[at++]
      const right = term()
      if (right === undefined) return undefined
      value = operator === "+" ? value + right : value - right
    }
    return value
  }
  // term := factor (("*" | "/") factor)*
  const term = (): number | undefined => {
    let value = factor()
    while (value !== undefined && (peek() === "*" || peek() === "/")) {
      const operator = tokens[at++]
      const right = factor()
      if (right === undefined || (operator === "/" && right === 0)) return undefined
      value = operator === "*" ? value * right : value / right
    }
    return value
  }
  // factor := ("+" | "-") factor | number | "(" expression ")"
  const factor = (): number | undefined => {
    const token = tokens[at++]
    if (token === "-" || token === "+") {
      const value = factor()
      return value === undefined ? undefined : token === "-" ? -value : value
    }
    if (token === "(") {
      const value = expression()
      return tokens[at++] === ")" ? value : undefined
    }
    if (token === undefined || !/^(\d*\.?\d+(e[+-]?\d+)?|\d+\.)$/i.test(token)) return undefined
    return Number(token)
  }

  const value = expression()
  return at === tokens.length ? value : undefined
}
