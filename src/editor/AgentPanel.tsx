import {
  Bot,
  Check,
  ChevronDown,
  Code2,
  CornerDownLeft,
  Send,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  label?: string;
  status?: 'info' | 'success' | 'warning';
}

export interface AssistantPlanCall {
  name: string;
  title: string;
  effect: 'read' | 'write' | 'sensitive' | 'destructive' | 'file';
  summary: string;
  arguments: Record<string, unknown>;
  reviewNote?: string;
}

export interface AssistantPlan {
  id: string;
  title: string;
  description: string;
  calls: AssistantPlanCall[];
  baseRevision?: number;
}

interface AgentPanelProps {
  open: boolean;
  experience: 'essentials' | 'advanced';
  capabilityCount: number;
  revision: number;
  sceneName: string;
  selectedName?: string;
  messages: AssistantMessage[];
  pendingPlan: AssistantPlan | null;
  busy?: boolean;
  canApply?: boolean;
  applyBlockedReason?: string;
  applyBlockedReasonCode?: 'stale' | 'play';
  canUndoLast?: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
  onApplyPlan: () => void;
  onDiscardPlan: () => void;
  onUndoLast: () => void;
}

const suggestions = [
  'Summarize my scene',
  'Add a coral sphere',
  'Move the selected object to 0, 2, 0',
  'Add spin to the selected object',
  'Set the background to #101827',
];

function effectLabel(effect: AssistantPlanCall['effect']) {
  if (effect === 'read') return 'Read only';
  if (effect === 'sensitive') return 'Sensitive';
  if (effect === 'destructive') return 'Destructive';
  if (effect === 'file') return 'Needs file';
  return 'Undoable edit';
}

function readableKey(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

function flattenArguments(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [`${prefix}: ${value.map((entry) => typeof entry === 'number' ? Number(entry.toFixed(4)) : String(entry)).join(', ')}`];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => flattenArguments(entry, prefix ? `${prefix} ${readableKey(key)}` : readableKey(key)));
  }
  if (!prefix) return [];
  return [`${prefix}: ${String(value)}`];
}

function argumentSummary(argumentsValue: Record<string, unknown>) {
  return flattenArguments(argumentsValue).join(' · ');
}

export function AgentPanel({
  open,
  experience,
  capabilityCount,
  revision,
  sceneName,
  selectedName,
  messages,
  pendingPlan,
  busy = false,
  canApply = true,
  applyBlockedReason,
  applyBlockedReasonCode,
  canUndoLast = false,
  onClose,
  onSubmit,
  onApplyPlan,
  onDiscardPlan,
  onUndoLast,
}: AgentPanelProps) {
  const [draft, setDraft] = useState('');
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      window.requestAnimationFrame(() => {
        const previousIsUseful = previous?.isConnected && previous !== document.body;
        const fallbackSelector = window.matchMedia('(max-width: 720px)').matches
          ? '[data-testid="assistant-mobile-trigger"]'
          : '[data-testid="assistant-toggle"]';
        const restoreTarget = previousIsUseful
          ? previous
          : document.querySelector<HTMLElement>(fallbackSelector);
        restoreTarget?.focus({ preventScroll: true });
      });
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [messages, pendingPlan]);

  if (!open) return null;

  const submit = () => {
    const prompt = draft.trim();
    if (!prompt || busy || pendingPlan) return;
    setDraft('');
    onSubmit(prompt);
  };

  const highAttention = pendingPlan?.calls.some((call) => call.effect === 'sensitive' || call.effect === 'destructive' || call.effect === 'file') ?? false;
  const applyLabel = pendingPlan?.calls.some((call) => call.effect === 'destructive')
    ? 'Apply destructive change'
    : pendingPlan?.calls.some((call) => call.effect === 'file')
      ? 'Continue to file action'
      : pendingPlan?.calls.some((call) => call.effect === 'sensitive')
        ? 'Apply sensitive change'
      : 'Apply changes';
  const mobileDialog = window.matchMedia('(max-width: 720px)').matches;

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !mobileDialog || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && (document.activeElement === panelRef.current || document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === panelRef.current) {
      event.preventDefault();
      first.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const panel = (
    <aside
      ref={panelRef}
      className="agent-panel"
      role="dialog"
      aria-modal={mobileDialog || undefined}
      aria-label="Studio Assistant"
      tabIndex={-1}
      data-testid="assistant-panel"
      onKeyDown={handlePanelKeyDown}
    >
      <header className="agent-panel-header">
        <span className="agent-mark"><Sparkles size={16} /></span>
        <span>
          <strong>Studio Assistant</strong>
          <small><i /> Local authoring tools ready</small>
        </span>
        <button type="button" onClick={onClose} aria-label="Close Studio Assistant"><X size={15} /></button>
      </header>

      <div className="agent-context-bar" data-testid="assistant-context">
        <span><ShieldCheck size={12} /> Review before edit</span>
        <span className="agent-context-target" title={`${sceneName} · ${selectedName ?? 'No selection'}`}>{sceneName} · {selectedName ?? 'No selection'}</span>
        <span className="agent-context-count">{capabilityCount} tools</span>
        <code>r{revision}</code>
      </div>

      <div className="agent-transcript" ref={transcriptRef} aria-live="polite" data-testid="assistant-transcript">
        <section className="agent-intro">
          <span><Bot size={17} /></span>
          <div>
            <strong>Build through the same tools as the editor</strong>
            <p>I can inspect the whole project and prepare validated, undoable changes. Nothing is applied until you review it.</p>
          </div>
        </section>

        {messages.map((message) => (
          <article className={`agent-message is-${message.role} ${message.status ? `is-${message.status}` : ''}`} key={message.id} data-testid="assistant-message" data-message-id={message.id} data-role={message.role}>
            <small>{message.label ?? (message.role === 'user' ? 'You' : message.role === 'tool' ? 'Tool result' : 'Studio Assistant')}</small>
            <p>{message.text}</p>
          </article>
        ))}

        {pendingPlan ? (
          <section className="agent-plan" data-testid="assistant-proposal" data-proposal-id={pendingPlan.id} data-base-revision={pendingPlan.baseRevision} data-risk={highAttention ? 'high-attention' : 'standard'}>
            <header>
              <span><ShieldCheck size={14} /></span>
              <div><strong>{pendingPlan.title}</strong><small>Review before applying</small></div>
            </header>
            <p>{pendingPlan.description}</p>
            {!canApply && applyBlockedReason ? (
              <p
                className="agent-plan-blocked"
                data-testid={applyBlockedReasonCode === 'stale' ? 'assistant-stale' : 'assistant-apply-blocked'}
                data-reason={applyBlockedReasonCode}
              >
                {applyBlockedReason}
              </p>
            ) : null}
            <div className="agent-plan-calls">
              {pendingPlan.calls.map((call, index) => (
                <div key={`${call.name}-${index}`} data-testid="assistant-tool-call" data-tool-name={call.name} data-state="proposed">
                  {experience === 'advanced' ? <code>{call.name}</code> : <strong>{call.title}</strong>}
                  <span>{call.summary}</span>
                  <small className={`is-${call.effect}`}>{effectLabel(call.effect)}</small>
                  {experience === 'essentials' && Object.keys(call.arguments).length ? <p className="agent-call-values"><b>Exact values</b>{argumentSummary(call.arguments)}</p> : null}
                  {call.reviewNote ? <p className="agent-call-review-note">{call.reviewNote}</p> : null}
                  {experience === 'advanced' ? (
                    <details className="agent-call-arguments">
                      <summary>Validated arguments</summary>
                      <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {!pendingPlan && canUndoLast ? (
          <section className="agent-undo-card">
            <span>The last Assistant plan is still the newest project change.</span>
            <button type="button" onClick={onUndoLast} data-testid="assistant-undo"><Undo2 size={12} /> Undo plan</button>
          </section>
        ) : null}

        {!pendingPlan ? (
          <section className="agent-suggestions" aria-label="Assistant suggestions">
            <span>Try asking</span>
            <div>
              {suggestions.slice(0, experience === 'essentials' ? 4 : 5).map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => onSubmit(suggestion)}>{suggestion}</button>
              ))}
            </div>
          </section>
        ) : null}

        {experience === 'advanced' ? (
          <details className="agent-technical">
            <summary><Code2 size={12} /> Agent and MCP contract <ChevronDown size={12} /></summary>
            <p>The browser bridge exposes the same typed capability manifest, project snapshot, revision checks, and tool planner used here. A model provider or MCP adapter can attach without receiving renderer or DOM access.</p>
          </details>
        ) : null}
      </div>

      {pendingPlan ? (
        <footer className={`agent-review-bar ${highAttention ? 'is-high-attention' : ''}`} data-testid="assistant-composer">
          <span><strong>{highAttention ? 'Review this sensitive action' : 'Plan ready for review'}</strong><small>Inspect the calls above before continuing.</small></span>
          <div>
            <button type="button" className="agent-plan-discard" onClick={onDiscardPlan} disabled={busy} data-testid="assistant-dismiss">Discard</button>
            <button type="button" className={`agent-plan-apply ${highAttention ? 'is-high-attention' : ''}`} onClick={onApplyPlan} disabled={!canApply || busy} data-testid="assistant-approve"><Check size={13} /> {applyLabel}</button>
          </div>
        </footer>
      ) : (
        <form className="agent-composer" data-testid="assistant-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Describe what you want to build…"
            aria-label="Ask Studio Assistant"
            data-testid="assistant-input"
            disabled={busy}
            rows={3}
          />
          <footer>
            <span><CornerDownLeft size={11} /> Enter to plan · Shift+Enter for a new line</span>
            <button type="submit" disabled={!draft.trim() || busy} data-testid="assistant-send"><Send size={13} /> Plan</button>
          </footer>
        </form>
      )}
    </aside>
  );

  return mobileDialog ? createPortal(panel, document.body) : panel;
}
