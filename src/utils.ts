import { fileTypeFromBuffer } from 'file-type'

const SUPPORTED_TYPES = ['image/png']

export async function checkFileType(fileContent: ArrayBuffer) {
  const type = await fileTypeFromBuffer(fileContent)
  if (!type) {
    return {
      isSupported: false,
      mimeType: '',
    }
  }
  return {
    isSupported: SUPPORTED_TYPES.includes(type.mime),
    mimeType: type.mime,
  }
}
