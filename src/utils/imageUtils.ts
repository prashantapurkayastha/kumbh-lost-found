/**
 * Resize + re-encode an image file to JPEG before sending to the API.
 * Keeps the longest edge at most maxPx (default 1024). Quality 0.82 gives
 * good fidelity at ~150–400 KB for typical phone photos — well under the
 * 6 MB Express body limit.
 * Returns the raw base64 string (no data:… prefix).
 */
export async function compressImage(
  file: File,
  maxPx = 1024,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas unavailable")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}
