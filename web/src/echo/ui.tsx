// The few controls the voice panel needs, with no design system behind them. Restyle them in voice.css, or swap in your own.

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type IconName = 'mic' | 'mic-off' | 'volume' | 'close' | 'send' | 'stop'

const PATHS: Record<IconName, string> = {
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z',
  'mic-off': 'M19 11h-2a5 5 0 0 1-.7 2.54l1.46 1.46A6.96 6.96 0 0 0 19 11ZM15 11V5a3 3 0 0 0-5.94-.6L15 10.34V11ZM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.47 2.62l1.52 1.52A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a6.9 6.9 0 0 0 3.1-1.17L19.73 20 21 18.73 4.27 3Z',
  volume: 'M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
  send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2 .01 7Z',
  stop: 'M6 6h12v12H6z',
}

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d={PATHS[name]} /></svg>
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'filled' | 'tonal' | 'text'; pressed?: boolean }

export function Button({ variant = 'filled', pressed, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={['echo-btn', `echo-btn--${variant}`, className].filter(Boolean).join(' ')}
    aria-pressed={pressed === undefined ? undefined : pressed} {...rest} />
}

export function IconButton({ variant = 'text', className, ...rest }: ButtonProps) {
  return <Button variant={variant} className={['echo-btn--icon', className].filter(Boolean).join(' ')} {...rest} />
}

export function Notice({ variant = 'info', action, children }: { variant?: 'info' | 'warning'; action?: { label: string; onClick: () => void }; children: ReactNode }) {
  return <div className={`echo-notice echo-notice--${variant}`} role={variant === 'warning' ? 'alert' : 'status'}>
    <span>{children}</span>
    {action && <Button variant="text" onClick={action.onClick}>{action.label}</Button>}
  </div>
}
