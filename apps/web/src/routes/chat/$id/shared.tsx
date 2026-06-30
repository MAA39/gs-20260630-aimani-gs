import { createFileRoute, Link } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { SharedReportView } from '@aimani-gs/contracts';
import { getAuthenticatedApi } from '../../../lib/api-fetch';

const fetchSharedReport = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const response = await api(`/api/v1/consultations/${data.id}/shared`);
    if (!response.ok) throw new Error('not found');
    return (await response.json()) as SharedReportView;
  });

export const Route = createFileRoute('/chat/$id/shared')({
  loader: ({ params }) => fetchSharedReport({ data: { id: params.id } }),
  component: SharedReportPage,
});

function SharedReportPage() {
  const report = Route.useLoaderData();
  const { id } = Route.useParams();
  return (
    <div className="report-page">
      <div className="report-header">
        <Link to="/chat/$id" params={{ id }} style={{ color: '#555041', textDecoration: 'none' }}>← チャットに戻る</Link>
        <h2>{report.title}</h2>
        <p>{report.shared_with === 'tutor' ? 'チューター' : 'メンター'}向けに共有された相談内容です。</p>
      </div>
      <article className="shared-report-card">
        <pre>{report.shared_report}</pre>
      </article>
      <div className="card">
        <p className="eyebrow">Comment</p>
        <textarea placeholder="コメント欄は次フェーズで保存対応します。" disabled />
      </div>
    </div>
  );
}
