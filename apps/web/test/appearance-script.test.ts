import { expect, test } from 'vitest'

import { applyAppearanceSource } from '../app/appearance-script'

// CodeQL #7: the value is written into an inline `<script>`, and
// `JSON.stringify` leaves `<` alone, so a value holding `</script>` would end
// the tag and run whatever followed as markup.
test('no value can close the script tag it is written into', () => {
  const source = applyAppearanceSource('</script><script>alert(1)//<!--')

  expect(source).not.toContain('<')
  expect(source).toContain('\\u003c/script>')
})
