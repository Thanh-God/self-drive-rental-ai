import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { assistantVisible } from '../../utils/assistant';
import AssistantChat from './AssistantChat';
import './AssistantWidget.css';

/** Floating KDrive assistant for signed-in renters. A new identity or token starts a new, empty session. */
export default function AssistantWidget() {
  const { user, token, isAuthenticated, loading } = useAuth();
  const [session, setSession] = useState({ token, revision: 0 });
  if (session.token !== token) setSession({ token, revision: session.revision + 1 });
  const { pathname } = useLocation();
  if (loading || !isAuthenticated || user?.role !== 'USER') return null;
  return <AssistantChat key={`${user.id}:${session.revision}`} visible={assistantVisible(user.role, pathname)} />;
}
