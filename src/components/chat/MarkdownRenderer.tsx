import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  // Convert markdown to structured HTML
  const parseMarkdown = (text: string): string => {
    let html = text;

    // Headers - process from h3 to h1 to avoid conflicts
    html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-foreground mt-4 mb-2">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-foreground mt-5 mb-2">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-foreground mt-6 mb-3">$1</h1>');

    // Bold text
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>');
    
    // Italic text
    html = html.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');

    // Bullet lists - handle properly
    html = html.replace(/^\* (.+)$/gm, '<li class="ml-4 mb-1">$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li class="ml-4 mb-1">$1</li>');
    
    // Wrap consecutive li elements in ul
    html = html.replace(/(<li[^>]*>.*?<\/li>\n?)+/gs, (match) => {
      return `<ul class="list-disc list-inside space-y-1 my-3 text-muted-foreground">${match}</ul>`;
    });

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 mb-1">$1</li>');
    
    // Code inline
    html = html.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary hover:underline" target="_blank" rel="noopener noreferrer">$1</a>');

    // Paragraphs - wrap lines that aren't already wrapped in tags
    const lines = html.split('\n');
    const processedLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      // Don't wrap if already a tag
      if (trimmed.startsWith('<')) return line;
      return `<p class="mb-3 leading-relaxed text-foreground/90">${line}</p>`;
    });
    
    html = processedLines.join('\n');

    // Clean up empty paragraphs
    html = html.replace(/<p[^>]*>\s*<\/p>/g, '');

    return html;
  };

  return (
    <div 
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
    />
  );
};
