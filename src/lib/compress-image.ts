import imageCompression from 'browser-image-compression'

/**
 * Compress an image file on the client side before uploading.
 * Mobile phone photos are often 3-8MB; this brings them under 800KB
 * with no visible quality loss for maintenance/work-order photos.
 *
 * Returns the compressed File ready for FormData.
 */
export async function compressImage(file: File): Promise<File> {
  // Skip compression for small files (already under 1MB)
  if (file.size <= 1 * 1024 * 1024) {
    return file
  }

  const options = {
    maxSizeMB: 0.8,          // Target ~800KB max
    maxWidthOrHeight: 1920,   // Max dimension (plenty for maintenance photos)
    useWebWorker: true,       // Offload to web worker for performance
    fileType: 'image/jpeg' as const, // Convert HEIC/PNG to JPEG for smaller size
  }

  try {
    const compressed = await imageCompression(file, options)
    // Return as a File object with the original name (but .jpg extension)
    const compressedName = file.name.replace(/\.[^.]+$/, '.jpg')
    return new File([compressed], compressedName, { type: 'image/jpeg' })
  } catch (error) {
    console.warn('Image compression failed, using original file:', error)
    return file // Fall back to original if compression fails
  }
}
