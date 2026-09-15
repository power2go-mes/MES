import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

type CopyToClipboardButtonProps = {
  value: string;
  label?: string;
};

export const CopyToClipboardButton: React.FC<CopyToClipboardButtonProps> = ({ value, label = 'Copy to clipboard' }) => {
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    if (!value || value === 'Not recorded') return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation();
        void copyValue();
      }}
      className="inline-flex shrink-0 items-center rounded p-1 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
      title={copied ? 'Copied' : label}
      aria-label={copied ? 'Copied' : label}
      disabled={!value || value === 'Not recorded'}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
};
