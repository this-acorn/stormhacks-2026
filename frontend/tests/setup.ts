import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Allow initial module loading and the mock API to settle on slower machines.
configure({ asyncUtilTimeout: 5000 })

afterEach(cleanup)

// jsdom has no native top layer. These stubs test dialog content and handlers,
// not browser rendering, focus trapping, WebGL or responsive CSS.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}
HTMLElement.prototype.scrollIntoView = function () {}
