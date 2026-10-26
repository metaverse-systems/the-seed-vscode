import React, { useState, useEffect } from 'react';
import { nextSection, restoreSection, saveSection } from '../logic/sectionState';
import { getVsCodeApi } from '../hooks/useVsCodeApi';

interface SectionLayoutProps {
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export const SectionLayout: React.FC<SectionLayoutProps> = ({
  title,
  children,
  defaultCollapsed = false,
}) => {
  const [section, setSection] = useState(() => restoreSection(getVsCodeApi().getState(), title, defaultCollapsed));
  const collapsed = section.collapsed;

  useEffect(() => {
    setSection((current) => nextSection(current, { kind: 'default', collapsed: defaultCollapsed }));
  }, [defaultCollapsed]);

  useEffect(() => {
    const api = getVsCodeApi();
    api.setState(saveSection(api.getState(), title, section));
  }, [title, section]);

  const toggle = () => setSection((current) => nextSection(current, { kind: 'toggle' }));

  return (
    <div className="section-layout">
      <div
        className="section-header"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            toggle();
          }
        }}
        aria-expanded={!collapsed}
      >
        <span className={`section-chevron ${collapsed ? 'collapsed' : ''}`}>
          &#9662;
        </span>
        <h2 className="section-title">{title}</h2>
      </div>
      {!collapsed && <div className="section-content">{children}</div>}
    </div>
  );
};
