import { describe, expect, it } from 'vitest'
import { talosHomeDir, talosHomeName } from './app-storage'

describe('Talos app storage paths', () => {
    it('uses capital Talos on macOS and Windows', () => {
        expect(talosHomeName('darwin')).toBe('Talos')
        expect(talosHomeName('win32')).toBe('Talos')
        expect(talosHomeDir('darwin', '/Users/alice')).toBe('/Users/alice/Talos')
        expect(talosHomeDir('win32', '/Users/alice')).toBe('/Users/alice/Talos')
    })

    it('uses lowercase talos on Linux', () => {
        expect(talosHomeName('linux')).toBe('talos')
        expect(talosHomeDir('linux', '/home/alice')).toBe('/home/alice/talos')
    })
})
