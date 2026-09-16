// 페이지 경계가 조금 보여도 화면의 주된 페이지를 현재 페이지로 선택합니다.
export function activePage(offsets: number[], heights: number[], top: number, viewportHeight: number, first: number, last: number): number {
  let active = first;
  let maximum = -1;
  for (let n = first; n <= last; n++) {
    const overlap = Math.max(0, Math.min(top + viewportHeight, offsets[n] + heights[n]) - Math.max(top, offsets[n]));
    if (overlap > maximum) { maximum = overlap; active = n; }
  }
  return active;
}

// 휠의 픽셀·줄·페이지 단위를 맞추고 한 번의 급격한 확대를 제한합니다.
export function wheelZoom(scale: number, delta: number, mode: number, viewportHeight: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? viewportHeight : 1);
  return Math.max(0.25, Math.min(3, scale * Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.002)));
}

// 가로·세로 페이지가 섞여 있어도 너비 맞춤은 각 페이지를 표시 영역에 맞춥니다.
export function documentLayout(pages: {width: number; height: number}[], viewportWidth: number, zoom: number | null) {
  const available = Math.max(1, viewportWidth - 72);
  const offsets: number[] = [], widths: number[] = [], heights: number[] = [];
  let y = 28, maxWidth = 0;
  for (const page of pages) {
    const scale = zoom ?? available / page.width;
    const width = page.width * scale, height = page.height * scale;
    offsets.push(y); widths.push(width); heights.push(height);
    y += height + 18; maxWidth = Math.max(maxWidth, width);
  }
  return {offsets, widths, heights, width: Math.max(viewportWidth, maxWidth + 72), height: y + 12};
}
