import React, { useState, useEffect } from 'react';
import { TypewriterText } from './TypewriterText';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  isNew?: boolean;
  className?: string;
  onContentGrow?: () => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ 
  content, 
  role, 
  isNew = false,
  className = '',
  onContentGrow
}) => {
  const [animationComplete, setAnimationComplete] = useState(!isNew);

  // Mark as complete after animation
  useEffect(() => {
    if (!isNew) {
      setAnimationComplete(true);
    }
  }, [isNew]);

  if (role === 'user') {
    return (
      <div className={cn(
        "bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-3 max-w-[80%]",
        className
      )}>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    );
  }

  return (
    <div className={cn(
      "bg-muted/50 text-foreground rounded-2xl rounded-tl-md px-5 py-4 max-w-[85%] shadow-sm border border-border/30",
      !animationComplete && "animate-fade-in",
      className
    )}>
      <TypewriterText 
        content={content} 
        isNew={isNew}
        onComplete={() => setAnimationComplete(true)}
        onContentGrow={onContentGrow}
      />
    </div>
  );
};
