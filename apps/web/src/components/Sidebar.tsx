import { Link } from '@tanstack/react-router';
import type { Consultation } from '@aimani-gs/contracts';

type SidebarProps = {
  chats: Consultation[];
  activeId?: string;
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ chats, activeId, open, onClose }: SidebarProps) {
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-header">
        <strong>aimani-gs</strong>
        <button type="button" className="icon-button" onClick={onClose}>×</button>
      </div>
      <Link to="/chat/new" className="new-chat-link" onClick={onClose}>新規</Link>
      <div className="chat-list">
        {chats.map((chat) => (
          <Link
            key={chat.id}
            to="/chat/$id"
            params={{ id: chat.id }}
            className={`chat-list-item ${activeId === chat.id ? 'active' : ''}`}
            onClick={onClose}
          >
            <span>{chat.title}</span>
            <small>{statusLabel(chat)}</small>
          </Link>
        ))}
        {chats.length === 0 && <p className="empty-sidebar">まだチャットがありません。</p>}
      </div>
    </aside>
  );
}

function statusLabel(chat: Consultation): string {
  if (chat.shared_with && chat.shared_at) return `${chat.shared_with === 'tutor' ? 'チューター' : 'メンター'}に共有済み`;
  if (chat.status === 'resolved') return '整理済み';
  return '整理中';
}
