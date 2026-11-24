// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { privateElements } from './useScreenShare'

afterEach(() => { document.body.innerHTML = '' })

const ids = () => privateElements(document).map(e => e.id)

describe('privateElements (the screen share masks, D-17 and D-21)', () => {
  it('covers a sensitive field with its label and its error, however they are tied to it', () => {
    document.body.innerHTML = `
      <label id="l1" for="pw">Password</label><input id="pw" type="password" aria-errormessage="e1"><p id="e1">Too short</p>
      <label id="wrap">Card <input id="cc" autocomplete="cc-number" aria-describedby="e2"></label><p id="e2">Not a card</p>
      <span id="n">Code</span><input id="otp" autocomplete="one-time-code" aria-labelledby="n">`
    expect(ids().sort()).toEqual(['cc', 'e1', 'e2', 'l1', 'n', 'otp', 'pw', 'wrap'])
  })

  it('leaves an ordinary field and its label alone', () => {
    document.body.innerHTML = '<label id="l" for="name">Name</label><input id="name" autocomplete="name"><p id="help">Your name</p>'
    expect(ids()).toEqual([])
  })

  it('still covers Otto\'s panel and anything marked private', () => {
    document.body.innerHTML = '<div id="a" data-otto-private>x</div><div id="b" class="voice-assistant">y</div>'
    expect(ids().sort()).toEqual(['a', 'b'])
  })
})
