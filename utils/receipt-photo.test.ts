import { beforeEach, describe, expect, it, vi } from 'vitest'
import { selectReceiptPhoto } from './receipt-photo'

const camera = vi.hoisted(() => ({ getPhoto: vi.fn() }))
vi.mock('@capacitor/camera', () => ({ Camera: camera, CameraResultType: { Uri: 'uri' }, CameraSource: { Prompt: 'PROMPT' } }))

describe('native receipt selection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('turns a native image into a file accepted by the existing upload flow', async () => {
    camera.getPhoto.mockResolvedValue({ webPath: 'capacitor://localhost/photo.jpeg', format: 'jpeg' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['receipt'], { type: 'image/jpeg' }))))
    const file = await selectReceiptPhoto()
    expect(file).toBeInstanceOf(File)
    expect(file?.type).toBe('image/jpeg')
    expect(await file?.text()).toBe('receipt')
  })

  it('treats user cancellation as no selection', async () => {
    camera.getPhoto.mockRejectedValue(new Error('User cancelled photos app'))
    expect(await selectReceiptPhoto()).toBeNull()
  })

  it('surfaces denied permissions and unreadable files', async () => {
    camera.getPhoto.mockRejectedValue(new Error('Camera access denied'))
    await expect(selectReceiptPhoto()).rejects.toThrow('denied')
    camera.getPhoto.mockResolvedValue({ webPath: 'capacitor://localhost/missing', format: 'jpeg' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(selectReceiptPhoto()).rejects.toThrow()
  })
})
