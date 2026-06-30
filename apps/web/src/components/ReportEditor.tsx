import { useState } from 'react';

type ReportEditorProps = {
  initialValue: string;
  shared: boolean;
  onSave: (value: string, shareNow: boolean) => Promise<void> | void;
};

export function ReportEditor({ initialValue, shared, onSave }: ReportEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const handleSave = async (shareNow: boolean) => {
    setSaving(true);
    try {
      await onSave(value, shareNow);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="report-editor">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={18}
        aria-label="相談内容"
      />
      <div className="report-actions">
        <button type="button" onClick={() => handleSave(false)} disabled={saving}>保存する</button>
        {shared && (
          <button type="button" onClick={() => handleSave(true)} disabled={saving}>この内容で共有する</button>
        )}
      </div>
    </div>
  );
}
