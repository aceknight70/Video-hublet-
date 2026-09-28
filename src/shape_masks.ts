// Canvas-based Shape Mask Engine for Image Overlays
// Generates circle and heart masks in pure code without any external files.

export type ImageShape = 'rectangle' | 'circle' | 'heart';

export function getNextShape(current: ImageShape): ImageShape {
  switch (current) {
    case 'rectangle': return 'circle';
    case 'circle': return 'heart';
    case 'heart': return 'rectangle';
    default: return 'rectangle';
  }
}

export function getShapeIcon(shape: ImageShape): string {
  switch (shape) {
    case 'rectangle': return '▢';
    case 'circle': return '○';
    case 'heart': return '♥';
    default: return '▢';
  }
}

/**
 * Draws heart path onto a 2D canvas context within [0, 0, width, height]
 */
export function drawHeartPath(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const w = width;
  const h = height;
  ctx.beginPath();
  
  const topCurveHeight = h * 0.3;
  ctx.moveTo(w / 2, h * 0.85);

  // Left half of heart
  ctx.bezierCurveTo(
    w * 0.05, h * 0.55,
    0, topCurveHeight * 1.1,
    w * 0.25, topCurveHeight * 0.2
  );
  ctx.bezierCurveTo(
    w * 0.45, -topCurveHeight * 0.2,
    w / 2, topCurveHeight * 0.7,
    w / 2, topCurveHeight * 0.8
  );

  // Right half of heart
  ctx.bezierCurveTo(
    w / 2, topCurveHeight * 0.7,
    w * 0.55, -topCurveHeight * 0.2,
    w * 0.75, topCurveHeight * 0.2
  );
  ctx.bezierCurveTo(
    w, topCurveHeight * 1.1,
    w * 0.95, h * 0.55,
    w / 2, h * 0.85
  );

  ctx.closePath();
}

/**
 * Renders an image masked into a circle, heart, or rectangle onto a transparent canvas and exports as PNG Blob
 */
export function renderMaskedImageBlob(
  img: HTMLImageElement,
  shape: ImageShape,
  width: number = 320,
  height: number = 320
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(32, Math.round(width));
    canvas.height = Math.max(32, Math.round(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return reject(new Error('Canvas 2D context unavailable'));
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (shape === 'circle') {
      const radius = Math.min(canvas.width, canvas.height) / 2;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    } else if (shape === 'heart') {
      drawHeartPath(ctx, canvas.width, canvas.height);
      ctx.clip();
    }

    // Draw the image scaled to fill
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate masked image blob'));
    }, 'image/png');
  });
}

/**
 * Returns CSS clip-path or class string for live preview DOM
 */
export function getShapeCssClipPath(shape: ImageShape): string {
  switch (shape) {
    case 'circle':
      return 'circle(50% at 50% 50%)';
    case 'heart':
      // High-precision SVG path data normalized for 100x100 box
      return 'path("M 50 85 C 5 55 0 25 25 6 C 45 -6 50 20 50 24 C 50 20 55 -6 75 6 C 100 25 95 55 50 85 Z")';
    case 'rectangle':
    default:
      return 'none';
  }
}
