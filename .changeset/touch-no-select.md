---
"@typeonce/ritmo-browser": minor
---

`Touch.actions` stops a held thumb from selecting the page on iOS. Holding a stick or button for a moment selected the canvas and the text around it, because iOS Safari does not treat `preventDefault()` on `pointerdown` as a reason to skip long-press selection. While attached, the module now sets `user-select: none`, `-webkit-user-select: none`, and `-webkit-touch-callout: none` on the element next to `touch-action: none`, and cancels the context menu a long press opens while a tracked finger is down (a mouse right-click keeps its menu). `dispose()` restores all four styles, and removes the ones the element did not have.

**Breaking: `Touch.TouchTarget` also listens for `contextmenu`, and its `style` is read and written through `getPropertyValue` and `setProperty` instead of `touchAction`.** A DOM element still fits unchanged. A hand-written target (a test fake) adds `contextmenu` to its listeners and replaces `style: { touchAction }` with:

```ts
const styles = new Map<string, string>()
const style = {
  getPropertyValue: (property: string) => styles.get(property) ?? "",
  setProperty: (property: string, value: string) => {
    if (value === "") styles.delete(property)
    else styles.set(property, value)
  }
}
```
