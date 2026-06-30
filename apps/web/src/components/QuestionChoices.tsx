import type { QuestionWithOptions } from '@aimani-gs/contracts';

type QuestionChoicesProps = {
  questions: QuestionWithOptions[];
  onSelect: (question: string, option: string) => void;
  disabled?: boolean;
};

export function QuestionChoices({ questions, onSelect, disabled = false }: QuestionChoicesProps) {
  return (
    <div className="question-groups">
      {questions.map((question) => (
        <div key={question.question} className="question-group">
          <p className="question-text">{question.question}</p>
          <div className="choice-pills">
            {question.options.map((option) => (
              <button
                key={`${question.question}-${option}`}
                type="button"
                className="choice-pill"
                disabled={disabled}
                onClick={() => onSelect(question.question, option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
