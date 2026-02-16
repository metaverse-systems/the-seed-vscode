import React, { useState, useEffect } from 'react';

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
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    if (defaultCollapsed) {
      setCollapsed(true);
    }
  }, [defaultCollapsed]);

  return (
    <div className="section-layout">
      <div
        className="section-header"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setCollapsed(!collapsed);
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
