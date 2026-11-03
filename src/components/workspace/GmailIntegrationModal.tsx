/**
 * PRODX POS - Gmail Workspace Integration Modal
 */

import React, { useState, useEffect } from 'react';
import { Mail, Send, CheckCircle2, AlertCircle, LogOut, Loader2, Sparkles } from 'lucide-react';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { initGmailAuth, signInWithGmail, signOutGmail, getGmailAccessToken, sendGmailMessage, listGmailMessages, type GmailUser } from '../../services/workspace/gmailService';

interface GmailIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRecipient?: string;
  defaultSubject?: string;
  defaultBody?: string;
}

export const GmailIntegrationModal: React.FC<GmailIntegrationModalProps> = ({
  isOpen,
  onClose,
  defaultRecipient = '',
  defaultSubject = 'PRODX POS Receipt / Report',
  defaultBody = 'Thank you for your business with PRODX POS!',
}) => {
  const [user, setUser] = useState<GmailUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [recipient, setRecipient] = useState(defaultRecipient);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const unsubscribe = initGmailAuth(
      (u, token) => {
        setUser(u);
        setAccessToken(token);
        loadInbox(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
      }
    );
    const token = getGmailAccessToken();
    if (token) {
      setAccessToken(token);
      loadInbox(token);
    }
    return () => unsubscribe();
  }, [isOpen]);

  const loadInbox = async (token: string) => {
    try {
      const data = await listGmailMessages(token, 5);
      setMessages(data.messages || []);
    } catch (err: any) {
      console.warn('Could not load Gmail messages:', err.message);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await signInWithGmail();
      setUser(res.user);
      setAccessToken(res.accessToken);
      await loadInbox(res.accessToken);
      setSuccessMessage('Successfully connected to Gmail with Google Workspace permissions!');
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate with Google Gmail.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOutGmail();
    setUser(null);
    setAccessToken(null);
    setMessages([]);
    setSuccessMessage('Disconnected from Gmail.');
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    if (!recipient.trim() || !subject.trim() || !body.trim()) {
      setError('Please fill in recipient, subject, and body.');
      return;
    }

    const confirmed = window.confirm(`Send email via Gmail to ${recipient}?`);
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await sendGmailMessage(accessToken, recipient.trim(), subject.trim(), body);
      setSuccessMessage(`Email successfully sent to ${recipient}!`);
      setBody('');
      await loadInbox(accessToken);
    } catch (err: any) {
      setError(err.message || 'Failed to send email.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Google Workspace Gmail Integration">
      <div className="space-y-6 text-left">
        {!accessToken ? (
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center text-red-400">
              <Mail className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Connect Your Gmail Account</h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto mt-1">
                Enable PRODX POS to securely send thermal receipts, shift closing reports, and low stock alerts directly from your Google Workspace Gmail account.
              </p>
            </div>
            <button
              onClick={handleLogin}
              disabled={loading}
              className="gsi-material-button inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold transition shadow-lg disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.95H1.19v3.15C3.17 21.32 7.19 24 12 24z"/>
                  <path fill="#FBBC05" d="M5.28 14.25c-.25-.72-.38-1.49-.38-2.25s.13-1.53.38-2.25V6.6H1.19C.43 8.13 0 9.87 0 12s.43 3.87 1.19 5.4l4.09-3.15z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.19 0 3.17 2.68 1.19 6.6l4.09 3.15c.95-2.84 3.6-4.95 6.72-4.95z"/>
                </svg>
              )}
              <span>Sign in with Google (Gmail)</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center space-x-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-white">Connected as {user?.email || user?.displayName || 'Authorized User'}</p>
                  <p className="text-xs text-emerald-400">Gmail API & Workspace Scopes Active</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1.5 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleSendEmail} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Recipient Email</label>
                <input
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Receipt from PRODX POS"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Message Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  placeholder="Enter message details..."
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
                  required
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Send via Gmail
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Modal>
  );
};
