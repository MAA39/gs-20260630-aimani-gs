import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useCallback, useMemo, useState } from 'react';
import type { ConsultationDetail, ReportShareTarget } from '@aimani-gs/contracts';
import { ReportEditor } from '../../../components/ReportEditor';
import { getAuthenticatedApi } from '../../../lib/api-fetch';

type ReportMode = 'private' | ReportShareTarget;
type SearchParams = { mode: ReportMode };

const fetchReportDetail = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const response = await api(`/api/v1/consultations/${data.id}`);
    if (!response.ok) throw new Error('not found');
    return (await response.json()) as ConsultationDetail;
  });

const saveReport = createServerFn({ method: 'POST' })
  .validator((input: {
    id: string;
    mode: ReportMode;
    body: string;
    personalReport: string;
    shareNow: boolean;
  }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const isShared = data.mode === 'tutor' || data.mode === 'mentor';
    const response = await api(`/api/v1/consultations/${data.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personal_report: isShared ? data.personalReport : data.body,
        shared_report: isShared ? data.body : null,
        shared_with: isShared ? data.mode : null,
        share_now: data.shareNow,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errorBody.error ?? `report save failed: ${response.status}`);
    }
    return response.json();
  });

export const Route = createFileRoute('/chat/$id/report')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    mode: search.mode === 'tutor' || search.mode === 'mentor' ? search.mode : 'private',
  }),
  loader: ({ params }) => fetchReportDetail({ data: { id: params.id } }),
  component: ReportPage,
});

function ReportPage() {
  const detail = Route.useLoaderData();
  const { id } = Route.useParams();
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const personalReport = useMemo(
    () => detail.personal_report || buildPersonalReport(detail),
    [detail],
  );
  const isShared = mode === 'tutor' || mode === 'mentor';
  const editorInitialValue = isShared
    ? detail.shared_report || buildSharedReport(personalReport, mode)
    : personalReport;

  const handleSave = useCallback(async (body: string, shareNow: boolean) => {
    setNotice('');
    setError('');
    try {
      await saveReport({ data: { id, mode, body, personalReport, shareNow } });
      setNotice(shareNow ? '共有しました。' : '保存しました。');
      if (shareNow) await navigate({ to: '/chat/$id/shared', params: { id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存できませんでした');
    }
  }, [id, mode, navigate, personalReport]);

  return (
    <div className="report-page">
      <div className="report-header">
        <Link to="/chat/$id" params={{ id }} style={{ color: '#555041', textDecoration: 'none' }}>← チャットに戻る</Link>
        <h2>{isShared ? '共有する相談内容' : '自分用の整理'}</h2>
        <p>{isShared ? '共有前に内容を確認・編集してください。' : 'ここまでの会話を自分用に残します。'}</p>
      </div>
      {notice && <div className="card">{notice}</div>}
      {error && <div className="card error">{error}</div>}
      <ReportEditor initialValue={editorInitialValue} shared={isShared} onSave={handleSave} />
    </div>
  );
}

function buildPersonalReport(detail: ConsultationDetail): string {
  const aiInsights = detail.messages
    .filter((message) => message.author_type === 'ai')
    .map((message) => {
      try {
        const parsed = JSON.parse(message.body) as { quote_span?: unknown; response_text?: unknown };
        const quote = typeof parsed.quote_span === 'string' && parsed.quote_span.trim()
          ? `> ${parsed.quote_span.trim()}`
          : '';
        const text = typeof parsed.response_text === 'string' ? parsed.response_text.trim() : '';
        return [quote, text].filter(Boolean).join('\n');
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  return [
    `# ${detail.title}`,
    '',
    '## 困っていること',
    detail.body,
    '',
    '## 整理で見えてきたこと',
    aiInsights.join('\n\n') || 'まだ材料が少ない状態です。',
  ].join('\n');
}

function buildSharedReport(personalReport: string, target: ReportShareTarget): string {
  const targetLabel = target === 'tutor' ? 'チューター' : 'メンター';
  const bodyMatch = personalReport.match(/## 困っていること\n([\s\S]*?)(?=\n##|$)/);
  const bodyText = bodyMatch?.[1]?.trim() || '';
  return [
    `# ${targetLabel}に相談したいこと`,
    '',
    bodyText || '（概要を入力してください）',
    '',
    '## 相談したいこと',
    '- （ここを編集してください）',
  ].join('\n');
}
