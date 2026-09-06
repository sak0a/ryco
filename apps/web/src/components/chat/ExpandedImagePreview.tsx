export interface ExpandedImageItem {
  src: string;
  name: string;
  /** Advisory intrinsic dimensions carried from the attachment; absent = unknown. */
  width?: number;
  height?: number;
}

export interface ExpandedImagePreview {
  images: ExpandedImageItem[];
  index: number;
}

export function buildExpandedImagePreview(
  images: ReadonlyArray<{
    id: string;
    name: string;
    previewUrl?: string;
    width?: number;
    height?: number;
  }>,
  selectedImageId: string,
): ExpandedImagePreview | null {
  const previewableImages = images.flatMap((image) =>
    image.previewUrl
      ? [
          {
            id: image.id,
            src: image.previewUrl,
            name: image.name,
            width: image.width,
            height: image.height,
          },
        ]
      : [],
  );
  if (previewableImages.length === 0) {
    return null;
  }
  const selectedIndex = previewableImages.findIndex((image) => image.id === selectedImageId);
  if (selectedIndex < 0) {
    return null;
  }
  return {
    images: previewableImages.map((image) => ({
      src: image.src,
      name: image.name,
      ...(image.width !== undefined ? { width: image.width } : {}),
      ...(image.height !== undefined ? { height: image.height } : {}),
    })),
    index: selectedIndex,
  };
}
