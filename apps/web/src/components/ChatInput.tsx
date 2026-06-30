import { useState } from 'react';
import type { FormEvent } from 'react';

type ChatInputProps = {
  onSubmit: (body: string) => Promise<void> | void;
  placeholder?: string;
  disabled?: boolean;
  submitLabel?: string;
};

export function ChatInput({
  onSubmit,
  placeholder = '困っていることを書いてください...',
  disabled = false,
  submitLabel = '送信',
}: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const body = value.trim();
    if (!body || disabled) return;
    await onSubmit(body);
    setValue('');
  };

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
      />
      <button type="submit" disabled={disabled || !value.trim()}>{submitLabel}</button>
    </form>
  );
}
