import type { Message, SessionTurnOutput } from '@aimani-gs/contracts';
import { QuestionChoices } from './QuestionChoices';

type ChatMessageProps = {
  message: Message;
  onOptionSelect: (question: string, option: string) => void;
  disabled?: boolean;
};

export function ChatMessage({ message, onOptionSelect, disabled = false }: ChatMessageProps) {
  if (message.author_type === 'ai') {
    const parsed = parseTurnOutput(message.body);
    if (!parsed) {
      return (
        <article className="chat-message ai-message">
          <Avatar label="AI" />
          <div className="chat-bubble ai-bubble">
            <p className="message-body">{message.body}</p>
          </div>
        </article>
      );
    }

    return (
      <article className="chat-message ai-message">
        <Avatar label="AI" />
        <div className="chat-bubble ai-bubble">
          <blockquote className="quote-span">「{parsed.quote_span}」</blockquote>
          <p className="message-body">{parsed.response_text}</p>
          <QuestionChoices questions={parsed.questions} onSelect={onOptionSelect} disabled={disabled} />
        </div>
      </article>
    );
  }

  return (
    <article className="chat-message human-message">
      <Avatar label={authorInitial(message.author_type)} />
      <div className="chat-bubble human-bubble">
        <p className="message-body">{message.body}</p>
      </div>
    </article>
  );
}

function Avatar({ label }: { label: string }) {
  return <div className="avatar">{label}</div>;
}

function parseTurnOutput(body: string): SessionTurnOutput | null {
  try {
    const parsed = JSON.parse(body) as Partial<SessionTurnOutput>;
    if (
      typeof parsed.quote_span === 'string' &&
      typeof parsed.response_text === 'string' &&
      Array.isArray(parsed.questions)
    ) {
      return parsed as SessionTurnOutput;
    }
    return null;
  } catch {
    return null;
  }
}

function authorInitial(authorType: Message['author_type']): string {
  switch (authorType) {
    case 'student': return 'S';
    case 'tutor': return 'T';
    case 'mentor': return 'M';
    case 'ai': return 'AI';
  }
}
