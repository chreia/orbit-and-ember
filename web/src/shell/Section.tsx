// A collapsible panel section with a step number. The header is a real button; the body has its
// own error boundary, so a failure inside one section leaves the rest of the panel usable.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { PanelBoundary } from './PanelBoundary.tsx';

export function Section(props: {
  step?: number;
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  id?: string;
  name?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const { step, title, hint, defaultOpen = true, id, name, extra, children } = props;
  const [open, setOpen] = useState(defaultOpen);
  const auto = useId();
  const bodyId = `${id ?? auto}-body`;
  return (
    <section className={`section${open ? ' open' : ''}`} id={id} aria-labelledby={`${bodyId}-h`}>
      <div className="section-head">
        <h2 id={`${bodyId}-h`}>
          <button type="button" className="section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
            {step !== undefined && (
              <span className="step" aria-hidden="true">
                {step}
              </span>
            )}
            <span className="section-title">{title}</span>
            {hint && <span className="hint">{hint}</span>}
            <span className="caret" aria-hidden="true" />
          </button>
        </h2>
        {open && extra}
      </div>
      {open && (
        <div className="section-body" id={bodyId}>
          <PanelBoundary name={name ?? title}>{children}</PanelBoundary>
        </div>
      )}
    </section>
  );
}
