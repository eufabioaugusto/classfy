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
        "bg-muted text-foreground rounded-2xl rounded-tr-md px-4 py-3 max-w-[80%] border border-border/60 shadow-sm",
        className
      )}>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    );
  }

  return (
    <div className={cn(
      "text-foreground rounded-2xl rounded-tl-md px-0 py-1 max-w-[85%]",
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
