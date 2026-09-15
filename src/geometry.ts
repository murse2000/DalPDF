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
