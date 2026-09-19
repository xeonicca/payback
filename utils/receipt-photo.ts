export async function selectReceiptPhoto(): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
  try {
    // getPhoto retains the native camera/library chooser supported by Camera 8.
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
      quality: 90,
      width: 2400,
      correctOrientation: true,
      saveToGallery: false,
      promptLabelHeader: '新增收據',
      promptLabelPhoto: '從照片選擇',
      promptLabelPicture: '拍攝收據',
      promptLabelCancel: '取消',
    })
    if (!photo.webPath)
      throw new Error('無法讀取收據照片')
    const response = await fetch(photo.webPath)
    if (!response.ok)
      throw new Error('無法讀取收據照片')
    const blob = await response.blob()
    const format = photo.format === 'jpg' ? 'jpeg' : photo.format
    return new File([blob], `receipt-${Date.now()}.${format}`, { type: blob.type || `image/${format}` })
  }
  catch (error) {
    if (error instanceof Error && /cancelled|canceled/i.test(error.message))
      return null
    throw error
  }
}
