import React, { useState, useEffect } from 'react';
import { initialSection, nextSection } from '../logic/sectionState';

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
  const [section, setSection] = useState(() => initialSection(defaultCollapsed));
  const collapsed = section.collapsed;

  useEffect(() => {
    setSection((current) => nextSection(current, { kind: 'default', collapsed: defaultCollapsed }));
  }, [defaultCollapsed]);

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
