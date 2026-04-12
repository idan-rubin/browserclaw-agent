import type { RefObject } from 'react';

interface ChatInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pendingQuestion: string | null;
  isSending: boolean;
  variant: 'local' | 'compact';
}

export function ChatInput({
  inputRef,
  value,
  onChange,
  onSubmit,
  pendingQuestion,
  isSending,
  variant,
}: ChatInputProps) {
  const isLocal = variant === 'local';
  const isAnswering = pendingQuestion != null && pendingQuestion !== '';
  return (
    <div
      className={`flex items-center gap-2 border-t border-border/30 ${isLocal ? 'px-4 py-2' : 'px-3 py-1.5'} ${isAnswering ? 'bg-amber-500/5 border-t-amber-500/30' : ''}`}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={isAnswering ? 'Type your response...' : 'Send a message to the agent...'}
        disabled={isSending}
        className={`flex-1 bg-transparent px-2 ${isLocal ? 'py-1.5 text-sm' : 'py-1 text-xs'} focus:outline-none disabled:cursor-not-allowed`}
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim() || isSending}
        className={
          isLocal
            ? 'rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50'
            : 'rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50'
        }
      >
        Send
      </button>
    </div>
  );
}
