/**
 * Native client-side image compression utility using HTML5 Canvas.
 * Resizes the image to fit within maxWidth/maxHeight and encodes it as JPEG at specified quality.
 */
export const compressImage = (
  file: File,
  maxWidth = 1280,
  maxHeight = 720,
  quality = 0.8
): Promise<File> => {
  return new Promise((resolve, reject) => {
    // Only compress standard images (exclude SVGs, gifs, etc. if you want to keep them animated/vectorial)
    if (!file.type.startsWith('image/') || file.type.includes('svg') || file.type.includes('gif')) {
      return resolve(file);
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect ratio scale
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Canvas context not available'));
        }

        // Draw image into canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Convert canvas drawing to JPEG blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('Blob generation failed'));
            }
            
            // Create a new File from the blob
            // Force jpeg extension
            const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            const compressedFile = new File([blob], `${baseName}.jpg`, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            
            console.log(
              `[Image Compression] Original: ${(file.size / 1024).toFixed(1)} KB | Compressed: ${(compressedFile.size / 1024).toFixed(1)} KB`
            );
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = (err) => reject(new Error('Image failed to load'));
      img.src = event.target?.result as string;
    };
    reader.onerror = (err) => reject(new Error('File reader failed'));
    reader.readAsDataURL(file);
  });
};
