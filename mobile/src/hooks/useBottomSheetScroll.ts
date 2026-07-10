import { useState, useRef } from 'react';

export function useBottomSheetScroll() {
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [isScrollAtTop, setIsScrollAtTop] = useState(true);
  const touchStartY = useRef(0);

  const handleScroll = (event: any) => {
    const y = event.nativeEvent.contentOffset.y;
    setIsScrollAtTop(y <= 0);
  };

  const handleTouchStart = (event: any) => {
    touchStartY.current = event.nativeEvent.pageY;
  };

  const handleTouchMove = (event: any) => {
    const currentY = event.nativeEvent.pageY;
    const dy = currentY - touchStartY.current;

    if (isScrollAtTop) {
      if (dy > 3) {
        // Swiping down at the top -> disable scroll view scrolling
        // so that parent PanResponder can capture the gesture and swipe down
        setScrollEnabled(false);
      } else if (dy < -3) {
        // Swiping up at the top -> enable scroll view scrolling
        setScrollEnabled(true);
      }
    } else {
      setScrollEnabled(true);
    }
  };

  const handleTouchEnd = () => {
    setScrollEnabled(true);
  };

  return {
    scrollEnabled,
    handleScroll,
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
    isScrollAtTop,
    setIsScrollAtTop,
  };
}
