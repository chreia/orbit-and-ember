// Error boundary for one part of the screen: a render error there shows a short message with
// "Try again" instead of unmounting the whole app, so the map can fail and the calendar still works.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { I18nContext } from '../i18n.tsx';
import type { I18n } from '../i18n.tsx';

interface Props {
  /** what the reader would call this part of the screen */
  name: string;
  children: ReactNode;
  className?: string;
  onRetry?: () => void;
}
interface State {
  error: Error | null;
  attempt: number;
}

export class PanelBoundary extends Component<Props, State> {
  static contextType = I18nContext;
  declare context: I18n;
  state: State = { error: null, attempt: 0 };
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[focos] "${this.props.name}" failed to render:`, error, info.componentStack);
  }
  retry = () => {
    this.props.onRetry?.();
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };
  render() {
    const { t } = this.context;
    if (this.state.error) {
      return (
        <div className={`panel-error${this.props.className ? ` ${this.props.className}` : ''}`} role="alert">
          <b>{t('panelError', { name: this.props.name })}</b>
          <span className="muted">{this.state.error.message}</span>
          <button type="button" className="btn small" onClick={this.retry}>
            {t('retry')}
          </button>
        </div>
      );
    }
    return (
      <div key={this.state.attempt} className="boundary">
        {this.props.children}
      </div>
    );
  }
}
