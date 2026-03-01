/**
 * Card — Reusable container component for dashboard panels.
 */

import React from "react";

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, children, className = "" }: CardProps) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-lg ${className}`}>
      {title && (
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
