import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/')({
  component: HomeRedirect,
});

function HomeRedirect() {
  useEffect(() => {
    window.location.replace('/chat/new');
  }, []);
  return <main className="card">チャットを開始します...</main>;
}
