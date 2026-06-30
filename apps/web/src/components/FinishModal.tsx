import type { ReportShareTarget } from '@aimani-gs/contracts';

type FinishMode = 'private' | ReportShareTarget;

type FinishModalProps = {
  onClose: () => void;
  onSelect: (mode: FinishMode) => void;
};

export function FinishModal({ onClose, onSelect }: FinishModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal-card" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">整理する</p>
        <h3 style={{ fontFamily: 'Georgia, serif', margin: '8px 0 16px' }}>ここまでをどう扱いますか？</h3>
        <div className="finish-actions">
          <button type="button" onClick={() => onSelect('private')}>自分だけで保持する</button>
          <button type="button" onClick={() => onSelect('tutor')}>チューターに相談する</button>
          <button type="button" onClick={() => onSelect('mentor')}>メンターに相談する</button>
        </div>
      </div>
    </div>
  );
}
