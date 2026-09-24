import type { ReactNode } from "react";

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="settings-group-title">{title}</h3>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

export function AdvancedSettings({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="settings-advanced">
      <summary>{title}</summary>
      <div className="settings-advanced-body">{children}</div>
    </details>
  );
}
