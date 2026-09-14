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
