import React, { createContext, useContext, useState, useCallback } from 'react';
import { LayoutAnimation, Platform, UIManager } from 'react-native';

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

type TabScrollContextType = {
  isScrolled: boolean;
  setIsScrolled: (scrolled: boolean) => void;
};

const TabScrollContext = createContext<TabScrollContextType | undefined>(undefined);

export function TabScrollProvider({ children }: { children: React.ReactNode }) {
  const [isScrolled, setIsScrolledState] = useState(false);

  const setIsScrolled = useCallback((scrolled: boolean) => {
    setIsScrolledState((prev) => {
      if (prev === scrolled) return prev;
      try {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      } catch (e) {
        // Safely ignore LayoutAnimation failures on platforms/environments where UIManager is disabled
      }
      return scrolled;
    });
  }, []);

  return (
    <TabScrollContext.Provider value={{ isScrolled, setIsScrolled }}>
      {children}
    </TabScrollContext.Provider>
  );
}

export function useTabScroll() {
  const context = useContext(TabScrollContext);
  if (context === undefined) {
    throw new Error('useTabScroll must be used within a TabScrollProvider');
  }
  return context;
}
