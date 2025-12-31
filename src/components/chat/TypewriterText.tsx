import React, { useState, useEffect, useRef } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface TypewriterTextProps {
  content: string;
  isNew?: boolean;
  speed?: number;
  className?: string;
  onComplete?: () => void;
}

export const TypewriterText: React.FC<TypewriterTextProps> = ({ 
  content, 
  isNew = false,
  speed = 8, // Characters per frame (faster = more chars)
  className = '',
  onComplete
}) => {
  const [displayedContent, setDisplayedContent] = useState(isNew ? '' : content);
  const [isAnimating, setIsAnimating] = useState(isNew);
  const animationRef = useRef<number | null>(null);
  const indexRef = useRef(isNew ? 0 : content.length);
  const hasCompletedRef = useRef(!isNew);

  useEffect(() => {
    // If not new message or already complete, show full content
    if (!isNew || hasCompletedRef.current) {
      setDisplayedContent(content);
      setIsAnimating(false);
      return;
    }

    // Animation loop
    const animate = () => {
      if (indexRef.current < content.length) {
        // Add multiple characters per frame for faster animation
        const nextIndex = Math.min(indexRef.current + speed, content.length);
        setDisplayedContent(content.substring(0, nextIndex));
        indexRef.current = nextIndex;
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        hasCompletedRef.current = true;
        onComplete?.();
      }
    };

    // Start animation with a small delay for smooth transition
    const timeout = setTimeout(() => {
      animationRef.current = requestAnimationFrame(animate);
    }, 50);

    return () => {
      clearTimeout(timeout);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [content, isNew, speed, onComplete]);

  return (
    <div className={`relative ${className}`}>
      <MarkdownRenderer content={displayedContent} />
      {isAnimating && (
        <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse" />
      )}
    </div>
  );
};
